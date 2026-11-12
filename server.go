package main

import (
	"compress/gzip"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"runtime"
	"strings"
	"sync"
)

//go:embed static
var staticFiles embed.FS

var gzipExts = map[string]bool{
	".html": true, ".js": true, ".css": true, ".json": true, ".svg": true,
	".txt": true, ".geojson": true, ".map": true, ".wasm": true,
}

func canGzip(r *http.Request, p string) bool {
	if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		return false
	}
	if p == "" || p == "/" {
		return true
	}
	i := strings.LastIndex(p, ".")
	return i >= 0 && gzipExts[strings.ToLower(p[i:])]
}

type gzipResponseWriter struct {
	http.ResponseWriter
	w        io.Writer
	stripped bool
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	g.ResponseWriter.Header().Del("Content-Length")
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.stripped {
		g.ResponseWriter.Header().Del("Content-Length")
		g.stripped = true
	}
	return g.w.Write(b)
}

// isPhysical filters physical Ethernet and Wi-Fi adapters from virtual / VPN / Docker adapters.
func isPhysical(name string) bool {
	if runtime.GOOS == "windows" {
		n := strings.ToLower(name)
		for _, bad := range []string{"vethernet", "wsl", "virtual", "vmware", "pseudo", "tailscale", "zerotier", "docker", "tap", "tun", "bluetooth", "loopback", "hyper-v"} {
			if strings.Contains(n, bad) {
				return false
			}
		}
		return true
	}
	// On Linux: physical NICs have a backing device in sysfs
	_, err := os.Stat("/sys/class/net/" + name + "/device")
	return err == nil
}

func lanIPs() []string {
	var out []string
	ifaces, _ := net.Interfaces()
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 || !isPhysical(i.Name) {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil {
				ipStr := ipn.IP.String()
				// Exclude APIPA (169.254.x.x)
				if strings.HasPrefix(ipStr, "169.254.") {
					continue
				}
				out = append(out, ipStr)
			}
		}
	}
	return out
}

func OpenURL(targetURL string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", targetURL).Start()
	case "darwin":
		return exec.Command("open", targetURL).Start()
	default:
		return exec.Command("xdg-open", targetURL).Start()
	}
}

type ServerManager struct {
	mu           sync.Mutex
	running      bool
	port         string
	cancel       context.CancelFunc
	listeners    []net.Listener
	hub          *Hub
	lanAddresses []string
	callbacks    []func(bool)
}

func NewServerManager(defaultPort string) *ServerManager {
	if defaultPort == "" {
		defaultPort = "8080"
	}
	if strings.HasPrefix(defaultPort, ":") {
		defaultPort = defaultPort[1:]
	}
	return &ServerManager{
		port:         defaultPort,
		lanAddresses: lanIPs(),
	}
}

func (s *ServerManager) OnStatusChange(cb func(bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.callbacks = append(s.callbacks, cb)
}

func (s *ServerManager) notifyCallbacks(running bool) {
	for _, cb := range s.callbacks {
		go cb(running)
	}
}

func (s *ServerManager) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

func (s *ServerManager) Port() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.port
}

func (s *ServerManager) localURLLocked() string {
	return fmt.Sprintf("http://localhost:%s", s.port)
}

func (s *ServerManager) lanURLsLocked() []string {
	var res []string
	for _, ip := range s.lanAddresses {
		res = append(res, fmt.Sprintf("http://%s:%s", ip, s.port))
	}
	return res
}

func (s *ServerManager) LocalURL() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.localURLLocked()
}

func (s *ServerManager) LANURLs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lanURLsLocked()
}

func (s *ServerManager) OpenBrowser() {
	_ = OpenURL(s.LocalURL())
}

func (s *ServerManager) Start(port string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.running {
		return nil
	}

	if port != "" {
		if strings.HasPrefix(port, ":") {
			port = port[1:]
		}
		s.port = port
	}

	s.lanAddresses = lanIPs()

	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel

	s.hub = newHub()
	go s.hub.snapshotLoop(ctx)

	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		cancel()
		return fmt.Errorf("embedded static files error: %w", err)
	}
	files := http.FileServer(http.FS(sub))

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.hub.serveWS)
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		s.mu.Lock()
		online := 0
		rooms := 0
		if s.hub != nil {
			s.hub.mu.Lock()
			online = len(s.hub.clients)
			rooms = len(s.hub.rooms)
			s.hub.mu.Unlock()
		}
		data, _ := json.Marshal(map[string]any{
			"running":   true,
			"port":      s.port,
			"local_url": fmt.Sprintf("http://localhost:%s", s.port),
			"lan_ips":   s.lanAddresses,
			"online":    online,
			"rooms":     rooms,
		})
		s.mu.Unlock()
		w.Write(data)
	})

	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		dir, _ := path.Split(p)
		if strings.HasPrefix(dir, "/models/") || strings.HasPrefix(dir, "/fonts/") ||
			strings.HasPrefix(dir, "/vendor/") || strings.HasPrefix(dir, "/sfx/") ||
			strings.HasPrefix(dir, "/maps/") || strings.HasPrefix(dir, "/photos/") {
			w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		if canGzip(r, p) {
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Add("Vary", "Accept-Encoding")
			gz := gzip.NewWriter(w)
			defer gz.Close()
			files.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, w: gz}, r)
			return
		}
		files.ServeHTTP(w, r)
	}))

	var listeners []net.Listener
	bindIPs := append([]string{"127.0.0.1", "::1"}, s.lanAddresses...)
	boundAny := false

	for _, ip := range bindIPs {
		addr := net.JoinHostPort(ip, s.port)
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			if ip == "::1" {
				continue
			}
			log.Printf("Could not bind to %s: %v", addr, err)
			continue
		}
		boundAny = true
		listeners = append(listeners, ln)
		srv := &http.Server{Handler: mux}
		go func(l net.Listener) {
			_ = srv.Serve(l)
		}(ln)
	}

	if !boundAny {
		cancel()
		return fmt.Errorf("failed to bind server to any address on port %s", s.port)
	}

	s.listeners = listeners
	s.running = true
	s.notifyCallbacks(true)

	log.Printf("LAN RACER 3D server running on port %s", s.port)
	log.Printf("  Local address: %s", s.localURLLocked())
	for _, lanURL := range s.lanURLsLocked() {
		log.Printf("  LAN address:   %s", lanURL)
	}

	return nil
}

func (s *ServerManager) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.running {
		return nil
	}

	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}

	for _, ln := range s.listeners {
		_ = ln.Close()
	}
	s.listeners = nil

	if s.hub != nil {
		s.hub.mu.Lock()
		for _, c := range s.hub.clients {
			if c.conn != nil {
				_ = c.conn.Close()
			}
		}
		s.hub.mu.Unlock()
	}

	s.running = false
	s.notifyCallbacks(false)
	log.Println("LAN RACER 3D server stopped")
	return nil
}

func (s *ServerManager) Restart(port string) error {
	_ = s.Stop()
	return s.Start(port)
}

