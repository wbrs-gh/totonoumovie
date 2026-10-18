#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
マニュアルサイトを組み立てる

pages/*.html（先頭に <!--meta {...} --> を書いた本文だけのファイル）に、共通のヘッダー・左の目次・
検索・Mac/Windows の切り替え・前後ページのリンクを付けて、../site/ に書き出す。
assets/ と images/ と videos/ もそのままコピーする。

使い方: python3 build.py
"""
import html
import json
import os
import re
import shutil

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(SRC), "site")
VERSION = "v1.0.0"
UPDATED = "2026年10月16日"
BUILD = str(int(__import__("time").time()))  # トトノちゃんの絵・声の読み直し用

# 左の目次（順番どおりに前後ページもつながる）
NAV = [
    ("はじめに", [("index", "トップ"), ("start", "準備と全体の流れ")]),
    ("導入", [("install", "入れかた（Mac／Windows）")]),
    ("使い方", [("first", "はじめての1本"), ("editor", "編集画面の使い方"), ("reels", "リール・ショート"),
              ("youtube", "YouTube（横動画）"), ("voiceover", "アフレコ動画"), ("materials", "合図と持ち込み素材")]),
    ("もっと活かす", [("scenes", "使える場面と頼み方メーカー"), ("features", "機能の一覧"), ("customize", "自分好みに育てる")]),
    ("困ったとき", [("trouble", "困ったとき・質問")]),
    ("動画", [("videos", "動画で見る")]),
]
ORDER = [slug for _, items in NAV for slug, _ in items]
TITLES = {slug: t for _, items in NAV for slug, t in items}


def read_page(slug):
    raw = open(os.path.join(SRC, "pages", slug + ".html"), encoding="utf-8").read()
    m = re.match(r"\s*<!--meta\s*(\{.*?\})\s*-->", raw, re.S)
    meta = json.loads(m.group(1)) if m else {}
    body = raw[m.end():] if m else raw
    return meta, body


def nav_html(cur):
    out = []
    for group, items in NAV:
        out.append(f'<div class="nav-group"><div class="nav-h">{group}</div>')
        for slug, title in items:
            on = ' class="on" aria-current="page"' if slug == cur else ""
            out.append(f'<a href="{slug}.html"{on}>{title}</a>')
        out.append("</div>")
    return "\n".join(out)


def text_only(s):
    s = re.sub(r"<(script|style|svg)[\s\S]*?</\1>", " ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def bust(page):
    """ブラウザに古い画像・動画・CSS が残らないよう、ファイルの更新時刻を ?v= に付ける"""
    def rep(m):
        attr, url = m.group(1), m.group(2)
        path = os.path.join(OUT, url)
        if not os.path.isfile(path):
            return m.group(0)
        return f'{attr}="{url}?v={int(os.path.getmtime(path))}"'
    page = re.sub(r'\b(src|href|poster)="((?:assets|images|videos)/[^"?#]+)"', rep, page)
    def rep_url(m):
        path = os.path.join(OUT, m.group(1))
        return f"url({m.group(1)}?v={int(os.path.getmtime(path))})" if os.path.isfile(path) else m.group(0)
    return re.sub(r'url\(((?:assets|images|videos)/[^)?#]+)\)', rep_url, page)


def video_len(name):
    """videos/<name>.mp4 の長さを「1:28」の形で返す（無ければ None）"""
    import subprocess
    path = os.path.join(SRC, "videos", name + ".mp4")
    if not os.path.isfile(path):
        return None
    try:
        d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).decode())
    except Exception:
        return None
    sec = int(round(d))
    return f"{sec // 60}:{sec % 60:02d}"


def fill_lengths(body):
    """動画のカードの長さを、実際の mp4 から入れる（書いてある長さと実物をずらさない）"""
    def rep(m):
        ln = video_len(m.group(2))
        return m.group(1) + (ln or m.group(3)) + "</span>"
    return re.sub(r'(videos/([\w-]+)\.jpg\)"><span class="no">\d+</span><span class="du">)([^<]*)</span>', rep, body)


def build():
    os.makedirs(OUT, exist_ok=True)
    for d in ("assets", "images", "videos"):
        src = os.path.join(SRC, d)
        if os.path.isdir(src):
            dst = os.path.join(OUT, d)
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".*", "*.wav", "*.len.json"))
    # ファビコン：/favicon.ico を直接見に来るブラウザ向けに、一番上にも置く
    shutil.copy2(os.path.join(SRC, "assets", "favicon.ico"), os.path.join(OUT, "favicon.ico"))
    # トトノちゃん（アプリと同じ絵と仕組みを使う）
    app_static = os.path.join(os.path.dirname(os.path.dirname(SRC)), "static")
    tt_out = os.path.join(OUT, "assets", "totono")
    os.makedirs(tt_out, exist_ok=True)
    for fn in os.listdir(os.path.join(app_static, "totono")):
        if fn.endswith((".png", ".json", ".svg")):
            shutil.copy2(os.path.join(app_static, "totono", fn), os.path.join(tt_out, fn))
    shutil.copy2(os.path.join(app_static, "totono.js"), os.path.join(OUT, "assets", "totono.js"))
    # アプリのアイコン（図の中でも使う）
    ic_out = os.path.join(OUT, "assets", "icons")
    os.makedirs(ic_out, exist_ok=True)
    for fn in os.listdir(os.path.join(app_static, "icons")):
        if fn.endswith(".png"):
            shutil.copy2(os.path.join(app_static, "icons", fn), os.path.join(ic_out, fn))
    layout = open(os.path.join(SRC, "layout.html"), encoding="utf-8").read()
    index = []
    for i, slug in enumerate(ORDER):
        meta, body = read_page(slug)
        prev_s = ORDER[i - 1] if i > 0 else None
        next_s = ORDER[i + 1] if i + 1 < len(ORDER) else None
        pager = '<nav class="pager">'
        pager += f'<a class="prev" href="{prev_s}.html"><small>前のページ</small>{TITLES[prev_s]}</a>' if prev_s else "<span></span>"
        pager += f'<a class="next" href="{next_s}.html"><small>次のページ</small>{TITLES[next_s]}</a>' if next_s else "<span></span>"
        pager += "</nav>"
        title = meta.get("title", TITLES[slug])
        page = (layout.replace("{{TITLE}}", html.escape(title))
                .replace("{{DESC}}", html.escape(meta.get("desc", "")))
                .replace("{{NAV}}", nav_html(slug))
                .replace("{{BODY}}", fill_lengths(body))
                .replace("{{PAGER}}", pager if slug != "index" else "")
                .replace("{{SLUG}}", slug)
                .replace("{{VERSION}}", VERSION)
                .replace("{{UPDATED}}", UPDATED).replace("{{BUILD}}", BUILD)
                .replace("{{BODYCLASS}}", meta.get("bodyClass", "")))
        with open(os.path.join(OUT, slug + ".html"), "w", encoding="utf-8") as f:
            f.write(bust(page))
        # 検索用：見出しごとに区切って本文を入れる
        parts = re.split(r'(<h[23][^>]*id="([^"]+)"[^>]*>(.*?)</h[23]>)', body, flags=re.S)
        index.append({"p": slug, "t": title, "h": "", "a": "", "x": text_only(parts[0])[:1200]})
        for j in range(1, len(parts), 4):
            hid, htxt, rest = parts[j + 1], text_only(parts[j + 2]), parts[j + 3] if j + 3 < len(parts) else ""
            index.append({"p": slug, "t": title, "h": htxt, "a": hid, "x": text_only(rest)[:1200]})
    with open(os.path.join(OUT, "assets", "search.js"), "w", encoding="utf-8") as f:
        f.write("window.TM_SEARCH=" + json.dumps(index, ensure_ascii=False) + ";")
    # 印刷・PDF 用：全ページを1枚にまとめたページ（動画と道具は除く）
    bodies = []
    for slug in ORDER:
        if slug == "videos":
            continue
        meta, body = read_page(slug)
        body = re.sub(r"<script[\s\S]*?</script>", "", body)
        body = re.sub(r'<div class="video">[\s\S]*?</div>\s*(<div class="video-meta"[\s\S]*?</div>)?', "", body)
        bodies.append(f'<article class="print-page" id="p-{slug}">{body}</article>')
    allpage = (layout.replace("{{TITLE}}", "全ページ（印刷用）").replace("{{DESC}}", "")
               .replace("{{NAV}}", nav_html("")).replace("{{BODY}}", "\n".join(bodies)).replace("{{PAGER}}", "")
               .replace("{{SLUG}}", "all").replace("{{VERSION}}", VERSION).replace("{{UPDATED}}", UPDATED).replace("{{BUILD}}", BUILD)
               .replace("{{BODYCLASS}}", "print-all"))
    with open(os.path.join(OUT, "all.html"), "w", encoding="utf-8") as f:
        f.write(bust(allpage))
    # ページ（HTML）は毎回確かめさせる。画像・動画は ?v= が変わったときだけ読み直される
    with open(os.path.join(OUT, ".htaccess"), "w", encoding="utf-8") as f:
        f.write('<FilesMatch "\\.html$">\n  Header set Cache-Control "no-cache"\n</FilesMatch>\n')
    # 旧 URL（introduction.html）は新しいトップへ案内する
    with open(os.path.join(OUT, "introduction.html"), "w", encoding="utf-8") as f:
        f.write('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=index.html">'
                '<title>totonoumovie 使い方マニュアル</title><a href="index.html">totonoumovie 使い方マニュアルへ</a>')
    print(f"{len(ORDER)} ページを書き出しました → {OUT}")


if __name__ == "__main__":
    build()
