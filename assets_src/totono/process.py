#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
トトノちゃんの画像（codex-image で作った元絵）を、アプリで使える形に整える

- 背景（マゼンタ #FF00FF、または透明）を抜く。縁のマゼンタのにじみも消す
- どのポーズも同じ大きさの台紙（640×720）に、足元をそろえて、同じ縮尺で置く
- アイコンシート（4列×3行）は1つずつ切り出し、白い背景を抜く

使い方: python3 process.py <元絵のフォルダ> <出力フォルダ static/>
"""
import os
import sys

import numpy as np
from PIL import Image

CANVAS = (640, 720)
CHARA_H = 680


def key_out(im):
    """背景を透明にした RGBA を返す"""
    im = im.convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3] / 255.0
    if alpha.min() < 0.5:          # すでに透明の背景
        out = a.copy()
    else:
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        m = (r + b) / 2 - g        # マゼンタらしさ
        same = np.abs(r - b) < 90
        al = np.clip(1 - (m - 70) / (160 - 70), 0, 1)
        al = np.where(same, al, 1.0)
        # 縁のマゼンタのにじみを消す
        spill = np.clip(np.minimum(r, b) - g, 0, None) * (1 - al) * 1.2
        out = a.copy()
        out[..., 0] = np.clip(r - spill, 0, 255)
        out[..., 2] = np.clip(b - spill, 0, 255)
        out[..., 3] = al * 255
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def place(im):
    """透明部分を除いた範囲を、台紙の下端にそろえて同じ縮尺で置く"""
    bbox = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    im = im.crop(bbox)
    s = CHARA_H / im.height
    im = im.resize((max(1, int(im.width * s)), CHARA_H), Image.LANCZOS)
    if im.width > CANVAS[0] - 10:
        s2 = (CANVAS[0] - 10) / im.width
        im = im.resize((CANVAS[0] - 10, int(im.height * s2)), Image.LANCZOS)
    c = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    c.paste(im, ((CANVAS[0] - im.width) // 2, CANVAS[1] - im.height - 8), im)
    return c


def _runs(mask1d, min_len):
    """True が続く区間 [(始め, 終わり), ...]"""
    out, start = [], None
    for i, v in enumerate(list(mask1d) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    return out


def icons(path, outdir, names):
    """アイコンシートから、角丸の台（タイル）ごとに切り出し、白と台の色を抜いてアイコンだけにする"""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    nonwhite = a.min(axis=2) < 246
    cols = _runs(nonwhite.mean(axis=0) > 0.05, 40)
    rows = _runs(nonwhite.mean(axis=1) > 0.05, 40)
    os.makedirs(outdir, exist_ok=True)
    i = 0
    for (y0, y1) in rows:
        for (x0, x1) in cols:
            if i >= len(names):
                break
            tile = a[y0:y1, x0:x1]
            bg = np.median(tile[6:16, tile.shape[1] // 2 - 5:tile.shape[1] // 2 + 5].reshape(-1, 3), axis=0)
            d = np.sqrt(((tile - bg) ** 2).sum(axis=2))
            wh = tile.min(axis=2)
            al = np.clip((d - 18) / 40, 0, 1) * np.clip((250 - wh) / 30, 0, 1)
            ic = Image.fromarray(np.dstack([tile, al * 255]).astype(np.uint8), "RGBA")
            bb = ic.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
            if bb:
                ic = ic.crop(bb)
            side = int(max(ic.size) * 1.08)
            sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            sq.paste(ic, ((side - ic.width) // 2, (side - ic.height) // 2), ic)
            sq.resize((128, 128), Image.LANCZOS).save(os.path.join(outdir, names[i] + ".png"))
            i += 1


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.join(out, "totono"), exist_ok=True)
    for n in ("master2", "g_wave", "g_point", "g_explain", "g_think", "g_cheer", "g_good", "walk1", "walk2"):
        p = os.path.join(src, n + ".png")
        if not os.path.exists(p):
            print("無い:", n)
            continue
        name = "g_stand" if n == "master2" else n
        place(key_out(Image.open(p))).save(os.path.join(out, "totono", name + ".png"), optimize=True)
        print("OK", name)
    ip = os.path.join(src, "icons.png")
    if os.path.exists(ip):
        icons(ip, os.path.join(out, "icons"), ["film", "transcribe", "question", "scissors", "subtitle", "sparkle",
                                               "sound", "export", "inspect", "trophy", "gear", "warning"])
        print("OK icons")
