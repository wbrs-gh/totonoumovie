#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
読み上げの点検用に、すべてのせりふを1つの表に書き出す

- 動画9本の各場面：時刻・画面に出ている文字・せりふ・読み上げに使う文（yomi）・VOICEVOX の実際の読み（カナ）
- アプリのトトノちゃんのせりふ（assets_src/totono/lines.json）
- マニュアルのトトノちゃんのせりふ（site_lines.json と、各ページの図の data-guide）

使い方: python3 narration_check.py <出力.json>
点検役（人や AI）は、この表を見て「読み間違い・不自然な言い方・画面とのずれ」を指摘する。
"""
import glob
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mkvideo  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
_yp = os.path.join(ROOT, "assets_src", "totono", "yomi.json")
FIXED = json.load(open(_yp, encoding="utf-8")) if os.path.exists(_yp) else {}   # せりふごとの読みの固定


def screen_text(sc):
    """その場面で画面に出ている文字（点検で、せりふとのずれを見るため）"""
    out = []
    for k in ("kicker", "title", "sub", "step"):
        if sc.get(k):
            out.append(f"{k}: {sc[k]}")
    for p in sc.get("points") or []:
        out.append(f"・{p}")
    for kind, text in sc.get("lines") or []:
        out.append(f"[{kind}] {text}")
    if sc.get("image"):
        out.append(f"画像: {os.path.basename(sc['image'])}")
    if sc.get("label"):
        out.append(f"ラベル: {sc['label']}")
    return out


def videos(rows):
    for path in sorted(glob.glob(os.path.join(HERE, "specs", "v0*.json"))):
        spec = json.load(open(path, encoding="utf-8"))
        speaker = spec.get("speaker", 8)
        work = os.path.join(HERE, ".cache")
        os.makedirs(work, exist_ok=True)
        t = 0.0
        name = os.path.splitext(os.path.basename(path))[0]
        for i, sc in enumerate(spec["scenes"]):
            say = sc.get("say", "")
            alen = 0
            if say:
                yomi = sc.get("yomi", say)
                hk = mkvideo.hashlib.md5(f"{speaker}|{yomi}".encode()).hexdigest()[:10]
                key = re.sub(r"[^\w]", "", f"{speaker}_{say}")[:40] + "_" + hk
                alen = mkvideo.tts(yomi, speaker, os.path.join(work, key + ".wav"), spec.get("speed", 1.08))
                rows.append({"id": f"{name}#{i}", "where": f"動画 {name} の {int(t // 60)}:{int(t % 60):02d}",
                             "screen": screen_text(sc), "say": say, "yomi": yomi if yomi != say else "",
                             "kana": mkvideo.kana(yomi, speaker)})
            t += max(float(sc.get("min", 2.4)), alen + float(sc.get("pad", 0.7)))


def plain_lines(rows, path, where):
    if not os.path.exists(path):
        return
    for lid, text in json.load(open(path, encoding="utf-8")).items():
        if isinstance(text, dict):
            text = text.get("text", "")
        y = FIXED.get(lid, "")
        rows.append({"id": lid, "where": where, "screen": [], "say": text, "yomi": y, "kana": mkvideo.kana(y or text)})


def figure_lines(rows):
    for path in sorted(glob.glob(os.path.join(HERE, "..", "pages", "*.html"))):
        s = open(path, encoding="utf-8").read()
        for m in re.finditer(r"data-guide='([^']+)'", s):
            for st in json.loads(html.unescape(m.group(1))):
                y = FIXED.get(st["id"], "")
                rows.append({"id": st["id"], "where": f"マニュアル {os.path.basename(path)} の図", "screen": [],
                             "say": st["t"], "yomi": y, "kana": mkvideo.kana(y or st["t"])})


def main(out):
    rows = []
    videos(rows)
    plain_lines(rows, os.path.join(ROOT, "assets_src", "totono", "lines.json"), "アプリ（ツアー・AI の作業画面）")
    plain_lines(rows, os.path.join(ROOT, "assets_src", "totono", "site_all_lines.json"), "マニュアル（ひとこと・図・動画ページ）")
    json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(out, len(rows), "件")


if __name__ == "__main__":
    main(sys.argv[1])
