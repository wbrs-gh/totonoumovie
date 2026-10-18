#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
動画一覧の表紙（videos/<名前>.jpg）を、その動画の見どころの場面から1コマ切り出す
使い方: python3 poster.py <specs/vXX.json> <videos/vXX.mp4>
"""
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mkvideo  # noqa: E402

# 動画ごとに、表紙にする場面の番号（見分けやすい画面を選ぶ）
PICK = {"v01-overview": 1, "v02-install-mac": 4, "v03-install-win": 3, "v04-first": 4, "v05-telop": 2,
        "v06-cut": 2, "v07-effects": 4, "v08-export": 2, "v09-ai": 1}


def main(spec_path, mp4):
    spec = json.load(open(spec_path, encoding="utf-8"))
    name = os.path.splitext(os.path.basename(spec_path))[0]
    speaker = spec.get("speaker", 8)
    work = os.path.join(os.path.dirname(os.path.abspath(spec_path)), ".cache")
    t, pick = 0.0, PICK.get(name, 1)
    for i, sc in enumerate(spec["scenes"]):
        say = sc.get("say", "")
        alen = 0
        if say:
            y = sc.get("yomi", say)
            hk = hashlib.md5(f"{speaker}|{y}".encode()).hexdigest()[:10]
            key = re.sub(r"[^\w]", "", f"{speaker}_{say}")[:40] + "_" + hk
            alen = mkvideo.tts(y, speaker, os.path.join(work, key + ".wav"), spec.get("speed", 1.08))
        d = max(float(sc.get("min", 2.4)), alen + float(sc.get("pad", 0.7)))
        if i == pick:
            at = t + d * 0.8
            break
        t += d
    else:
        at = 9
    out = os.path.splitext(mp4)[0] + ".jpg"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{at:.2f}", "-i", mp4, "-frames:v", "1", "-q:v", "3", out], check=True)
    print(out, f"{at:.1f}秒")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
