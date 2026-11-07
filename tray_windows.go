//go:build windows

package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")

	pGetModuleHandle       = kernel32.NewProc("GetModuleHandleW")
	pRegisterClassEx       = user32.NewProc("RegisterClassExW")
	pCreateWindowEx        = user32.NewProc("CreateWindowExW")
	pDefWindowProc         = user32.NewProc("DefWindowProcW")
	pShowWindow            = user32.NewProc("ShowWindow")
	pUpdateWindow          = user32.NewProc("UpdateWindow")
	pSetForegroundWindow   = user32.NewProc("SetForegroundWindow")
	pDestroyWindow         = user32.NewProc("DestroyWindow")
	pPostQuitMessage       = user32.NewProc("PostQuitMessage")
	pGetMessage            = user32.NewProc("GetMessageW")
	pTranslateMessage      = user32.NewProc("TranslateMessage")
	pDispatchMessage       = user32.NewProc("DispatchMessageW")
	pPostMessage           = user32.NewProc("PostMessageW")
	pSendMessage           = user32.NewProc("SendMessageW")
	pSetWindowText         = user32.NewProc("SetWindowTextW")
	pGetWindowText         = user32.NewProc("GetWindowTextW")
	pEnableWindow          = user32.NewProc("EnableWindow")
	pLoadImage             = user32.NewProc("LoadImageW")
	pLoadCursor            = user32.NewProc("LoadCursorW")
	pLoadIcon              = user32.NewProc("LoadIconW")
	pCreatePopupMenu       = user32.NewProc("CreatePopupMenu")
	pAppendMenu            = user32.NewProc("AppendMenuW")
	pTrackPopupMenu        = user32.NewProc("TrackPopupMenu")
	pDestroyMenu           = user32.NewProc("DestroyMenu")
	pGetCursorPos          = user32.NewProc("GetCursorPos")
	pShellNotifyIcon       = shell32.NewProc("Shell_NotifyIconW")
	pCreateFont            = gdi32.NewProc("CreateFontW")
	pDeleteObject          = gdi32.NewProc("DeleteObject")
	pSetBkMode             = gdi32.NewProc("SetBkMode")
	pGetSysColorBrush      = user32.NewProc("GetSysColorBrush")
	pSetProcessDPIAware    = user32.NewProc("SetProcessDPIAware")
	pOpenClipboard         = user32.NewProc("OpenClipboard")
	pCloseClipboard        = user32.NewProc("CloseClipboard")
	pEmptyClipboard        = user32.NewProc("EmptyClipboard")
	pSetClipboardData      = user32.NewProc("SetClipboardData")
	pGlobalAlloc           = kernel32.NewProc("GlobalAlloc")
	pGlobalLock            = kernel32.NewProc("GlobalLock")
	pGlobalUnlock          = kernel32.NewProc("GlobalUnlock")
)

const (
	WM_DESTROY        = 0x0002
	WM_CLOSE          = 0x0010
	WM_COMMAND        = 0x0111
	WM_SYSCOMMAND     = 0x0112
	WM_SETFONT        = 0x0030
	WM_CTLCOLORSTATIC = 0x0138
	SC_MINIMIZE       = 0xF020
	SW_HIDE           = 0
	SW_SHOW           = 5
	SW_RESTORE        = 9
	IMAGE_ICON        = 1
	LR_LOADFROMFILE   = 0x00000010
	LR_DEFAULTSIZE    = 0x00000040

	WS_OVERLAPPED    = 0x00000000
	WS_CAPTION       = 0x00C00000
	WS_SYSMENU       = 0x00080000
	WS_MINIMIZEBOX   = 0x00020000
	WS_VISIBLE       = 0x10000000
	WS_CHILD         = 0x40000000
	WS_BORDER        = 0x00800000
	WS_EX_COMPOSITED = 0x02000000
	BS_PUSHBUTTON    = 0x00000000
	BS_DEFPUSHBUTTON = 0x00000001
	SS_LEFT          = 0x00000000

	MF_STRING       = 0x00000000
	MF_SEPARATOR    = 0x00000800
	MF_DISABLED     = 0x00000002
	MF_GRAYED       = 0x00000001
	TPM_RIGHTALIGN  = 0x0008
	TPM_BOTTOMALIGN = 0x0020

	NIM_ADD     = 0x00000000
	NIM_MODIFY  = 0x00000001
	NIM_DELETE  = 0x00000002
	NIF_MESSAGE = 0x00000001
	NIF_ICON    = 0x00000002
	NIF_TIP     = 0x00000004
	NIF_INFO    = 0x00000010
	NIIF_INFO   = 0x00000001

	WM_APP          = 0x8000
	WM_TRAYICON     = WM_APP + 100
	WM_UPDATESTATUS = WM_APP + 101

	WM_LBUTTONUP     = 0x0202
	WM_LBUTTONDBLCLK = 0x0203
	WM_RBUTTONUP     = 0x0205

	COLOR_BTNFACE = 15

	// Control IDs
	ID_BTN_START    = 101
	ID_BTN_STOP     = 102
	ID_BTN_OPEN     = 103
	ID_BTN_COPY_LAN = 104
	ID_BTN_TRAY     = 105
	ID_BTN_EXIT     = 106
	ID_EDIT_PORT    = 107

	// Tray Menu IDs
	ID_TRAY_SHOW  = 201
	ID_TRAY_OPEN  = 202
	ID_TRAY_COPY  = 203
	ID_TRAY_START = 204
	ID_TRAY_STOP  = 205
	ID_TRAY_EXIT  = 206
)

type WNDCLASSEX struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     windows.Handle
	HIcon         windows.Handle
	HCursor       windows.Handle
	HbrBackground windows.Handle
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       windows.Handle
}

type NOTIFYICONDATA struct {
	CbSize           uint32
	HWnd             windows.Handle
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            windows.Handle
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	TimeoutOrVersion uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         windows.GUID
	HBalloonIcon     windows.Handle
}

type POINT struct {
	X int32
	Y int32
}

type MSG struct {
	Hwnd    windows.Handle
	Message uint32
	Wparam  uintptr
	Lparam  uintptr
	Time    uint32
	Pt      POINT
}

var (
	appServer    *ServerManager
	mainHwnd     windows.Handle
	appIcon      windows.Handle
	appFont      windows.Handle
	appFontBold  windows.Handle
	hBgBrush     windows.Handle
	hStatusLabel windows.Handle
	hPortEdit    windows.Handle
	hLocalLabel  windows.Handle
	hLanLabel    windows.Handle
	hBtnStart    windows.Handle
	hBtnStop     windows.Handle
	hBtnOpen     windows.Handle
	hBtnCopyLan  windows.Handle
	trayAdded    bool
	trayMu       sync.Mutex
)

func attachConsoleIfCLI() {
	r, _, _ := kernel32.NewProc("AttachConsole").Call(^uintptr(0))
	if r != 0 {
		os.Stdout = os.NewFile(uintptr(windows.Stdout), "/dev/stdout")
		os.Stderr = os.NewFile(uintptr(windows.Stderr), "/dev/stderr")
	}
}

func setClipboardText(text string) error {
	u16, err := windows.UTF16FromString(text)
	if err != nil {
		return err
	}
	r, _, err := pOpenClipboard.Call(0)
	if r == 0 {
		return err
	}
	defer pCloseClipboard.Call()
	pEmptyClipboard.Call()

	const GMEM_MOVEABLE = 0x0002
	const CF_UNICODETEXT = 13
	size := uintptr(len(u16) * 2)
	hMem, _, err := pGlobalAlloc.Call(GMEM_MOVEABLE, size)
	if hMem == 0 {
		return err
	}
	ptr, _, err := pGlobalLock.Call(hMem)
	if ptr == 0 {
		return err
	}
	copy((*[1 << 20]byte)(unsafe.Pointer(ptr))[:size], (*[1 << 20]byte)(unsafe.Pointer(&u16[0]))[:size])
	pGlobalUnlock.Call(hMem)
	pSetClipboardData.Call(CF_UNICODETEXT, hMem)
	return nil
}

func extractAndLoadIcon() windows.Handle {
	if appIcon != 0 {
		return appIcon
	}
	icoPath := filepath.Join(os.TempDir(), "lan-racer.ico")
	if _, err := os.Stat(icoPath); err != nil {
		if data, err := staticFiles.ReadFile("static/favicon.ico"); err == nil {
			_ = os.WriteFile(icoPath, data, 0644)
		}
	}
	pPath, _ := windows.UTF16PtrFromString(icoPath)
	hIcon, _, _ := pLoadImage.Call(
		0,
		uintptr(unsafe.Pointer(pPath)),
		IMAGE_ICON,
		0, 0,
		LR_LOADFROMFILE|LR_DEFAULTSIZE,
	)
	if hIcon != 0 {
		appIcon = windows.Handle(hIcon)
		return appIcon
	}
	// Fallback to standard application icon
	h, _, _ := pLoadIcon.Call(0, uintptr(32512)) // IDI_APPLICATION
	appIcon = windows.Handle(h)
	return appIcon
}

func createCustomFont(size int32, weight int32) windows.Handle {
	fontName, _ := windows.UTF16PtrFromString("Segoe UI")
	hFont, _, _ := pCreateFont.Call(
		uintptr(size), 0, 0, 0,
		uintptr(weight),
		0, 0, 0, 1, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(fontName)),
	)
	return windows.Handle(hFont)
}

func addTrayIcon(hwnd windows.Handle, balloonMessage string) {
	trayMu.Lock()
	defer trayMu.Unlock()

	var nid NOTIFYICONDATA
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	nid.HWnd = hwnd
	nid.UID = 1
	nid.UFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
	nid.UCallbackMessage = WM_TRAYICON
	nid.HIcon = appIcon

	tooltip := "LAN Racer 3D - Standalone Server"
	if appServer != nil && appServer.IsRunning() {
		tooltip = fmt.Sprintf("LAN Racer 3D - Running (: %s)", appServer.Port())
	}
	t16, _ := windows.UTF16FromString(tooltip)
	copy(nid.SzTip[:], t16)

	action := uintptr(NIM_ADD)
	if trayAdded {
		action = uintptr(NIM_MODIFY)
	}

	if balloonMessage != "" {
		nid.UFlags |= NIF_INFO
		title, _ := windows.UTF16FromString("LAN Racer 3D")
		copy(nid.SzInfoTitle[:], title)
		msg, _ := windows.UTF16FromString(balloonMessage)
		copy(nid.SzInfo[:], msg)
		nid.DwInfoFlags = NIIF_INFO
	}

	res, _, _ := pShellNotifyIcon.Call(action, uintptr(unsafe.Pointer(&nid)))
	if res != 0 {
		trayAdded = true
	}
}

func removeTrayIcon(hwnd windows.Handle) {
	trayMu.Lock()
	defer trayMu.Unlock()

	if !trayAdded {
		return
	}
	var nid NOTIFYICONDATA
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	nid.HWnd = hwnd
	nid.UID = 1
	pShellNotifyIcon.Call(uintptr(NIM_DELETE), uintptr(unsafe.Pointer(&nid)))
	trayAdded = false
}

func showTrayMenu(hwnd windows.Handle) {
	hMenu, _, _ := pCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer pDestroyMenu.Call(hMenu)

	titleStr, _ := windows.UTF16PtrFromString("🏎️  LAN Racer 3D")
	pAppendMenu.Call(hMenu, uintptr(MF_STRING|MF_DISABLED), 0, uintptr(unsafe.Pointer(titleStr)))

	statusText := "● Server: STOPPED"
	if appServer != nil && appServer.IsRunning() {
		statusText = fmt.Sprintf("🟢 Server: RUNNING (: %s)", appServer.Port())
	}
	statusStr, _ := windows.UTF16PtrFromString(statusText)
	pAppendMenu.Call(hMenu, uintptr(MF_STRING|MF_DISABLED), 0, uintptr(unsafe.Pointer(statusStr)))

	pAppendMenu.Call(hMenu, uintptr(MF_SEPARATOR), 0, 0)

	showStr, _ := windows.UTF16PtrFromString("🪟 Show Control Window")
	pAppendMenu.Call(hMenu, uintptr(MF_STRING), uintptr(ID_TRAY_SHOW), uintptr(unsafe.Pointer(showStr)))

	openStr, _ := windows.UTF16PtrFromString("🌐 Open Game in Browser")
	pAppendMenu.Call(hMenu, uintptr(MF_STRING), uintptr(ID_TRAY_OPEN), uintptr(unsafe.Pointer(openStr)))

	copyStr, _ := windows.UTF16PtrFromString("📋 Copy LAN URL")
	pAppendMenu.Call(hMenu, uintptr(MF_STRING), uintptr(ID_TRAY_COPY), uintptr(unsafe.Pointer(copyStr)))

	pAppendMenu.Call(hMenu, uintptr(MF_SEPARATOR), 0, 0)

	startStr, _ := windows.UTF16PtrFromString("▶  Start Server")
	stopStr, _ := windows.UTF16PtrFromString("⏹  Stop Server")

	if appServer != nil && appServer.IsRunning() {
		pAppendMenu.Call(hMenu, uintptr(MF_STRING|MF_GRAYED), uintptr(ID_TRAY_START), uintptr(unsafe.Pointer(startStr)))
		pAppendMenu.Call(hMenu, uintptr(MF_STRING), uintptr(ID_TRAY_STOP), uintptr(unsafe.Pointer(stopStr)))
	} else {
		pAppendMenu.Call(hMenu, uintptr(MF_STRING), uintptr(ID_TRAY_START), uintptr(unsafe.Pointer(startStr)))
		pAppendMenu.Call(hMenu, uintptr(MF_STRING|MF_GRAYED), uintptr(ID_TRAY_STOP), uintptr(unsafe.Pointer(stopStr)))
	}

	pAppendMenu.Call(hMenu, uintptr(MF_SEPARATOR), 0, 0)

	exitStr, _ := windows.UTF16PtrFromString("❌ Exit LAN Racer")
	pAppendMenu.Call(hMenu, uintptr(MF_STRING), uintptr(ID_TRAY_EXIT), uintptr(unsafe.Pointer(exitStr)))

	var pt POINT
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))

	pSetForegroundWindow.Call(uintptr(hwnd))
	pTrackPopupMenu.Call(
		hMenu,
		uintptr(TPM_RIGHTALIGN|TPM_BOTTOMALIGN),
		uintptr(pt.X), uintptr(pt.Y),
		0,
		uintptr(hwnd),
		0,
	)
	// Crucial for tray menu to dismiss cleanly when clicking outside
	pPostMessage.Call(uintptr(hwnd), 0, 0, 0)
}

func updateWindowUI() {
	if mainHwnd == 0 {
		return
	}

	running := appServer != nil && appServer.IsRunning()
	port := "8080"
	if appServer != nil {
		port = appServer.Port()
	}

	if running {
		statusText, _ := windows.UTF16PtrFromString(fmt.Sprintf("● STATUS: RUNNING (Port %s)", port))
		pSetWindowText.Call(uintptr(hStatusLabel), uintptr(unsafe.Pointer(statusText)))

		pEnableWindow.Call(uintptr(hBtnStart), 0)
		pEnableWindow.Call(uintptr(hBtnStop), 1)
		pEnableWindow.Call(uintptr(hPortEdit), 0)
	} else {
		statusText, _ := windows.UTF16PtrFromString("○ STATUS: STOPPED")
		pSetWindowText.Call(uintptr(hStatusLabel), uintptr(unsafe.Pointer(statusText)))

		pEnableWindow.Call(uintptr(hBtnStart), 1)
		pEnableWindow.Call(uintptr(hBtnStop), 0)
		pEnableWindow.Call(uintptr(hPortEdit), 1)
	}

	localURL := fmt.Sprintf("Local: http://localhost:%s", port)
	localText, _ := windows.UTF16PtrFromString(localURL)
	pSetWindowText.Call(uintptr(hLocalLabel), uintptr(unsafe.Pointer(localText)))

	lanText := "LAN: Searching network..."
	if appServer != nil {
		lanURLs := appServer.LANURLs()
		if len(lanURLs) > 0 {
			lanText = "LAN: " + strings.Join(lanURLs, ", ")
		} else {
			lanText = "LAN: No physical Wi-Fi/Ethernet found"
		}
	}
	lanU16, _ := windows.UTF16PtrFromString(lanText)
	pSetWindowText.Call(uintptr(hLanLabel), uintptr(unsafe.Pointer(lanU16)))

	// Update tray icon asynchronously so explorer IPC never stalls UI thread
	go addTrayIcon(mainHwnd, "")
}

func getPortFromInput() string {
	buf := make([]uint16, 16)
	pGetWindowText.Call(uintptr(hPortEdit), uintptr(unsafe.Pointer(&buf[0])), 16)
	p := strings.TrimSpace(windows.UTF16ToString(buf))
	if p == "" {
		return "8080"
	}
	return p
}

func restoreWindow(hwnd windows.Handle) {
	pShowWindow.Call(uintptr(hwnd), uintptr(SW_RESTORE))
	pSetForegroundWindow.Call(uintptr(hwnd))
}

func minimizeToTray(hwnd windows.Handle) {
	pShowWindow.Call(uintptr(hwnd), uintptr(SW_HIDE))
	go addTrayIcon(hwnd, "LAN Racer 3D is running in background. Double-click tray icon to restore.")
}

func windowProc(hwnd windows.Handle, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case WM_CLOSE:
		minimizeToTray(hwnd)
		return 0

	case WM_SYSCOMMAND:
		if wParam&0xFFF0 == SC_MINIMIZE {
			minimizeToTray(hwnd)
			return 0
		}

	case WM_CTLCOLORSTATIC:
		// Make static text background transparent for smooth, flicker-free rendering
		pSetBkMode.Call(wParam, 1) // TRANSPARENT
		return uintptr(hBgBrush)

	case WM_UPDATESTATUS:
		updateWindowUI()
		return 0

	case WM_TRAYICON:
		switch lParam {
		case WM_LBUTTONUP, WM_LBUTTONDBLCLK:
			restoreWindow(hwnd)
		case WM_RBUTTONUP:
			showTrayMenu(hwnd)
		}
		return 0

	case WM_COMMAND:
		cmdID := int(wParam & 0xFFFF)
		switch cmdID {
		case ID_BTN_START, ID_TRAY_START:
			port := getPortFromInput()
			go func() {
				_ = appServer.Start(port)
			}()

		case ID_BTN_STOP, ID_TRAY_STOP:
			go func() {
				_ = appServer.Stop()
			}()

		case ID_BTN_OPEN, ID_TRAY_OPEN:
			if appServer != nil {
				go appServer.OpenBrowser()
			}

		case ID_BTN_COPY_LAN, ID_TRAY_COPY:
			if appServer != nil {
				lanURLs := appServer.LANURLs()
				target := appServer.LocalURL()
				if len(lanURLs) > 0 {
					target = lanURLs[0]
				}
				_ = setClipboardText(target)
				go addTrayIcon(hwnd, fmt.Sprintf("Copied %s to clipboard!", target))
			}

		case ID_BTN_TRAY:
			minimizeToTray(hwnd)

		case ID_TRAY_SHOW:
			restoreWindow(hwnd)

		case ID_BTN_EXIT, ID_TRAY_EXIT:
			removeTrayIcon(hwnd)
			if appServer != nil {
				_ = appServer.Stop()
			}
			pDestroyWindow.Call(uintptr(hwnd))
			pPostQuitMessage.Call(0)
			os.Exit(0)
		}
		return 0

	case WM_DESTROY:
		removeTrayIcon(hwnd)
		if appFont != 0 {
			pDeleteObject.Call(uintptr(appFont))
		}
		if appFontBold != 0 {
			pDeleteObject.Call(uintptr(appFontBold))
		}
		pPostQuitMessage.Call(0)
		return 0
	}

	r, _, _ := pDefWindowProc.Call(uintptr(hwnd), uintptr(msg), wParam, lParam)
	return r
}

func RunDesktopApp(srv *ServerManager) {
	// Lock this goroutine to the operating system thread (crucial for responsive Win32 message loop)
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// Enable DPI awareness for crisp rendering and removal of DWM scaling lag
	if pSetProcessDPIAware.Find() == nil {
		pSetProcessDPIAware.Call()
	}

	appServer = srv

	instHandle, _, _ := pGetModuleHandle.Call(0)
	inst := windows.Handle(instHandle)

	appIcon = extractAndLoadIcon()
	cursorHandle, _, _ := pLoadCursor.Call(0, uintptr(32512)) // IDC_ARROW

	// Use standard button face background brush
	hBrushVal, _, _ := pGetSysColorBrush.Call(uintptr(COLOR_BTNFACE))
	hBgBrush = windows.Handle(hBrushVal)

	className, _ := windows.UTF16PtrFromString("LanRacerControlClass")
	wcex := WNDCLASSEX{
		CbSize:        uint32(unsafe.Sizeof(WNDCLASSEX{})),
		Style:         0, // No CS_HREDRAW/CS_VREDRAW: eliminates full-window redraw flicker & lag
		LpfnWndProc:   windows.NewCallback(windowProc),
		HInstance:     inst,
		HIcon:         appIcon,
		HCursor:       windows.Handle(cursorHandle),
		HbrBackground: hBgBrush,
		LpszClassName: className,
		HIconSm:       appIcon,
	}
	pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wcex)))

	windowTitle, _ := windows.UTF16PtrFromString("LAN Racer 3D - Standalone Server")
	hwndVal, _, _ := pCreateWindowEx.Call(
		WS_EX_COMPOSITED, // Hardware double-buffering for child controls (instant, smooth UI)
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(windowTitle)),
		WS_OVERLAPPED|WS_CAPTION|WS_SYSMENU|WS_MINIMIZEBOX,
		150, 150, 520, 420,
		0, 0,
		uintptr(inst),
		0,
	)
	mainHwnd = windows.Handle(hwndVal)
	if mainHwnd == 0 {
		log.Println("GUI Window creation skipped. Running in background.")
		select {}
	}

	appFont = createCustomFont(16, 400)
	appFontBold = createCustomFont(18, 700)
	hFontHeader := createCustomFont(22, 700)

	btnCls, _ := windows.UTF16PtrFromString("BUTTON")
	staticCls, _ := windows.UTF16PtrFromString("STATIC")
	editCls, _ := windows.UTF16PtrFromString("EDIT")

	createCtrl := func(cls *uint16, text string, style uint32, x, y, w, h int32, id int) windows.Handle {
		t, _ := windows.UTF16PtrFromString(text)
		hCtrl, _, _ := pCreateWindowEx.Call(
			0,
			uintptr(unsafe.Pointer(cls)),
			uintptr(unsafe.Pointer(t)),
			uintptr(WS_CHILD|WS_VISIBLE|style),
			uintptr(x), uintptr(y), uintptr(w), uintptr(h),
			uintptr(mainHwnd),
			uintptr(id),
			uintptr(inst),
			0,
		)
		pSendMessage.Call(hCtrl, WM_SETFONT, uintptr(appFont), 1)
		return windows.Handle(hCtrl)
	}

	// Header
	hHeader := createCtrl(staticCls, "🏎️  LAN RACER 3D", SS_LEFT, 25, 20, 300, 30, 0)
	pSendMessage.Call(uintptr(hHeader), WM_SETFONT, uintptr(hFontHeader), 1)

	createCtrl(staticCls, "Local Network Multiplayer Racing Server", SS_LEFT, 25, 52, 450, 20, 0)

	// Status Box
	hStatusLabel = createCtrl(staticCls, "● STATUS: RUNNING (Port 8080)", SS_LEFT, 25, 85, 450, 26, 0)
	pSendMessage.Call(uintptr(hStatusLabel), WM_SETFONT, uintptr(appFontBold), 1)

	// Port configuration
	createCtrl(staticCls, "Port:", SS_LEFT, 25, 125, 45, 24, 0)
	hPortEdit = createCtrl(editCls, srv.Port(), WS_BORDER, 75, 122, 70, 24, ID_EDIT_PORT)

	// Address Displays
	hLocalLabel = createCtrl(staticCls, "Local: http://localhost:8080", SS_LEFT, 25, 160, 330, 24, 0)
	hBtnOpen = createCtrl(btnCls, "Open Game", BS_PUSHBUTTON, 365, 155, 115, 28, ID_BTN_OPEN)

	hLanLabel = createCtrl(staticCls, "LAN: Fetching network addresses...", SS_LEFT, 25, 198, 330, 24, 0)
	hBtnCopyLan = createCtrl(btnCls, "Copy Link", BS_PUSHBUTTON, 365, 193, 115, 28, ID_BTN_COPY_LAN)

	// Explanation
	createCtrl(staticCls, "Share your LAN address with friends on the same Wi-Fi network to play together!", SS_LEFT, 25, 235, 460, 20, 0)

	// Server Action Buttons
	hBtnStart = createCtrl(btnCls, "▶  Start Server", BS_DEFPUSHBUTTON, 25, 275, 140, 36, ID_BTN_START)
	hBtnStop = createCtrl(btnCls, "⏹  Stop Server", BS_PUSHBUTTON, 180, 275, 140, 36, ID_BTN_STOP)
	createCtrl(btnCls, "🗕  Minimize to Tray", BS_PUSHBUTTON, 335, 275, 145, 36, ID_BTN_TRAY)

	// Exit Button
	createCtrl(btnCls, "❌  Exit Application", BS_PUSHBUTTON, 25, 325, 455, 32, ID_BTN_EXIT)

	// Subscribe to server changes
	srv.OnStatusChange(func(b bool) {
		pPostMessage.Call(uintptr(mainHwnd), WM_UPDATESTATUS, 0, 0)
	})

	// Initial UI update and tray icon (asynchronous to never delay window presentation)
	updateWindowUI()
	go addTrayIcon(mainHwnd, "LAN Racer 3D server is active!")

	// Show Window
	pShowWindow.Call(uintptr(mainHwnd), uintptr(SW_SHOW))
	pUpdateWindow.Call(uintptr(mainHwnd))

	// Fast, responsive Windows Message Loop
	var msg MSG
	for {
		r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		pDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
}
