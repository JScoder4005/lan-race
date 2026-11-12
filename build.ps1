# PowerShell build script for Windows and Debian
$ErrorActionPreference = "Stop"

$goPath = "$env:LOCALAPPDATA\Programs\go\bin"
if (Test-Path "$goPath\go.exe") {
    $env:Path = "$goPath;$env:Path"
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Building LAN Racer 3D Standalone Packages " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Build Windows Standalone Executable
Write-Host "`n[1/3] Building Windows Standalone Executable (lan-racer.exe)..." -ForegroundColor Yellow
$env:GOOS = "windows"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
go build -ldflags "-H windowsgui -s -w" -o lan-racer.exe .
Write-Host "✓ Windows binary ready: lan-racer.exe ($((Get-Item lan-racer.exe).Length / 1MB | ForEach-Object { '{0:N1} MB' -f $_ }))" -ForegroundColor Green

# 2. Build Linux Binary
Write-Host "`n[2/3] Building Linux AMD64 Executable (lan-racer-linux)..." -ForegroundColor Yellow
$env:GOOS = "linux"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
go build -ldflags "-s -w" -o lan-racer-linux .
Write-Host "✓ Linux binary ready: lan-racer-linux ($((Get-Item lan-racer-linux).Length / 1MB | ForEach-Object { '{0:N1} MB' -f $_ }))" -ForegroundColor Green

# 3. Build Debian Package
Write-Host "`n[3/3] Building Debian Package (lan-racer_1.0.0_amd64.deb)..." -ForegroundColor Yellow
$pkgDir = "dist\deb_pkg"
if (Test-Path $pkgDir) { Remove-Item $pkgDir -Recurse -Force }
New-Item -ItemType Directory -Path "$pkgDir\DEBIAN" -Force | Out-Null
New-Item -ItemType Directory -Path "$pkgDir\usr\bin" -Force | Out-Null
New-Item -ItemType Directory -Path "$pkgDir\usr\share\applications" -Force | Out-Null
New-Item -ItemType Directory -Path "$pkgDir\usr\share\pixmaps" -Force | Out-Null

Copy-Item "lan-racer-linux" "$pkgDir\usr\bin\lan-racer" -Force
Copy-Item "static\icon.png" "$pkgDir\usr\share\pixmaps\lan-racer.png" -Force

$desktopContent = @"
[Desktop Entry]
Name=LAN Racer 3D
GenericName=LAN Racing Server
Comment=3D Multiplayer Local Network Racing Game
Exec=/usr/bin/lan-racer
Icon=lan-racer
Terminal=false
Type=Application
Categories=Game;ActionGame;Server;
Keywords=racing;game;lan;multiplayer;
StartupNotify=true
"@
[System.IO.File]::WriteAllText("$pwd\$pkgDir\usr\share\applications\lan-racer.desktop", $desktopContent.Replace("`r`n", "`n"))

$controlContent = @"
Package: lan-racer
Version: 1.0.0
Section: games
Priority: optional
Architecture: amd64
Maintainer: kmvishn <https://github.com/kmvishn/lan-race>
Description: LAN Racer 3D - Standalone Multiplayer Racing Server
 A 3D multiplayer browser racing game for local networks with real Indian roads,
 SRTM elevation profiles, traffic simulation, and vehicle models.
 Includes system tray integration and browser auto-launch.
"@
[System.IO.File]::WriteAllText("$pwd\$pkgDir\DEBIAN\control", $controlContent.Replace("`r`n", "`n") + "`n")

$postinstContent = @"
#!/bin/sh
set -e
chmod 755 /usr/bin/lan-racer
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q
fi
exit 0
"@
[System.IO.File]::WriteAllText("$pwd\$pkgDir\DEBIAN\postinst", $postinstContent.Replace("`r`n", "`n") + "`n")

if (Get-Command wsl -ErrorAction SilentlyContinue) {
    wsl -d Ubuntu -- bash -c "rm -rf /tmp/deb_pkg && cp -r /mnt/c/Users/vishnu/Documents/lan-race/dist/deb_pkg /tmp/deb_pkg && chmod -R 755 /tmp/deb_pkg && dpkg-deb --build --root-owner-group /tmp/deb_pkg /mnt/c/Users/vishnu/Documents/lan-race/lan-racer_1.0.0_amd64.deb && rm -rf /tmp/deb_pkg"
    Write-Host "✓ Debian package ready: lan-racer_1.0.0_amd64.deb ($((Get-Item lan-racer_1.0.0_amd64.deb).Length / 1MB | ForEach-Object { '{0:N1} MB' -f $_ }))" -ForegroundColor Green
} else {
    Write-Host "! WSL not found, skipping .deb packaging step (files staged in dist/deb_pkg)." -ForegroundColor Yellow
}

Write-Host "`nAll builds completed successfully!" -ForegroundColor Cyan

