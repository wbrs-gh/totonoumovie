#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マニュアル動画を作る小さなエンジン

使い方:
    python3 mkvideo.py specs/01_overview.json [--out 出力.mp4] [--preview]

台本（JSON）の scenes を順に描いて 1920x1080・30fps の MP4 にする。
- ナレーションは VOICEVOX（http://127.0.0.1:50021）で読み上げ、場面の長さは読み上げの長さで決まる
- 字幕はナレーションの文を、読み上げの進みに合わせて下に出す
- 画面写真の場面では、カメラ（寄り）・カーソルの移動とクリック・操作する場所の光る枠を重ねる
- ターミナルの場面では、コマンドを1文字ずつ打つ様子を描く

場面の種類（type）:
  title    … 表紙。title / sub / image（背景写真・任意）
  shot     … 画面写真。image / cam（寄りの始め→終わり [x,y,w,h]・0〜1）/ cursor（[[x,y],...]）/ click（場面内の0〜1の時刻）
              / hl（光る枠 [[x,y,w,h],...]）/ step（左上の段階表示）
  terminal … ターミナル。os（mac / win）/ lines（[["cmd","..."],["out","..."]]）
  card     … 文字だけの説明カード。title / points（箇条書き）/ image（右側の図・任意）
  end      … 終わりのカード
座標はすべて画像に対する割合（0〜1）。
"""
import argparse
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import wave

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
FONT_B = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
FONT_R = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"
FONT_M = "/Users/you/Library/Fonts/HackGen35-Regular.ttf"
VOICEVOX = "http://127.0.0.1:50021"
ACCENT = (45, 107, 95)
ORANGE = (255, 122, 48)
CAP_BG = (16, 20, 26, 215)

_fonts = {}


def font(path, size):
    k = (path, size)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype(path, size)
    return _fonts[k]


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


# ======================================================================
# 読み上げ（VOICEVOX）
# ======================================================================
def tts(text, speaker, path, speed=1.08):
    """VOICEVOX で text を読み上げて wav に保存し、長さ（秒）を返す。キャッシュあり"""
    if os.path.exists(path):
        with wave.open(path) as w:
            return w.getnframes() / w.getframerate()
    # 読み間違えやすい英字の読みを直す
    say = text
    for a, b in (("totonoumovie", "ととのうムービー"), ("TotonouMovie", "ととのうムービー"), ("Claude Code", "クロードコード"),
                 ("Claude", "クロード"), ("PowerShell", "パワーシェル"), ("Homebrew", "ホームブルー"), ("GitHub", "ギットハブ"),
                 ("Mac", "マック"), ("Windows", "ウィンドウズ"), ("BGM", "ビージーエム"), ("SRT", "エスアールティー"),
                 ("AI", "エーアイ"), ("PASS", "パス"), ("YouTube", "ユーチューブ"), ("MP4", "エムピーフォー"),
                 ("Enter", "エンター"), ("Python", "パイソン"), ("uv", "ユーブイ"), ("ffmpeg", "エフエフエムペグ"),
                 ("Node.js", "ノードジェイエス"), ("CTA", "シーティーエー"), ("Finder", "ファインダー"), ("gh", "ジーエイチ"),
                 ("⌘", "コマンド"), ("Ctrl", "コントロール"), ("Delete", "デリート"), ("zip", "ジップ"), ("OK", "オーケー")):
        say = say.replace(a, b)
    q = urllib.request.urlopen(urllib.request.Request(
        f"{VOICEVOX}/audio_query?speaker={speaker}&text={urllib.parse.quote(say)}", method="POST")).read()
    qd = json.loads(q)
    qd["speedScale"] = speed
    qd["prePhonemeLength"] = 0.05
    qd["postPhonemeLength"] = 0.15
    body = json.dumps(qd).encode()
    req = urllib.request.Request(f"{VOICEVOX}/synthesis?speaker={speaker}", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with open(path, "wb") as f:
        f.write(urllib.request.urlopen(req).read())
    vis, t = [], qd.get("prePhonemeLength", 0.05)
    for ph in qd["accent_phrases"]:
        for m in ph["moras"]:
            d = ((m.get("consonant_length") or 0) + (m.get("vowel_length") or 0)) / speed
            vis.append([round(t, 3), round(t + d, 3), m["vowel"]])
            t += d
        if ph.get("pause_mora"):
            d = (ph["pause_mora"].get("vowel_length") or 0) / speed
            vis.append([round(t, 3), round(t + d, 3), "pau"])
            t += d
    json.dump(vis, open(path + ".vis.json", "w"))
    with wave.open(path) as w:
        return w.getnframes() / w.getframerate()


# ======================================================================
# 描画の部品
# ======================================================================
def wrap(text, fnt, maxw):
    """日本語を幅に合わせて折り返す（句読点で切れやすくする）"""
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        if fnt.getlength(cur + ch) > maxw and cur:
            # 行頭に句読点が来ないようにする
            if ch in "、。」）！？":
                cur += ch
                lines.append(cur)
                cur = ""
                continue
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def rounded(draw, box, r, **kw):
    draw.rounded_rectangle(box, radius=r, **kw)


def split_sentences(text):
    parts = [p for p in re.split(r"(?<=[。！？])", text) if p.strip()]
    return parts or [text]


def draw_caption(img, sentences, t, dur, shift=False):
    """読み上げに合わせて、いま読んでいる文を字幕にする"""
    total = sum(len(s) for s in sentences)
    acc = 0
    cur = sentences[-1]
    for s in sentences:
        if t / max(dur, 0.01) * total < acc + len(s):
            cur = s
            break
        acc += len(s)
    fnt = font(FONT_B, 44)
    lines = wrap(cur.strip(), fnt, 1360 if shift else 1500)[:2]
    if not lines:
        return
    lh = 64
    bh = lh * len(lines) + 34
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    bw = max(fnt.getlength(l) for l in lines) + 80
    cx = (W - 250) / 2 if shift == "right" else (250 + W) / 2 if shift else W / 2
    x0 = cx - bw / 2
    y0 = H - bh - 44
    rounded(d, (x0, y0, x0 + bw, y0 + bh), 18, fill=CAP_BG)
    for i, l in enumerate(lines):
        d.text((cx, y0 + 17 + i * lh + lh / 2), l, font=fnt, fill=(255, 255, 255), anchor="mm")
    img.alpha_composite(ov)


def draw_cursor(d, x, y, scale=1.0):
    s = 1.6 * scale
    pts = [(0, 0), (0, 25), (6, 19), (11, 30), (15, 28), (10, 18), (18, 18)]
    pts = [(x + px * s, y + py * s) for px, py in pts]
    d.polygon([(px + 2, py + 3) for px, py in pts], fill=(0, 0, 0, 90))
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(20, 20, 20, 255), width=2)


def draw_step(img, step):
    if not step:
        return
    d = ImageDraw.Draw(img)
    fnt = font(FONT_B, 30)
    tw = fnt.getlength(step)
    rounded(d, (36, 32, 36 + tw + 48, 32 + 58), 29, fill=(*ACCENT, 235))
    d.text((60, 61), step, font=fnt, fill=(255, 255, 255), anchor="lm")


def draw_brand(img, label):
    d = ImageDraw.Draw(img)
    fnt = font(FONT_B, 22)
    txt = "totonoumovie 使い方" + (f"｜{label}" if label else "")
    tw = fnt.getlength(txt)
    rounded(d, (W - tw - 70, 32, W - 36, 74), 21, fill=(255, 255, 255, 200))
    d.text((W - 53, 53), txt, font=fnt, fill=(40, 46, 56), anchor="rm")


def draw_progress(img, p):
    d = ImageDraw.Draw(img)
    d.rectangle((0, H - 8, W, H), fill=(0, 0, 0, 120))
    d.rectangle((0, H - 8, W * p, H), fill=(*ORANGE, 255))


_img_cache = {}


def load_img(path):
    if path not in _img_cache:
        _img_cache[path] = Image.open(path).convert("RGB")
    return _img_cache[path]


def cover(im, w, h):
    """画像を w×h いっぱいに切り抜いて合わせる"""
    r = max(w / im.width, h / im.height)
    nw, nh = int(im.width * r + 0.5), int(im.height * r + 0.5)
    im2 = im.resize((nw, nh), Image.LANCZOS)
    x, y = (nw - w) // 2, (nh - h) // 2
    return im2.crop((x, y, x + w, y + h))


# ======================================================================
# 場面ごとの描画
# ======================================================================
_rects = {}


def resolve_refs(sc, base_dir):
    """"@名前" で書いた位置を、画面写真と一緒に測った要素の位置（.rects.json）に置き換える"""
    if sc.get("_resolved"):
        return
    rp = os.path.splitext(os.path.join(base_dir, sc["image"]))[0] + ".rects.json"
    R = json.load(open(rp, encoding="utf-8")) if os.path.exists(rp) else {}

    def rect(v):
        if isinstance(v, str) and v.startswith("@"):
            r = R.get(v[1:])
            if not r:
                raise KeyError(f"位置が見つかりません: {v}（{rp}）")
            return r
        return v

    def center(v):
        if isinstance(v, str):
            r = rect(v)
            return [r[0] + r[2] / 2, r[1] + r[3] / 2]
        return v

    def cam(v):
        # "@名前"（または ["@名前"]）ならその要素のまわりを少し広めに寄る
        if isinstance(v, list) and len(v) == 1 and isinstance(v[0], str):
            v = v[0]
        if isinstance(v, str):
            r = rect(v)
            pad = 0.06
            return [max(0, r[0] - pad), max(0, r[1] - pad), min(1, r[2] + pad * 2), min(1, r[3] + pad * 2)]
        return v
    if sc.get("hl"):
        sc["hl"] = [rect(v) for v in sc["hl"]]
    if sc.get("cursor"):
        sc["cursor"] = [center(v) for v in sc["cursor"]]
    if sc.get("cam"):
        sc["cam"] = [cam(v) for v in sc["cam"]]
    sc["_resolved"] = True


def render_shot(sc, t, dur, base_dir):
    resolve_refs(sc, base_dir)
    src = load_img(os.path.join(base_dir, sc["image"]))
    iw, ih = src.size
    cams = sc.get("cam") or [[0, 0, 1, 1]]
    if len(cams) == 1:
        cams = cams * 2
    # 寄りは場面の前半で動き切る（読み上げの間は止まって見やすく）
    k = ease((t / dur) / float(sc.get("camEnd", 0.45)))
    c = [a + (b - a) * k for a, b in zip(cams[0], cams[1])]
    # 画面の縦横比に合わせて寄りの範囲を広げる
    cx, cy, cw, ch = c[0] * iw, c[1] * ih, c[2] * iw, c[3] * ih
    target = W / H
    if cw / ch > target:
        nh = cw / target
        cy -= (nh - ch) / 2
        ch = nh
    else:
        nw = ch * target
        cx -= (nw - cw) / 2
        cw = nw
    # 余白は暗い背景で埋める
    canvas = Image.new("RGB", (W, H), (22, 25, 31))
    sx, sy = W / cw, H / ch
    crop_box = (max(0, cx), max(0, cy), min(iw, cx + cw), min(ih, cy + ch))
    part = src.crop(tuple(int(v) for v in crop_box))
    pw, ph = int((crop_box[2] - crop_box[0]) * sx), int((crop_box[3] - crop_box[1]) * sy)
    if pw > 0 and ph > 0:
        part = part.resize((pw, ph), Image.LANCZOS if sx < 1.3 else Image.BICUBIC)
        canvas.paste(part, (int((crop_box[0] - cx) * sx), int((crop_box[1] - cy) * sy)))
    img = canvas.convert("RGBA")

    def to_screen(x, y):
        return (x * iw - cx) * sx, (y * ih - cy) * sy

    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    # 光る枠（現れて脈打つ）
    tt = t / dur
    for i, r in enumerate(sc.get("hl") or []):
        start = (sc.get("hlAt") or [0.25] * 10)[i] if i < len(sc.get("hlAt") or []) else 0.25
        if tt < start:
            continue
        a = min(1.0, (tt - start) / 0.08)
        x0, y0 = to_screen(r[0], r[1])
        x1, y1 = to_screen(r[0] + r[2], r[1] + r[3])
        pad = 10
        pulse = 0.5 + 0.5 * math.sin((t - start * dur) * 5)
        for g in range(3, 0, -1):
            rounded(d, (x0 - pad - g * 5, y0 - pad - g * 5, x1 + pad + g * 5, y1 + pad + g * 5), 14 + g * 5,
                    outline=(*ORANGE, int(40 * a * (0.6 + 0.4 * pulse))), width=6)
        rounded(d, (x0 - pad, y0 - pad, x1 + pad, y1 + pad), 14, outline=(*ORANGE, int(255 * a)), width=6)
        # 番号や名前のラベル
        labels = sc.get("hlLabel") or []
        if i < len(labels) and labels[i]:
            fnt = font(FONT_B, 30)
            tw = fnt.getlength(labels[i])
            lx, ly = x0 - pad, y0 - pad - 54
            if ly < 90:
                ly = y1 + pad + 10
            lx = max(20, min(W - tw - 60, lx))
            rounded(d, (lx, ly, lx + tw + 36, ly + 46), 12, fill=(*ORANGE, int(255 * a)))
            d.text((lx + 18, ly + 23), labels[i], font=fnt, fill=(255, 255, 255, int(255 * a)), anchor="lm")
    # 画面を暗くして、光る枠の中だけ見せる（spotlight）
    if sc.get("spot") and sc.get("hl"):
        r = sc["hl"][0]
        x0, y0 = to_screen(r[0], r[1])
        x1, y1 = to_screen(r[0] + r[2], r[1] + r[3])
        a = min(1.0, max(0.0, (tt - 0.2) / 0.1))
        mask = Image.new("L", (W, H), int(130 * a))
        ImageDraw.Draw(mask).rounded_rectangle((x0 - 14, y0 - 14, x1 + 14, y1 + 14), radius=16, fill=0)
        dark = Image.new("RGBA", (W, H), (0, 0, 0, 255))
        dark.putalpha(mask)
        img.alpha_composite(dark)
    img.alpha_composite(ov)
    # カーソルとクリック
    pts = sc.get("cursor") or []
    if pts:
        n = len(pts)
        seg_t = tt / float(sc.get("cursorEnd", 0.55)) * (n - 1) if n > 1 else 0
        i = min(int(seg_t), n - 2) if n > 1 else 0
        f = ease(seg_t - i) if n > 1 else 0
        p0 = pts[i]
        p1 = pts[min(i + 1, n - 1)]
        x, y = to_screen(p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f)
        cd = ImageDraw.Draw(img)
        for ct in sc.get("click") or []:
            dt = tt - ct
            if 0 <= dt < 0.12:
                rr = 12 + dt / 0.12 * 46
                cd.ellipse((x - rr, y - rr, x + rr, y + rr), outline=(*ORANGE, int(255 * (1 - dt / 0.12))), width=6)
        press = any(0 <= tt - ct < 0.04 for ct in sc.get("click") or [])
        draw_cursor(cd, x, y, 0.9 if press else 1.0)
    return img


def render_title(sc, t, dur, base_dir):
    if sc.get("image"):
        bg = cover(load_img(os.path.join(base_dir, sc["image"])), W, H)
        z = 1 + 0.05 * (t / dur)
        bg = bg.resize((int(W * z), int(H * z)), Image.BICUBIC).crop(
            (int((W * z - W) / 2), int((H * z - H) / 2), int((W * z - W) / 2) + W, int((H * z - H) / 2) + H))
        img = bg.convert("RGBA")
        shade = Image.new("RGBA", (W, H), (10, 22, 20, 0))
        sd = ImageDraw.Draw(shade)
        for x in range(W):
            a = int(220 * max(0, 1 - x / (W * 0.75)))
            sd.line([(x, 0), (x, H)], fill=(12, 30, 27, a))
        img.alpha_composite(shade)
    else:
        img = Image.new("RGBA", (W, H), (20, 52, 46, 255))
    d = ImageDraw.Draw(img)
    a = ease(t / 0.6)
    y = 380 + (1 - a) * 30
    d.text((140, y - 90), sc.get("kicker", "totonoumovie 使い方動画"), font=font(FONT_B, 34), fill=(180, 230, 215, int(255 * a)))
    for i, line in enumerate(sc["title"].split("\n")):
        d.text((136, y + i * 112), line, font=font(FONT_B, 92), fill=(255, 255, 255, int(255 * a)))
    if sc.get("sub"):
        d.text((140, y + 112 * len(sc["title"].split("\n")) + 30), sc["sub"], font=font(FONT_R, 38),
               fill=(230, 240, 236, int(255 * a)))
    return img


def render_card(sc, t, dur, base_dir):
    img = Image.new("RGBA", (W, H), (247, 245, 240, 255))
    d = ImageDraw.Draw(img)
    has_img = bool(sc.get("image"))
    left = 140
    maxw = 860 if has_img else 1600
    d.text((left, 150), sc.get("title", ""), font=font(FONT_B, 66), fill=(31, 35, 40))
    d.rectangle((left, 250, left + 120, 258), fill=ACCENT)
    pts = sc.get("points") or []
    y = 310
    n = len(pts)
    for i, p in enumerate(pts):
        appear = 0.12 + i * (0.6 / max(1, n))
        a = ease((t / dur - appear) / 0.08)
        if a <= 0:
            continue
        d.ellipse((left, y + 12, left + 40, y + 52), fill=(*ACCENT, int(255 * a)))
        d.text((left + 20, y + 32), str(i + 1), font=font(FONT_B, 24), fill=(255, 255, 255, int(255 * a)), anchor="mm")
        lines = wrap(p, font(FONT_R, 40), maxw - 70)
        for j, l in enumerate(lines):
            d.text((left + 66, y + 10 + j * 56), l, font=font(FONT_R, 40), fill=(31, 35, 40, int(255 * a)))
        y += 56 * len(lines) + 34
    if has_img:
        pic = load_img(os.path.join(base_dir, sc["image"]))
        bw, bh = 760, 760
        r = min(bw / pic.width, bh / pic.height)
        pic = pic.resize((int(pic.width * r), int(pic.height * r)), Image.LANCZOS)
        px = 1100 + (bw - pic.width) // 2
        py = 160 + (bh - pic.height) // 2
        sh = Image.new("RGBA", (pic.width + 40, pic.height + 40), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((20, 24, pic.width + 20, pic.height + 24), 18, fill=(0, 0, 0, 60))
        sh = sh.filter(ImageFilter.GaussianBlur(12))
        img.alpha_composite(sh, (px - 20, py - 20))
        img.paste(pic, (px, py))
    return img


def render_terminal(sc, t, dur, base_dir):
    win = sc.get("os", "mac") == "win"
    img = Image.new("RGBA", (W, H), (36, 40, 48, 255))
    d = ImageDraw.Draw(img)
    # 背景に柔らかい光
    for r in range(900, 0, -60):
        d.ellipse((W / 2 - r * 1.5, H / 2 - r, W / 2 + r * 1.5, H / 2 + r), fill=(40 + (900 - r) // 60, 46 + (900 - r) // 50, 56 + (900 - r) // 45, 255))
    x0, y0, x1, y1 = 180, 120, W - 180, H - 210
    rounded(d, (x0 + 8, y0 + 14, x1 + 8, y1 + 14), 18, fill=(0, 0, 0, 110))
    bg = (12, 36, 86) if win else (30, 32, 38)
    rounded(d, (x0, y0, x1, y1), 18, fill=bg)
    rounded(d, (x0, y0, x1, y0 + 56), 18, fill=(52, 56, 64) if not win else (230, 232, 236))
    d.rectangle((x0, y0 + 36, x1, y0 + 56), fill=(52, 56, 64) if not win else (230, 232, 236))
    if win:
        d.text((x0 + 24, y0 + 28), "Windows PowerShell", font=font(FONT_R, 24), fill=(30, 30, 30), anchor="lm")
    else:
        for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
            d.ellipse((x0 + 22 + i * 30, y0 + 19, x0 + 40 + i * 30, y0 + 37), fill=c)
        d.text(((x0 + x1) / 2, y0 + 28), "ターミナル", font=font(FONT_R, 24), fill=(200, 204, 210), anchor="mm")
    prompt = "PS C:\\Users\\you> " if win else "you@Mac ~ % "
    mono = font(FONT_M, 36)
    lines = sc.get("lines") or []
    # 打つ文字の総量に合わせて、場面の前半70%で打ち切る
    total = sum(len(l[1]) if l[0] == "cmd" else 6 for l in lines)
    budget = (t / dur) / 0.7 * total
    y = y0 + 90
    for kind, text in lines:
        if budget <= 0:
            break
        if kind == "cmd":
            shown = text[:int(budget)]
            budget -= len(text)
            d.text((x0 + 40, y), prompt, font=mono, fill=(130, 210, 160) if not win else (230, 230, 230))
            px = x0 + 40 + mono.getlength(prompt)
            for seg in wrap(shown, mono, x1 - px - 40) or [""]:
                d.text((px, y), seg, font=mono, fill=(255, 255, 255))
                y += 54
            if budget < 0 and int(t * 2) % 2 == 0:
                d.rectangle((px + mono.getlength(wrap(shown, mono, x1 - px - 40)[-1] if shown else ""), y - 50,
                             px + mono.getlength(wrap(shown, mono, x1 - px - 40)[-1] if shown else "") + 18, y - 10),
                            fill=(255, 255, 255))
        else:
            budget -= 6
            color = (120, 220, 140) if ("Success" in text or "PASS" in text or "✔" in text) else (190, 196, 204)
            for seg in wrap(text, mono, x1 - x0 - 80):
                d.text((x0 + 40, y), seg, font=mono, fill=color)
                y += 54
        y += 10
    return img


def render_end(sc, t, dur, base_dir):
    img = Image.new("RGBA", (W, H), (20, 52, 46, 255))
    d = ImageDraw.Draw(img)
    d.text((W / 2, 420), sc.get("title", "おつかれさまでした"), font=font(FONT_B, 80), fill=(255, 255, 255), anchor="mm")
    if sc.get("sub"):
        d.text((W / 2, 530), sc["sub"], font=font(FONT_R, 40), fill=(200, 235, 225), anchor="mm")
    d.text((W / 2, 680), "totonoumovie.aisys.earth", font=font(FONT_B, 36), fill=(255, 210, 160), anchor="mm")
    d.text((W / 2, H - 70), sc.get("credit", ""), font=font(FONT_R, 24), fill=(160, 190, 182), anchor="mm")
    return img


# ======================================================================
# トトノちゃん（アプリと同じ絵。口は母音ごとに描いて重ねる）
# ======================================================================
TT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "static", "totono")
_tt = {}


def _bez(p0, p1, p2, n=14):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in [i / n for i in range(n + 1)]]


def mouth_img(v, skin, w):
    """母音 v の口を、幅 w の画像にする（40×30 の座標で描いて縮める）"""
    key = (v, skin, w)
    if key in _tt:
        return _tt[key]
    S = 8
    im = Image.new("RGBA", (40 * S, 30 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    P = lambda pts: [(x * S, y * S) for x, y in pts]
    line, red, pink = (42, 47, 79, 255), (184, 52, 76, 255), (240, 138, 154, 255)
    d.ellipse([8 * S, 6 * S, 32 * S, 24 * S], fill=skin)
    if v in ("n", "pau", "N", "cl"):
        d.line(P(_bez((11, 13), (20, 19.5), (29, 13))), fill=line, width=int(2.6 * S), joint="curve")
    else:
        shapes = {"a": ((10, 10), (20, 7.5), (30, 10), (28.5, 27), (20, 27), (11.5, 27)), "e": ((9, 11), (20, 8.5), (31, 11), (27.5, 22.5), (20, 22.5), (12.5, 22.5)),
                  "i": ((8, 12), (20, 9.5), (32, 12), (26, 20), (20, 20), (14, 20))}
        if v in shapes:
            a, b, c, e, f, g = shapes[v]
            pts = _bez(a, b, c) + _bez(c, e, f)[1:] + _bez(f, g, a)[1:]
            d.polygon(P(pts), fill=red, outline=line, width=int(2.2 * S))
            if v == "i":
                d.polygon(P(_bez((10, 12.4), (20, 10.6), (30, 12.4)) + [(29, 14.6), (20, 13.4), (11, 14.6)]), fill=(255, 255, 255, 255))
            else:
                cy = {"a": 22.5, "e": 19}[v]
                d.ellipse([14 * S, (cy - 3) * S, 26 * S, (cy + 3) * S], fill=pink)
        else:
            rx, ry, cy = {"u": (5, 5.2, 15.5), "o": (7, 8.4, 16)}.get(v, (5, 5, 15))
            d.ellipse([(20 - rx) * S, (cy - ry) * S, (20 + rx) * S, (cy + ry) * S], fill=red, outline=line, width=int(2.2 * S))
            d.ellipse([(20 - rx * 0.55) * S, (cy + ry * 0.35) * S, (20 + rx * 0.55) * S, (cy + ry * 0.75) * S], fill=pink)
    out = im.resize((max(1, w), max(1, int(w * 0.75))), Image.LANCZOS)
    _tt[key] = out
    return out


def tt_meta():
    if "meta" not in _tt:
        _tt["meta"] = json.load(open(os.path.join(TT_DIR, "meta.json"), encoding="utf-8"))
    return _tt["meta"]


def draw_totono(img, pose, vowel, x, y, h, t, flip=False):
    """img の (x, y)（左下）に、高さ h でトトノちゃんを置く"""
    meta = tt_meta()
    p = meta["poses"].get(pose) or meta["poses"]["explain"]
    k = ("img", pose, h)
    if k not in _tt:
        src = Image.open(os.path.join(TT_DIR, p["file"])).convert("RGBA")
        _tt[k] = src.resize((int(src.width * h / src.height), h), Image.LANCZOS)
    body = _tt[k].copy()
    m = p.get("mouth")
    if m:
        bw, bh = body.size
        mw = int(m["w"] * bw)
        mi = mouth_img(vowel, tuple(int(p["skin"][i:i + 2], 16) for i in (1, 3, 5)) + (255,), mw)
        body.alpha_composite(mi, (int(m["x"] * bw - mw / 2), int(m["y"] * bh - mi.height / 2)))
    if flip:
        body = body.transpose(Image.FLIP_LEFT_RIGHT)
    bob = int(4 * math.sin(t * 2.4))
    sh = Image.new("RGBA", body.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([body.width * 0.25, body.height - 18, body.width * 0.75, body.height - 2], fill=(0, 0, 0, 50))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(5)), (int(x), int(y - body.height)))
    img.alpha_composite(body, (int(x), int(y - body.height + bob)))


def vowel_at(sc, t):
    vis = sc.get("_vis")
    if not vis:
        return "n"
    ta = t - 0.25
    for a, b, v in vis:
        if a <= ta < b:
            return v
    return "n"


RENDER = {"shot": render_shot, "title": render_title, "card": render_card, "terminal": render_terminal, "end": render_end}


# ======================================================================
# 全体
# ======================================================================
def build(spec_path, out, preview=False):
    spec = json.load(open(spec_path, encoding="utf-8"))
    base_dir = os.path.dirname(os.path.abspath(spec_path))
    speaker = spec.get("speaker", 14)
    work = os.path.join(base_dir, ".cache")
    os.makedirs(work, exist_ok=True)
    scenes = spec["scenes"]
    # 読み上げを先に作って、場面の長さを決める
    for i, sc in enumerate(scenes):
        say = sc.get("say", "")
        if say:
            key = re.sub(r"[^\w]", "", f"{speaker}_{say}")[:60] + f"_{abs(hash(say)) % 10**8}"
            sc["_wav"] = os.path.join(work, key + ".wav")
            sc["_alen"] = tts(say, speaker, sc["_wav"], spec.get("speed", 1.08))
            vp = sc["_wav"] + ".vis.json"
            sc["_vis"] = json.load(open(vp)) if os.path.exists(vp) else None
        else:
            sc["_alen"] = 0
        sc["_dur"] = max(float(sc.get("min", 2.4)), sc["_alen"] + float(sc.get("pad", 0.7)))
    total = sum(sc["_dur"] for sc in scenes)
    print(f"{os.path.basename(spec_path)}: {len(scenes)} 場面・{total:.1f} 秒", file=sys.stderr)

    # 音声：場面の頭からナレーションを置く
    tmp = tempfile.mkdtemp()
    audio = os.path.join(tmp, "voice.wav")
    rate = 24000
    frames = bytearray()
    for sc in scenes:
        n = int(sc["_dur"] * rate)
        seg = bytearray(n * 2)
        if sc.get("_wav"):
            with wave.open(sc["_wav"]) as w:
                rate_w = w.getframerate()
                data = w.readframes(w.getnframes())
            if rate_w != rate:
                raise RuntimeError("VOICEVOX の出力のサンプルレートが想定外です")
            off = int(0.25 * rate) * 2
            seg[off:off + len(data)] = data[:max(0, len(seg) - off)]
        frames += seg
    with wave.open(audio, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))

    fps = 10 if preview else FPS
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(fps),
           "-i", "-", "-i", audio]
    bgm = spec.get("bgm")
    if bgm and os.path.exists(os.path.join(base_dir, bgm)):
        cmd += ["-stream_loop", "-1", "-i", os.path.join(base_dir, bgm), "-filter_complex",
                "[2:a]volume=0.06,afade=t=out:st=%f:d=2[b];[1:a][b]amix=inputs=2:duration=first:normalize=0[a]" % max(0, total - 2),
                "-map", "0:v", "-map", "[a]"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
            "-movflags", "+faststart", "-shortest", out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    elapsed = 0.0
    for sc in scenes:
        dur = sc["_dur"]
        sents = split_sentences(sc.get("caption", sc.get("say", "")))
        nfr = int(round(dur * fps))
        for f in range(nfr):
            t = f / fps
            img = RENDER[sc.get("type", "shot")](sc, t, dur, base_dir)
            if img.mode != "RGBA":
                img = img.convert("RGBA")
            # 場面の切り替わりは短いフェード
            if sc.get("type") not in ("title", "end"):
                draw_step(img, sc.get("step"))
                draw_brand(img, spec.get("label"))
            typ = sc.get("type", "shot")
            if spec.get("totono", True):
                pose = sc.get("pose") or {"title": "wave", "end": "cheer", "card": "explain", "terminal": "point"}.get(typ) or ("point" if sc.get("hl") or sc.get("cursor") else "explain")
                # 説明している場所が左側にあるときは、右下に立って邪魔をしない
                side = sc.get("ttSide")
                if not side:
                    hl0 = (sc.get("hl") or [None])[0]
                    side = "right" if isinstance(hl0, list) and hl0[0] + hl0[2] / 2 < 0.4 else "left"
                sc["_side"] = side
                if typ in ("title", "end"):
                    draw_totono(img, pose, vowel_at(sc, t), 1360, 1020, 620, t)
                elif side == "right":
                    draw_totono(img, pose, vowel_at(sc, t), W - 300, 1072, 330, t, flip=True)
                else:
                    draw_totono(img, pose, vowel_at(sc, t), 10, 1072, 330, t)
            if sc.get("say") and not sc.get("noCaption"):
                ta = max(0.0, t - 0.25)
                shift = spec.get("totono", True) and typ not in ("title", "end")
                draw_caption(img, sents, ta, max(0.01, sc["_alen"]), shift=("right" if sc.get("_side") == "right" else "left") if shift else False)
            draw_progress(img, (elapsed + t) / total)
            if t < 0.2:
                black = Image.new("RGBA", (W, H), (0, 0, 0, int(255 * (1 - t / 0.2) * 0.6)))
                img.alpha_composite(black)
            proc.stdin.write(img.convert("RGB").tobytes())
        elapsed += dur
    proc.stdin.close()
    proc.wait()
    print(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--out")
    ap.add_argument("--preview", action="store_true", help="10fps で速く確認用に作る")
    a = ap.parse_args()
    out = a.out or os.path.splitext(a.spec)[0] + ".mp4"
    build(a.spec, out, a.preview)
