//go:build !windows

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"

	"fyne.io/systray"
)

func attachConsoleIfCLI() {}

func setLinuxClipboard(text string) {
	if err := exec.Command("wl-copy", text).Run(); err == nil {
		return
	}
	cmd := exec.Command("xclip", "-selection", "clipboard")
	cmd.Stdin = strings.NewReader(text)
	if err := cmd.Run(); err == nil {
		return
	}
	cmd2 := exec.Command("xsel", "-b", "-i")
	cmd2.Stdin = strings.NewReader(text)
	_ = cmd2.Run()
}

func RunDesktopApp(srv *ServerManager) {
	hasDisplay := os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
	if !hasDisplay {
		log.Println("No GUI display detected. Running in CLI / headless server mode.")
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		log.Println("Shutting down server...")
		_ = srv.Stop()
		return
	}

	onReady := func() {
		// Set tray icon
		if iconBytes, err := staticFiles.ReadFile("static/icon.png"); err == nil {
			systray.SetIcon(iconBytes)
		} else if icoBytes, err := staticFiles.ReadFile("static/favicon.ico"); err == nil {
			systray.SetIcon(icoBytes)
		}

		systray.SetTitle("LAN Racer 3D")
		systray.SetTooltip("LAN Racer 3D - Standalone Server")

		mHeader := systray.AddMenuItem("🏎️ LAN Racer 3D", "Local multiplayer racing game")
		mHeader.Disable()

		mStatus := systray.AddMenuItem("🟢 Server: RUNNING", "Server status")
		mStatus.Disable()

		systray.AddSeparator()

		mOpen := systray.AddMenuItem("🌐 Open Game in Browser", "Open http://localhost:8080")
		mCopy := systray.AddMenuItem("📋 Copy LAN Address", "Copy LAN URL to clipboard")

		systray.AddSeparator()

		mStart := systray.AddMenuItem("▶ Start Server", "Start the local server")
		mStop := systray.AddMenuItem("⏹ Stop Server", "Stop the local server")

		systray.AddSeparator()

		mExit := systray.AddMenuItem("❌ Exit LAN Racer", "Quit application")

		updateMenus := func(running bool) {
			if running {
				mStatus.SetTitle(fmt.Sprintf("🟢 Server: RUNNING (: %s)", srv.Port()))
				mStart.Disable()
				mStop.Enable()
			} else {
				mStatus.SetTitle("○ Server: STOPPED")
				mStart.Enable()
				mStop.Disable()
			}
			lanURLs := srv.LANURLs()
			if len(lanURLs) > 0 {
				mCopy.SetTitle("📋 LAN: " + lanURLs[0])
				mCopy.Enable()
			} else {
				mCopy.SetTitle("📋 LAN: No physical interface")
				mCopy.Disable()
			}
		}

		updateMenus(srv.IsRunning())
		srv.OnStatusChange(updateMenus)

		go func() {
			for {
				select {
				case <-mOpen.ClickedCh:
					srv.OpenBrowser()

				case <-mCopy.ClickedCh:
					lanURLs := srv.LANURLs()
					target := srv.LocalURL()
					if len(lanURLs) > 0 {
						target = lanURLs[0]
					}
					setLinuxClipboard(target)
					log.Printf("Copied %s to clipboard!", target)

				case <-mStart.ClickedCh:
					_ = srv.Start("")

				case <-mStop.ClickedCh:
					_ = srv.Stop()

				case <-mExit.ClickedCh:
					_ = srv.Stop()
					systray.Quit()
					os.Exit(0)
				}
			}
		}()
	}

	onExit := func() {
		_ = srv.Stop()
	}

	systray.Run(onReady, onExit)
}
