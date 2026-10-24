#!/usr/bin/env python3
"""Downloads the player vehicles from Sketchfab (CC-BY / CC-BY-SA / CC0 only), optimizes them for the game and
writes their credits. Needs a Sketchfab API token (Settings -> Password & API) in SKETCHFAB_TOKEN; it is only used
for the download requests and never written to disk.

    SKETCHFAB_TOKEN=... python3 scripts/fetch-vehicles.py [id ...]
"""
import json, os, subprocess, sys, tempfile, time, urllib.error, urllib.request, zipfile

ROOT = os.path.join(os.path.dirname(__file__), '..', 'static', 'models')
UA = 'lan-racer-assets/1.0 (hobby LAN game)'
FREE = {'by', 'by-sa', 'cc0'}
# id: (sketchfab uid, player triangle budget or None, traffic triangle budget or None)
VEHICLES = {
    'swift': ('07cf082bab4d430a8a764a23590e35fa', 60000, 14000),
    'dzire': ('a96e3b803a144b44ab4b08d484ad844d', 60000, 14000),
    'baleno': ('a12eae7b7c654ec39828122981aa7bad', 60000, 14000),
    'city': ('75671276d4da476294202a5dc050a99e', 60000, 14000),
    'creta': ('67645b6f549441a786e2b4050dc0268b', 70000, 16000),
    'thar': ('66ee970b18014c98a1750064b65657b0', 70000, None),
    'scorpio': ('027c4f62a76e402c8540e3e7670b583e', 70000, 16000),
    'innova': ('2f41a972622042d78fd5001d17cdfa88', 70000, 16000),
    'bmw3': ('28f0bc2f0083417a8e521150529034d6', 60000, None),
    'a4': ('56c41d1406134dfc9d91be6193be9801', 60000, None),
    'cclass': ('19d59344b7554e6ab614a6cc02e7ad0a', 70000, None),
    'q7': ('d4a18a7aa15f4a34a2cb159e593d948f', 70000, None),
    'activa': ('de84863d474d4276ae52ff9ab72337bb', 30000, 6000),
    'scooter125': ('0162842f5bda4ef3b30972fd634c10bb', 30000, 6000),
    'pulsar': ('06fac75c72ed4780a19034447c81e72c', 35000, 7000),
    'apache': ('916198718ea84dd5932b324a1dc5fb61', 35000, 7000),
    'classic350': ('237a5048db8643f08be9d0c5e4ca3cf8', 35000, 7000),
    'duke390': ('095bf06d568f4d98ba4730c7c7824817', 45000, None),
    'ninja': ('865feab0105442f3b7aca78f663b6c79', 35000, None),
    # traffic only
    'wagonr': ('71112627f42342099ff95b59e7532663', None, 14000),
    'bolero': ('9f1e594c45e24012b50992bbfeeecda0', None, 14000),
    'auto': ('5775d012693741008acff9dad410e92d', None, 8000),
    'olaev': ('54a28e841f494f7496468f06aa36fbcb', None, 6000),
    'deliveryev': ('16a3330edde14cb7b56626ede007067f', None, 4000),
    'viking': ('4daaa992332f43419f85783a120cea44', None, 22000),
    'citybus': ('67b7998f0f3341a8a96655f96adc1a77', None, 22000),
    'keralabus': ('e11d7dcb461c4daea8e20a8a62d15980', None, 22000),  # Malabar private stage bus
    'tatatruck': ('52bb6a5e030c4fde8c3e0ee977447f4f', None, 20000),
    'tatalorry': ('b86c47f6a28347b3a942e33dae1af6f5', None, 18000),
}
TRANSFORM = ['npx', '--yes', '@gltf-transform/cli@4']


def api(path, token=None):
    headers = {'User-Agent': UA}
    if token: headers['Authorization'] = 'Token ' + token
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request('https://api.sketchfab.com/v3/' + path, headers=headers), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or k == 5: raise
            time.sleep(20 * (k + 1))  # rate limited


def fetch(url, path):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=600) as r, open(path, 'wb') as f:
        while chunk := r.read(1 << 20): f.write(chunk)


def optimize(raw, out, faces, budget, tex):
    ratio = min(1.0, budget / max(faces, 1))
    cmd = TRANSFORM + ['optimize', raw, out, '--compress', 'draco', '--texture-compress', 'webp', '--texture-size', str(tex),
                       '--instance', 'false', '--join', 'false', '--flatten', 'false', '--palette', 'false']
    cmd += ['--simplify', 'true', '--simplify-ratio', f'{ratio:.3f}', '--simplify-error', '0.003'] if ratio < 0.95 else ['--simplify', 'false']
    subprocess.run(cmd, check=True, capture_output=True)
    return ratio


def main():
    token = os.environ.get('SKETCHFAB_TOKEN')
    if not token: sys.exit('set SKETCHFAB_TOKEN')
    only = set(sys.argv[1:])
    credits = {}
    for kind in ('vehicles', 'traffic'):
        os.makedirs(os.path.join(ROOT, kind), exist_ok=True)
        path = os.path.join(ROOT, kind, 'credits.json')
        credits[kind] = json.load(open(path)) if os.path.exists(path) else {}
    for vid, (uid, player, traffic) in VEHICLES.items():
        if only and vid not in only: continue
        info = api('models/' + uid)
        lic = (info.get('license') or {}).get('slug') or ''
        if lic not in FREE:
            print(f'{vid}: skipped, licence {lic!r} is not free to redistribute'); continue
        dl = api(f'models/{uid}/download', token)
        credit = {'title': info.get('name'), 'author': (info.get('user') or {}).get('displayName') or (info.get('user') or {}).get('username'),
                  'license': lic, 'source': 'https://sketchfab.com/3d-models/' + uid}
        with tempfile.TemporaryDirectory() as tmp:
            if 'glb' in dl:
                src = os.path.join(tmp, 'model.glb'); fetch(dl['glb']['url'], src)
            else:
                z = os.path.join(tmp, 'model.zip'); fetch(dl['gltf']['url'], z)
                with zipfile.ZipFile(z) as zf: zf.extractall(os.path.join(tmp, 'x'))
                src = next(os.path.join(d, f) for d, _, fs in os.walk(os.path.join(tmp, 'x')) for f in fs if f.endswith('.gltf'))
            raw = os.path.join(tmp, 'raw.glb')
            subprocess.run(TRANSFORM + ['copy', src, raw], check=True, capture_output=True)
            faces = info.get('faceCount') or 50000
            for kind, budget, tex in (('vehicles', player, 1024), ('traffic', traffic, 512)):
                if not budget: continue
                out = os.path.join(ROOT, kind, vid + '.glb')
                ratio = optimize(raw, out, faces, budget, tex)
                credits[kind][vid] = credit
                print(f"{kind}/{vid}: {credit['title']} by {credit['author']} ({lic}) -> {os.path.getsize(out) // 1024} KB, x{ratio:.2f} of {faces} faces")
                with open(os.path.join(ROOT, kind, 'credits.json'), 'w') as f: json.dump(credits[kind], f, indent=1)


if __name__ == '__main__':
    main()
