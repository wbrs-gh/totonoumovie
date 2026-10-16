#!/bin/bash
# マニュアルの全ページを1つの PDF にする（ページごとに印刷して結合）
# 使い方: bash mkpdf.sh [サイトのURL（既定 http://127.0.0.1:8790）]
BASE="${1:-http://127.0.0.1:8790}"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/../../totonoumovie_使い方マニュアル.pdf"
TMP="$(mktemp -d)"
PAGES="index start install first editor reels youtube voiceover materials scenes features customize trouble"
for p in $PAGES; do node "$DIR/cdppdf.mjs" "$BASE/$p.html" "$TMP/$p.pdf" >/dev/null || echo "失敗: $p"; done
python3 - "$TMP" "$OUT" $PAGES <<'PY'
import sys
from pypdf import PdfWriter
tmp, out, pages = sys.argv[1], sys.argv[2], sys.argv[3:]
w = PdfWriter()
for p in pages:
    w.append(f"{tmp}/{p}.pdf")
w.add_metadata({"/Title": "totonoumovie 使い方マニュアル"})
w.write(out)
print(out, len(w.pages), "ページ")
PY
rm -rf "$TMP" /tmp/cdp-*
