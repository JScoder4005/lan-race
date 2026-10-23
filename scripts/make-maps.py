#!/usr/bin/env python3
"""Builds static/maps/*.json from real OpenStreetMap roads (OSRM routing).

Each map is the real driving route A->B as an open two-way road. Points are in metres
(x = east, z = south), spaced 4 m, with corners tighter than MIN_R smoothed out.
Route data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, os, sys, urllib.request

MAPS = [
    dict(id='bengaluru', name='BENGALURU', sub='Outer Ring Road', a=(12.99711, 77.66885), b=(13.04769, 77.58095), start='TIN FACTORY', end='BRIGADE SENATE 2'),
    dict(id='chennai', name='CHENNAI', sub='Marina to Besant Nagar', a=(13.06879, 80.28447), b=(13.00071, 80.27122), start='NAPIER BRIDGE', end="ELLIOT'S BEACH"),
    dict(id='mysuru', name='MYSURU', sub='Palace to Chamundi Hills', a=(12.30522, 76.65538), b=(12.27250, 76.67040), start='MYSORE PALACE', end='CHAMUNDI HILLS'),
    dict(id='wayanad', name='WAYANAD', sub='Thamarassery Ghat', a=(11.48498, 76.01261), b=(11.52057, 76.02035), start='ADIVARAM', end='LAKKIDI'),
    dict(id='kannur', name='KANNUR - THALASSERY', sub='NH 66', a=(11.87150, 75.36844), b=(11.75375, 75.49247), start='KANNUR', end='THALASSERY'),
    dict(id='kochi', name='ERNAKULAM', sub='Marine Drive to Edappally', a=(9.97848, 76.27577), b=(10.02610, 76.30800), start='MARINE DRIVE', end='EDAPPALLY'),
    dict(id='trivandrum', name='THIRUVANANTHAPURAM', sub='East Fort to Kovalam', a=(8.48291, 76.94694), b=(8.39510, 76.97299), start='EAST FORT', end='KOVALAM'),
    dict(id='hyderabad', name='HYDERABAD', sub='Charminar to Tank Bund', a=(17.36160, 78.47464), b=(17.42345, 78.48580), start='CHARMINAR', end='TANK BUND'),
]
OUT = os.path.join(os.path.dirname(__file__), '..', 'static', 'maps')
MIN_R = 20.0


def osrm(a, b):
    url = f'https://router.project-osrm.org/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=full&geometries=geojson'
    req = urllib.request.Request(url, headers={'User-Agent': 'lan-racer map builder'})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    return d['routes'][0]['geometry']['coordinates']


def dist(p, q): return math.hypot(p[0] - q[0], p[1] - q[1])


def resample(pts, step, closed=False):
    src = pts + ([pts[0]] if closed else [])
    out = [src[0]]
    carry = 0.0
    for i in range(1, len(src)):
        a, b = src[i - 1], src[i]
        seg = dist(a, b)
        t = step - carry
        while t <= seg:
            out.append((a[0] + (b[0] - a[0]) * t / seg, a[1] + (b[1] - a[1]) * t / seg))
            t += step
        carry = seg - (t - step)
    if not closed and dist(out[-1], src[-1]) > step * 0.3: out.append(src[-1])
    if closed and dist(out[-1], out[0]) < step * 0.5: out.pop()
    return out


def remove_loops(pts, r=14.0, gap=6):
    i = 0
    while i < len(pts):
        cut = None
        for j in range(len(pts) - 1, i + gap, -1):
            if dist(pts[i], pts[j]) < r:
                cut = j; break
        if cut: pts = pts[:i + 1] + pts[cut:]
        i += 1
    return pts


def radius(a, b, c):
    ab, bc, ca = dist(a, b), dist(b, c), dist(c, a)
    cross = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
    return float('inf') if cross < 1e-9 else ab * bc * ca / (2 * cross)


def min_radius(pts, k, closed=False):
    n = len(pts); best = float('inf')
    rng = range(n) if closed else range(k, n - k)
    for i in rng:
        best = min(best, radius(pts[(i - k) % n], pts[i], pts[(i + k) % n]))
    return best


def smooth(pts, iters, closed=False, fixed=3):
    p = list(pts); n = len(p)
    for _ in range(iters):
        q = list(p)
        for i in range(n):
            if not closed and (i < fixed or i >= n - fixed): continue
            a, b, c = p[(i - 1) % n], p[i], p[(i + 1) % n]
            q[i] = (b[0] * 0.5 + (a[0] + c[0]) * 0.25, b[1] * 0.5 + (a[1] + c[1]) * 0.25)
        p = q
    return p


def local_smooth(pts, min_r, rounds=400):
    """Smooths only around corners tighter than min_r so the rest of the real road keeps its shape."""
    n = len(pts)
    for _ in range(rounds):
        bad = [i for i in range(2, n - 2) if radius(pts[i - 2], pts[i], pts[i + 2]) < min_r]
        if not bad: break
        mask = set()
        for i in bad:
            mask.update(range(max(3, i - 10), min(n - 3, i + 11)))
        q = list(pts)
        for i in mask:
            a, b, c = pts[i - 1], pts[i], pts[i + 1]
            q[i] = (b[0] * 0.5 + (a[0] + c[0]) * 0.25, b[1] * 0.5 + (a[1] + c[1]) * 0.25)
        pts = q
    return pts


def build(m):
    coords = osrm(m['a'], m['b'])
    lat0 = sum(c[1] for c in coords) / len(coords); lon0 = sum(c[0] for c in coords) / len(coords)
    kx = 111320 * math.cos(math.radians(lat0)); kz = 110574
    pts = [((lon - lon0) * kx, -(lat - lat0) * kz) for lon, lat in coords]
    pts = resample(remove_loops(resample(pts, 4)), 8)
    pts = remove_loops(pts, 24, 4)
    pts = smooth(pts, 4)
    pts = local_smooth(pts, MIN_R)
    route = resample(pts, 4)
    route = local_smooth(route, MIN_R, 200)
    route_len = sum(dist(route[i], route[i + 1]) for i in range(len(route) - 1))
    r8 = resample(route, 8)
    print(f"{m['id']:>11}: {route_len / 1000:5.1f} km, {len(route)} pts, min radius {min_radius(r8, 2):.0f} m")
    return {
        'id': m['id'], 'name': m['name'], 'sub': m['sub'], 'start': m['start'], 'end': m['end'],
        'length': round(route_len, 1), 'origin': [round(lat0, 6), round(lon0, 6)],
        'points': [[round(x, 1), round(z, 1)] for x, z in route],
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    index = []
    for m in MAPS:
        path = os.path.join(OUT, m['id'] + '.json')
        if not only or m['id'] in only:
            data = build(m)
            with open(path, 'w') as f: json.dump(data, f, separators=(',', ':'))
        with open(path) as f: d = json.load(f)
        index.append({k: d[k] for k in ('id', 'name', 'sub', 'start', 'end', 'length')})
    with open(os.path.join(OUT, 'index.json'), 'w') as f: json.dump(index, f, indent=1)


if __name__ == '__main__':
    main()
