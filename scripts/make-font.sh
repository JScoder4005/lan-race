#!/usr/bin/env bash
# Subsets Noto fonts (SIL OFL) to the Japanese and Indian-script glyphs used in static/js, for offline signage.
set -euo pipefail
cd "$(dirname "$0")/.."
CJK=${CJK:-/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc}
KN=${KN:-/usr/share/fonts/truetype/noto/NotoSansKannada-Bold.ttf}
chars() { cat static/js/*.js | python3 -c "import sys; lo,hi=int(sys.argv[1],16),int(sys.argv[2],16); print(''.join(sorted({c for c in sys.stdin.read() if lo<=ord(c)<=hi})))" "$1" "$2"; }
JP=$(chars 3000 9FFF)
TAMIL=$(chars 0B80 0BFF); MALAYALAM=$(chars 0D00 0D7F); TELUGU=$(chars 0C00 0C7F)
KANNADA=$(chars 0C80 0CFF)
IDX=$(python3 -c "
from fontTools.ttLib import TTCollection
for i,f in enumerate(TTCollection('$CJK').fonts):
    if 'CJK JP' in f['name'].getDebugName(1): print(i); break")
mkdir -p static/fonts
python3 -m fontTools.subset "$CJK" --font-number="$IDX" --text="${JP}0123456789" --flavor=woff --layout-features='*' --output-file=static/fonts/neon-jp.woff
python3 -m fontTools.subset "$KN" --text="${KANNADA}" --flavor=woff --layout-features='*' --output-file=static/fonts/neon-kn.woff
N=/usr/share/fonts/truetype/noto
python3 -m fontTools.subset "$N/NotoSansTamil-Bold.ttf" --text="${TAMIL}" --flavor=woff --layout-features='*' --output-file=static/fonts/neon-ta.woff
python3 -m fontTools.subset "$N/NotoSansMalayalam-Bold.ttf" --text="${MALAYALAM}" --flavor=woff --layout-features='*' --output-file=static/fonts/neon-ml.woff
python3 -m fontTools.subset "$N/NotoSansTelugu-Bold.ttf" --text="${TELUGU}" --flavor=woff --layout-features='*' --output-file=static/fonts/neon-te.woff
echo "jp ${#JP}, kn ${#KANNADA}, ta ${#TAMIL}, ml ${#MALAYALAM}, te ${#TELUGU} chars"; du -h static/fonts/*.woff
