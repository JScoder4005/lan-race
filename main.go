package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address or port (e.g. :8080)")
	headless := flag.Bool("headless", false, "run purely as a headless console server (no GUI/tray)")
	cli := flag.Bool("cli", false, "run in command-line mode without GUI or system tray")
	noBrowser := flag.Bool("no-browser", false, "do not automatically open the default browser on start")
	flag.Parse()

	srv := NewServerManager(*addr)

	// Automatically start the server on launch
	if err := srv.Start(*addr); err != nil {
		log.Fatalf("Failed to start LAN Racer server: %v", err)
	}

	if *headless || *cli {
		attachConsoleIfCLI()
		fmt.Println("🏎️  LAN RACER 3D — LAN Racing Server (Console Mode)")
		fmt.Printf("  Local address: %s\n", srv.LocalURL())
		for _, lanURL := range srv.LANURLs() {
			fmt.Printf("  LAN address:   %s\n", lanURL)
		}
		fmt.Println("Server running. Press Ctrl+C to stop.")

		if !*noBrowser {
			go func() {
				time.Sleep(400 * time.Millisecond)
				srv.OpenBrowser()
			}()
		}

		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig

		fmt.Println("\nStopping server...")
		_ = srv.Stop()
		fmt.Println("Server stopped. Bye!")
		return
	}

	// In GUI / Standalone mode, open browser after the control window has smoothly rendered
	if !*noBrowser {
		go func() {
			time.Sleep(1200 * time.Millisecond)
			srv.OpenBrowser()
		}()
	}

	// Launch standalone GUI & Tray application
	RunDesktopApp(srv)
}
