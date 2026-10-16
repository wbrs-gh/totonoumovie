#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
トトノちゃんのせりふを、あらかじめ VOICEVOX で読み上げて保存する（VOICEVOX が無いパソコンでも声が出るように）

使い方: python3 make_voice.py <lines.json> <出力フォルダ（static/totono/voice）>
  出力: <id>.m4a と、口の動きをまとめた lines.json（{id: {file, text, visemes}}）
声: VOICEVOX:春日部つむぎ（speaker 8）
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

SPEAKER = 8
URL = "http://127.0.0.1:50021"


# 英字の読みを直す（表示の文字はそのまま、読み上げだけ置き換える）
YOMI = [("totonoumovie", "ととのうムービー"), ("TotonouMovie", "ととのうムービー"), ("AI", "エーアイ"), ("OK", "オーケー"),
        ("BGM", "ビージーエム"), ("Claude Code", "クロードコード"), ("YouTube", "ユーチューブ"), ("GitHub", "ぎっとはぶ"), ("ギットハブ", "ぎっとはぶ"), ("かんたん", "簡単"), ("いちばん上", "いちばんうえ")]


def yomi(text):
    for a, b in YOMI:
        text = text.replace(a, b)
    return text


def visemes(q):
    t = q.get("prePhonemeLength", 0.1)
    sp = q.get("speedScale", 1.0)
    out = []
    for ph in q["accent_phrases"]:
        for m in ph["moras"]:
            c = (m.get("consonant_length") or 0) / sp
            v = (m.get("vowel_length") or 0) / sp
            out.append([round(t, 3), round(t + c + v, 3), m["vowel"]])
            t += c + v
        if ph.get("pause_mora"):
            d = (ph["pause_mora"].get("vowel_length") or 0) / sp
            out.append([round(t, 3), round(t + d, 3), "pau"])
            t += d
    return out


def main(src, outdir):
    lines = json.load(open(src, encoding="utf-8"))
    # 読みの固定（せりふごとに、読み間違いを直した文）
    yp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "yomi.json")
    fixed = json.load(open(yp, encoding="utf-8")) if os.path.exists(yp) else {}
    os.makedirs(outdir, exist_ok=True)
    idx_path = os.path.join(outdir, "lines.json")
    idx = json.load(open(idx_path, encoding="utf-8")) if os.path.exists(idx_path) else {}
    for lid, text in lines.items():
        if isinstance(text, dict):
            text = text.get("text", "")
        say = yomi(fixed.get(lid, text))
        h = hashlib.md5(say.encode()).hexdigest()[:8]
        fn = f"{lid}_{h}.m4a"
        if idx.get(lid, {}).get("file") == fn and os.path.exists(os.path.join(outdir, fn)):
            continue
        q = json.loads(urllib.request.urlopen(urllib.request.Request(
            f"{URL}/audio_query?speaker={SPEAKER}&text={urllib.parse.quote(say)}", method="POST")).read())
        q["speedScale"] = 1.08
        wav = urllib.request.urlopen(urllib.request.Request(f"{URL}/synthesis?speaker={SPEAKER}", data=json.dumps(q).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")).read()
        tmp = os.path.join(outdir, "_tmp.wav")
        open(tmp, "wb").write(wav)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-c:a", "aac", "-b:a", "64k", os.path.join(outdir, fn)], check=True)
        os.remove(tmp)
        old = idx.get(lid, {}).get("file")
        if old and old != fn and os.path.exists(os.path.join(outdir, old)):
            os.remove(os.path.join(outdir, old))
        idx[lid] = {"file": fn, "text": text, "visemes": visemes(q)}
        print("OK", lid)
    json.dump(idx, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
