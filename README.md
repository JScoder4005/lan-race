# lan-racer

A multiplayer browser racing game for local networks. A small Go server hosts the game; players join from any browser on the same network.

## Run

```
go build -o lan-racer . && ./lan-racer
```

Open `http://localhost:8080` on the host machine; other players use one of the LAN addresses the server prints. All assets are bundled, so no internet connection is needed.

## Maps

Real roads built from OpenStreetMap routes (sprint from start to finish, two-way traffic), plus one street circuit:

Bengaluru (Tin Factory → Brigade Senate 2) · Chennai · Mysuru · Wayanad ghat · Kannur → Thalassery · Ernakulam · Thiruvananthapuram · Hyderabad · Neon Harbor circuit

`scripts/make-maps.py` regenerates the map files, `scripts/make-font.sh` the sign fonts, `scripts/fetch-vendor.sh` the third-party assets.

## Controls

W/↑ throttle · S/↓ brake · A D/← → steer · Space handbrake · Shift/N boost · C camera · R reset · K rain · M mute. Gamepads supported.

## Credits

- Road geometry © OpenStreetMap contributors (ODbL), routed with OSRM
- Ferrari 458 Italia model by vicent091036 — CC-BY 4.0 (via three.js examples)
- Concept car by Eric Chadwick / Darmstadt Graphics Group — CC-BY 4.0 (Khronos glTF Sample Assets)
- Traffic vehicles: Kenney Car Kit — CC0
- Engine loops by domasx2, sirens by aquinn, impacts by rubberduck — CC0; tire squeal by qubodup — CC-BY 3.0 (OpenGameArt)
- Noto Sans CJK / Kannada / Tamil / Malayalam / Telugu (subsets) — SIL Open Font License 1.1
- three.js r160 — MIT
