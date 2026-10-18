#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マニュアルサイトでトトノちゃんが話すせりふを1つにまとめる（声を作る前に実行）
site_lines.json ＋ 各ページの図の data-guide ＋ 動画ページの案内 → site_all_lines.json
使い方: python3 collect_site_lines.py && python3 make_voice.py site_all_lines.json ../../_docs/site_src/assets/totono/voice
"""
import glob
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, "..", "..", "_docs", "site_src", "pages")
out = dict(json.load(open(os.path.join(HERE, "site_lines.json"), encoding="utf-8")))
for p in sorted(glob.glob(os.path.join(PAGES, "*.html"))):
    s = open(p, encoding="utf-8").read()
    for m in re.finditer(r"data-guide='([^']+)'", s):
        for st in json.loads(html.unescape(m.group(1))):
            out[st["id"]] = st["t"]
    m = re.search(r'<script type="application/json" id="vdata">(.*?)</script>', s, re.S)
    if m:
        for it in json.loads(m.group(1)):
            out[it["id"]] = it["line"]
json.dump(out, open(os.path.join(HERE, "site_all_lines.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(out), "件")
