#!/usr/bin/env bash
set -e

echo "=========================================="
echo " Building LAN Racer 3D Standalone Packages "
echo "=========================================="

echo -e "\n[1/3] Building Linux AMD64 Executable..."
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o lan-racer-linux .
echo "✓ Linux binary ready: lan-racer-linux"

echo -e "\n[2/3] Building Windows Executable..."
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "-H windowsgui -s -w" -o lan-racer.exe .
echo "✓ Windows binary ready: lan-racer.exe"

echo -e "\n[3/3] Building Debian Package (lan-racer_1.0.0_amd64.deb)..."
PKG_DIR="dist/deb_pkg"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/usr/share/applications"
mkdir -p "$PKG_DIR/usr/share/pixmaps"

cp lan-racer-linux "$PKG_DIR/usr/bin/lan-racer"
chmod 755 "$PKG_DIR/usr/bin/lan-racer"
cp static/icon.png "$PKG_DIR/usr/share/pixmaps/lan-racer.png"

cat <<'EOF' > "$PKG_DIR/usr/share/applications/lan-racer.desktop"
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
EOF

cat <<'EOF' > "$PKG_DIR/DEBIAN/control"
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
EOF

cat <<'EOF' > "$PKG_DIR/DEBIAN/postinst"
#!/bin/sh
set -e
chmod 755 /usr/bin/lan-racer
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q
fi
exit 0
EOF
chmod 755 "$PKG_DIR/DEBIAN/postinst"

if command -v dpkg-deb >/dev/null 2>&1; then
    dpkg-deb --build --root-owner-group "$PKG_DIR" lan-racer_1.0.0_amd64.deb
    echo "✓ Debian package ready: lan-racer_1.0.0_amd64.deb"
else
    echo "! dpkg-deb not found; staged in $PKG_DIR"
fi

echo -e "\nAll builds completed successfully!"

