#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
totonoumovie - TotonouMovie の動画を、ブラウザの編集画面で作る・直すアプリ

使い方:
    totonoumovie [--workspace フォルダ] [--port 8780] [--no-open]

- Claude Code に導入済みの TotonouMovie プラグインを使う（エンジン・Remotion テンプレート・スキル）
- 作業フォルダ（TotonouMovie の設定 workspaceDir。既定 ~/Movies/totonou）のプロジェクトを一覧する
- 編集画面で data/*.ts（字幕・カット・効果音・寄り・モーション・画像・章）を直し、Remotion で書き出す
- 「AIで作る」「AIに直してもらう」は claude コマンドに TotonouMovie のスキル手順を実行させる
- アプリ自身の記録・キャッシュは ~/.totonoumovie/ に置く
"""
import argparse
import hashlib
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")
sys.path.insert(0, APP_DIR)

from tm_app import agent as agentmod  # noqa: E402
from tm_app import jobs as jobsmod  # noqa: E402
from tm_app import plugin as pluginmod  # noqa: E402
from tm_app import tsdata  # noqa: E402

USER_DIR = os.path.expanduser("~/.totonoumovie")
CACHE_DIR = os.path.join(USER_DIR, "cache")
VIDEO_EXT = {"mov", "mp4", "m4v", "avi", "mkv", "webm", "mts"}
AUDIO_EXT = {"mp3", "m4a", "wav", "aac", "flac", "ogg", "aiff", "aif"}
IMAGE_EXT = {"jpg", "jpeg", "png", "webp", "gif"}

STATE = {"workspace_override": None}
JOBS = jobsmod.Jobs()
PROXY_LOCK = threading.Lock()
PROXY_RUNNING = set()


# ======================================================================
# プラグイン・作業フォルダ
# ======================================================================
def plugin_root():
    return pluginmod.find_plugin_root()


AGENTS = agentmod.AgentManager(plugin_root)


def settings():
    return pluginmod.load_settings()


def workspace():
    return STATE["workspace_override"] or settings()["workspaceDir"]


def resolve_project(name_or_path):
    """プロジェクト名（作業フォルダ直下）か絶対パスから、プロジェクトのフォルダを返す"""
    if not name_or_path:
        raise ValueError("プロジェクトが指定されていません")
    p = name_or_path if os.path.isabs(name_or_path) else os.path.join(workspace(), name_or_path)
    p = os.path.realpath(p)
    if not os.path.exists(os.path.join(p, "src", "project-config.json")):
        raise FileNotFoundError(f"TotonouMovie のプロジェクトではありません: {p}")
    return p


def read_json(p, default=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return default


def project_config(P):
    return read_json(os.path.join(P, "src", "project-config.json"), {}) or {}


def input_video_path(P, cfg=None):
    """project-config の inputVideo を実パスにする（相対なら public/・プロジェクト直下の順）"""
    cfg = cfg or project_config(P)
    v = cfg.get("inputVideo")
    if not v:
        return None
    if os.path.isabs(v):
        return v if os.path.exists(v) else None
    for base in (os.path.join(P, "public"), P):
        c = os.path.join(base, v)
        if os.path.exists(c):
            return c
    return None


def project_title(P):
    return project_config(P).get("title") or os.path.basename(P)


def probe(full):
    d = {"w": 0, "h": 0, "dur": 0.0, "fps": 30.0}
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", full],
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=60)
        j = json.loads(r.stdout)
    except Exception:
        return d
    d["dur"] = float(j.get("format", {}).get("duration", 0) or 0)
    for s in j.get("streams", []):
        if s.get("codec_type") == "video" and not d["w"]:
            w, h = s.get("width", 0), s.get("height", 0)
            rot = 0
            for sd in s.get("side_data_list", []) or []:
                if "rotation" in sd:
                    rot = int(sd["rotation"])
            if abs(rot) == 90:
                w, h = h, w
            d["w"], d["h"] = w, h
            d["codec"] = s.get("codec_name")
            try:
                a, b = (s.get("avg_frame_rate") or "30/1").split("/")
                d["fps"] = round(float(a) / float(b), 3) if float(b) else 30.0
            except Exception:
                pass
    return d


PROBE_CACHE = {}


def probe_cached(full):
    key = (full, os.path.getmtime(full))
    if key not in PROBE_CACHE:
        PROBE_CACHE[key] = probe(full)
    return PROBE_CACHE[key]


def cloud_sync_folder(path):
    """Dropbox・iCloud・Google ドライブ・OneDrive などの同期フォルダの中か"""
    p = os.path.realpath(path).replace("\\", "/")
    keys = ("/Dropbox", "/Library/CloudStorage/", "/Library/Mobile Documents/", "/OneDrive", "/Google Drive", "/GoogleDrive")
    return any(k in p for k in keys)


def list_projects():
    ws = workspace()
    out = []
    if not os.path.isdir(ws):
        return out
    names = sorted(os.listdir(ws))
    # 起動したフォルダそのものがプロジェクトなら、それも一覧に出す
    if os.path.exists(os.path.join(ws, "src", "project-config.json")):
        names = [ws] + names
    for name in names:
        P = os.path.join(ws, name)
        cfgp = os.path.join(P, "src", "project-config.json")
        if not os.path.exists(cfgp):
            continue
        cfg = read_json(cfgp, {}) or {}
        outs = []
        od = os.path.join(P, "out")
        if os.path.isdir(od):
            outs = sorted(f for f in os.listdir(od) if f.endswith(".mp4"))
        mtime = max(os.path.getmtime(cfgp),
                    *[os.path.getmtime(os.path.join(P, "data", f)) for f in os.listdir(os.path.join(P, "data"))
                      if f.endswith(".ts")] if os.path.isdir(os.path.join(P, "data")) else [0])
        out.append({"name": name, "path": P, "title": cfg.get("title") or name, "format": cfg.get("format"),
                    "mode": "voiceover" if cfg.get("voiceover") else ("shorts" if cfg.get("shorts") else "long"),
                    "outputs": outs, "mtime": mtime,
                    "running": [r["id"] for r in AGENTS.list(P) if r["status"] == "running"]})
    out.sort(key=lambda x: x["mtime"], reverse=True)
    return out


# ======================================================================
# プロジェクトの中身（編集画面に渡す）
# ======================================================================
def transcript_segments(P):
    for fn in ("transcript_with_speaker_corrected.json", "transcript_fixed.json",
               "transcript_dict_fixed.json", "transcript.json"):
        d = read_json(os.path.join(P, "work", fn))
        if d:
            segs = d.get("segments") if isinstance(d, dict) else d
            out = []
            for s in segs or []:
                if isinstance(s, dict) and "start" in s:
                    out.append({"start": s.get("start"), "end": s.get("end"), "text": (s.get("text") or "").strip(),
                                "speaker": s.get("speaker_id")})
            return {"file": fn, "segments": out}
    return {"file": None, "segments": []}


def list_files(d, exts=None):
    if not os.path.isdir(d):
        return []
    return sorted(f for f in os.listdir(d)
                  if not f.startswith(".") and (exts is None or f.lower().rsplit(".", 1)[-1] in exts))


def project_payload(P):
    cfg = project_config(P)
    vid = input_video_path(P, cfg)
    info = probe_cached(vid) if vid else {}
    data = {}
    for key in tsdata.DATA_FILES:
        try:
            data[key] = tsdata.read_items(P, key)
        except Exception as e:  # noqa: BLE001
            data[key] = []
            data.setdefault("_errors", {})[key] = str(e)
    ei = read_json(os.path.join(P, "work", "edit_instructions.json"), None)
    approvals = read_json(os.path.join(P, "work", "cut_approvals.json"), None)
    stills = []
    sd = os.path.join(P, "work", "stills")
    if os.path.isdir(sd):
        stills = sorted((f for f in os.listdir(sd) if f.endswith((".png", ".jpg"))),
                        key=lambda f: os.path.getmtime(os.path.join(sd, f)), reverse=True)[:30]
    previews = list_files(os.path.join(P, "out", "previews"), {"mp4"})
    root = None
    try:
        root = plugin_root()
    except Exception:
        pass
    engine_se = list_files(os.path.join(root, "engine", "assets", "se"), {"mp3", "wav"}) if root else []
    bgm_plan = read_json(os.path.join(P, "work", "bgm_plan.json"), None)
    bgm_ui = read_json(os.path.join(P, "work", "totonoumovie_bgm.json"), None)
    st = settings()
    return {
        "name": os.path.basename(P), "path": P, "config": cfg, "title": project_title(P),
        "inputVideo": vid, "media": info, "data": data,
        "cutReview": ei, "cutApprovals": approvals,
        "transcript": transcript_segments(P),
        "outputs": list_files(os.path.join(P, "out"), {"mp4"}), "previews": previews, "stills": stills,
        "assets": {"se": sorted(set(list_files(os.path.join(P, "public", "se"), {"mp3", "wav"}) + engine_se)),
                   "images": list_files(os.path.join(P, "public", "images")),
                   "bgm": list_files(os.path.join(P, "public", "bgm"))},
        "bgmPlan": bgm_plan, "bgm": bgm_ui,
        "hookApplied": os.path.exists(os.path.join(P, "work", "hook_applied.json")),
        "reviewerName": st.get("reviewerName"),
        "humanCheck": read_json(os.path.join(P, "work", "qa_human.json"), None),
    }


# ======================================================================
# プレビュー用の軽い動画・波形
# ======================================================================
PROXY_VER = 2


def proxy_path(src):
    # PROXY_VER を上げると、作り方を変えたときに作り直される
    h = hashlib.md5(f"{src}:{os.path.getmtime(src)}:{PROXY_VER}".encode()).hexdigest()[:16]
    return os.path.join(CACHE_DIR, "proxy", h + ".mp4")


def ensure_proxy(src):
    """ブラウザでなめらかに再生できる軽い動画を裏で作る。できていればそのパスを返す"""
    dst = proxy_path(src)
    if os.path.exists(dst):
        return dst
    with PROXY_LOCK:
        if dst in PROXY_RUNNING:
            return None
        PROXY_RUNNING.add(dst)

    def work():
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        tmp = dst + ".part.mp4"
        info = probe(src)
        vf = "scale=-2:720" if info.get("h", 0) <= info.get("w", 0) else "scale=540:-2"
        # 60fps などの動画は 30fps に落とす（再生の負荷が半分になる。時間はずれない）
        if info.get("fps", 30) > 31:
            vf += ",fps=30"
        # fastdecode: ブラウザでの解読を軽くする／-g 15: シークを速く
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast",
               "-tune", "fastdecode", "-crf", "26", "-g", "15", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
               "-movflags", "+faststart", tmp]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            os.replace(tmp, dst)
        else:
            print("プレビュー用動画の作成に失敗:", r.stderr[-500:], file=sys.stderr)
        with PROXY_LOCK:
            PROXY_RUNNING.discard(dst)

    threading.Thread(target=work, daemon=True).start()
    return None


def waveform(src, per_sec=50):
    """音の大きさ（1秒あたり per_sec 個の 0〜1 の値）"""
    h = hashlib.md5(f"{src}:{os.path.getmtime(src)}:{per_sec}".encode()).hexdigest()[:16]
    cp = os.path.join(CACHE_DIR, "wave", h + ".json")
    if os.path.exists(cp):
        return read_json(cp, {})
    rate = per_sec * 20
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"],
                       capture_output=True)
    import array
    a = array.array("h")
    a.frombytes(r.stdout[: len(r.stdout) // 2 * 2])
    peaks = []
    step = 20
    for i in range(0, len(a), step):
        chunk = a[i:i + step]
        peaks.append(round(max(abs(x) for x in chunk) / 32768, 3) if chunk else 0)
    d = {"perSec": per_sec, "peaks": peaks}
    os.makedirs(os.path.dirname(cp), exist_ok=True)
    json.dump(d, open(cp, "w"))
    return d


# ======================================================================
# トトノちゃんの声（VOICEVOX があれば読み上げ、母音の並びで口を動かす）
# ======================================================================
VOICEVOX_URL = "http://127.0.0.1:50021"
TOTONO_SPEAKER = 8   # VOICEVOX:春日部つむぎ


def visemes_from_query(q):
    """VOICEVOX の audio_query から、口の形の並び [[開始秒, 終了秒, 母音], ...] を作る"""
    t = q.get("prePhonemeLength", 0.1)
    speed = q.get("speedScale", 1.0) or 1.0
    out = []
    for ph in q.get("accent_phrases", []):
        for m in ph.get("moras", []):
            c = (m.get("consonant_length") or 0) / speed
            v = (m.get("vowel_length") or 0) / speed
            out.append([round(t, 3), round(t + c + v, 3), m.get("vowel", "a")])
            t += c + v
        pm = ph.get("pause_mora")
        if pm:
            d = (pm.get("vowel_length") or 0) / speed
            out.append([round(t, 3), round(t + d, 3), "pau"])
            t += d
    return out


def totono_tts(text):
    """読み上げの音声と口の動きを作って、キャッシュのパスを返す。VOICEVOX が無ければ None"""
    import urllib.request
    h = hashlib.md5(f"{TOTONO_SPEAKER}:{text}".encode()).hexdigest()[:16]
    d = os.path.join(CACHE_DIR, "tts")
    wav, meta = os.path.join(d, h + ".wav"), os.path.join(d, h + ".json")
    if os.path.exists(wav) and os.path.exists(meta):
        return h
    try:
        say = text
        for a, b in (("totonoumovie", "ととのうムービー"), ("TotonouMovie", "ととのうムービー"), ("AI", "エーアイ"),
                     ("OK", "オーケー"), ("BGM", "ビージーエム"), ("Claude Code", "クロードコード"), ("YouTube", "ユーチューブ")):
            say = say.replace(a, b)
        q = json.loads(urllib.request.urlopen(urllib.request.Request(
            f"{VOICEVOX_URL}/audio_query?speaker={TOTONO_SPEAKER}&text={urllib.parse.quote(say)}", method="POST"),
            timeout=8).read())
        q["speedScale"] = 1.08
        body = urllib.request.urlopen(urllib.request.Request(
            f"{VOICEVOX_URL}/synthesis?speaker={TOTONO_SPEAKER}", data=json.dumps(q).encode(),
            headers={"Content-Type": "application/json"}, method="POST"), timeout=30).read()
    except Exception:
        return None
    os.makedirs(d, exist_ok=True)
    with open(wav, "wb") as f:
        f.write(body)
    with open(meta, "w", encoding="utf-8") as f:
        json.dump({"visemes": visemes_from_query(q)}, f)
    return h


# ======================================================================
# 裏の作業（エンジンの呼び出し）
# ======================================================================
def engine_job(P, kind, title, steps, on_done=None):
    root = plugin_root()
    real = []
    for entry in steps:
        label, step = entry[0], entry[1]
        if isinstance(step, tuple) and step and step[0] == "E":
            step = pluginmod.engine_cmd(root, step[1], *step[2:])
        real.append((label, step) + tuple(entry[2:]))
    return JOBS.start(P, kind, title, real, env=pluginmod.engine_env(root), cwd=P, on_done=on_done)


def last_json(job, idx=-1):
    outs = job.result.get("outputs") or []
    if not outs:
        return None
    return pluginmod.parse_json_out(outs[idx])


def start_action(P, action, body):
    """画面のボタンから呼ばれる作業"""
    title = project_title(P)
    if action == "still":
        sec = float(body.get("sec", 0))
        out = os.path.join("work", "stills", f"tm_{time.strftime('%H%M%S')}_{sec:.2f}.png")

        def done(job):
            job.result["image"] = out if os.path.exists(os.path.join(P, out)) else None
        return engine_job(P, "still", f"静止画（{sec:.1f}秒）",
                          [("静止画を書き出す", ("E", "render_project.py", "--project", P, "still",
                                                 "--sec", f"{sec:.3f}", "--out", out))], done)
    if action == "preview":
        a, b = float(body["from"]), float(body["to"])

        def done(job):
            d = last_json(job) or {}
            p = None
            for k in ("out", "output", "path", "video"):
                if isinstance(d.get(k), str) and d[k].endswith(".mp4"):
                    p = d[k]
            if not p:
                p = os.path.join(P, "out", "previews", f"preview_{a:g}-{b:g}.mp4")
            job.result["video"] = os.path.relpath(p, P) if os.path.isabs(p) else p
        return engine_job(P, "preview", f"試作（{a:.1f}〜{b:.1f}秒）",
                          [("試作を書き出す", ("E", "render_project.py", "--project", P, "preview",
                                               "--from", f"{a:.3f}", "--to", f"{b:.3f}"))], done)
    if action == "render":
        raw = os.path.join(P, "out", f"{title}_raw.mp4")
        bgm = read_json(os.path.join(P, "work", "totonoumovie_bgm.json"), None) or {}
        use_bgm = bool(bgm.get("enabled") and bgm.get("file") and bgm.get("rightsConfirmed"))
        final = os.path.join(P, "out", f"{title}.mp4")
        voice = os.path.join(P, "out", f"{title}_voice.mp4") if use_bgm else final
        cfg = project_config(P)
        post = ["--input", raw, "--output", voice, "--denoise", "--lufs", "-14"]
        if (cfg.get("design") or {}).get("tone") == "bold" and cfg.get("shorts"):
            post += ["--speech-velocity", "1.1"]
        steps = [("Remotion で書き出す", ("E", "render_project.py", "--project", P, "render",
                                          *(["--concurrency", str(body["concurrency"])] if body.get("concurrency") else []))),
                 ("音声を仕上げる（雑音を減らし -14 LUFS）", ("E", "postprocess_audio.py", *post))]
        if use_bgm:
            steps += [("BGM の計画", ("E", "gen_bgm_plan.py", "--project", P, "--file", bgm["file"], "--voice", voice,
                                      "--level", bgm.get("level") or "quiet", "--rights-confirmed",
                                      "--start-offset", str(bgm.get("startOffset") or 0))),
                      ("BGM を重ねる", ("E", "mix_bgm.py", "--project", P, "--input", voice, "--output", final))]
        # 縦の動画は投稿用のループ版、横の動画は YouTube の字幕ファイル（SRT）も作る（AI に頼んだときと同じ）
        vertical = cfg.get("format") == "9:16"
        loop = os.path.join(P, "out", f"{title}_loopable.mp4")
        if vertical:
            fade = (["--fade-in", "0.05", "--fade-out", "0.3"]
                    if cfg.get("mode") == "voiceover" or (cfg.get("design") or {}).get("tempo") == "tight"
                    else ["--fade-duration", "0.4"])
            steps.append(("投稿用のループ版を作る", ("E", "shorts_loop.py", "--input", final, "--output", loop, *fade)))
        elif "--speech-velocity" not in post:
            steps.append(("字幕ファイル（SRT）を作る", ("E", "gen_srt.py", "--project", P)))
        if body.get("verify", True):
            vargs = ["--project", P, "--video", loop if vertical else final] + (["--voice", voice] if use_bgm else [])
            steps.append(("自動検査（verify_render）", ("E", "verify_render.py", *vargs), {1}))

        def done(job):
            job.result["video"] = os.path.relpath(final, P) if os.path.exists(final) else None
            if vertical and os.path.exists(loop):
                job.result["loopable"] = os.path.relpath(loop, P)
            if job.status == "error" and "verify_render" in (job.result.get("error") or ""):
                job.result["note"] = "書き出しはできましたが、検査で問題が見つかりました（ログを確認してください）"
            elif job.result.get("warnings"):
                job.result["note"] = "書き出しました。検査で確認してほしい点があります（ログを確認してください）"
        return engine_job(P, "render", "書き出し", steps, done)
    if action == "qa":
        return engine_job(P, "qa", "検査（qa_static・lint）",
                          [("字幕の点検（lint）", ("E", "lint_telopdata.py", "--project", P), {1}),
                           ("書き出し前の検査（qa_static）", ("E", "qa_static.py", "--project", P), {1})])
    if action == "contrast":
        return engine_job(P, "contrast", "字幕の読みやすさ補正",
                          [("字幕の読みやすさを補正", ("E", "check_caption_contrast.py", "--project", P, "--apply"))])
    if action == "cut_review":
        return engine_job(P, "cut_review", "カット候補を作り直す（review）",
                          [("候補表を作る", ("E", "gen_cut_plan.py", "review", "--project", P))])
    if action == "cut_clips":
        return engine_job(P, "cut_clips", "カットの確認用クリップ",
                          [("確認用クリップを作る", ("E", "gen_cut_review_clips.py", "--project", P, "--include-silence"))])
    if action == "cut_apply":
        ids = [str(x) for x in body.get("ids") or []]
        reviewer = body.get("reviewer") or settings().get("reviewerName")
        if not reviewer:
            raise ValueError("承認する人の名前（reviewerName）が未設定です")
        ei = read_json(os.path.join(P, "work", "edit_instructions.json"), {}) or {}
        plan_hash = ei.get("planHash")
        if not plan_hash:
            raise ValueError("カット候補表（review）がありません。先に「候補を作り直す」を実行してください")
        args = ["approve", "--project", P, "--plan-hash", plan_hash, "--reviewer", reviewer]
        for i in ids:
            args += ["--candidate-id", i]
        if not ids:
            args.append("--allow-empty")
        steps = []
        if reviewer and not settings().get("reviewerName"):
            steps.append(("名前を設定に保存", ("E", "tm_settings.py", "set", "reviewerName", reviewer)))
        steps += [("承認を記録（approve）", ("E", "gen_cut_plan.py", *args)),
                  ("カットを反映（apply）", ("E", "gen_cut_plan.py", "apply", "--project", P))]

        def done(job):
            job.result["apply"] = last_json(job)
        return engine_job(P, "cut_apply", f"カットの承認と反映（{len(ids)}件）", steps, done)
    if action == "jumpcut_zoom":
        return engine_job(P, "zoom", "寄りの交互切替を作り直す",
                          [("交互ズーム", ("E", "gen_jumpcut_zoom.py", "--project", P))])
    raise ValueError(f"不明な操作です: {action}")


def copy_missing_se(P, items):
    """画面で選んだ効果音が public/se/ に無ければ、同梱の効果音からコピーする（書き出しで見つからないのを防ぐ）"""
    try:
        src_dir = os.path.join(plugin_root(), "engine", "assets", "se")
    except Exception:
        return
    dst_dir = os.path.join(P, "public", "se")
    for it in items:
        name = os.path.basename(str(it.get("file") or it.get("sfx") or ""))
        if not name or os.path.exists(os.path.join(dst_dir, name)):
            continue
        if os.path.exists(os.path.join(src_dir, name)):
            os.makedirs(dst_dir, exist_ok=True)
            shutil.copy2(os.path.join(src_dir, name), os.path.join(dst_dir, name))


# ======================================================================
# Mac のファイル選択ダイアログ
# ======================================================================
def choose_path(kind, prompt):
    if sys.platform != "darwin":
        # Windows など：Python 付属の tkinter のダイアログを別プロセスで出す
        code = ("import tkinter as tk, tkinter.filedialog as fd, sys;"
                "r=tk.Tk(); r.withdraw(); r.attributes('-topmost', True);"
                f"p=fd.{'askdirectory' if kind == 'folder' else 'askopenfilename'}(title=sys.argv[1]);"
                "print(p or '')")
        r = subprocess.run([sys.executable, "-c", code, prompt], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=600)
        if r.returncode != 0:
            raise RuntimeError("ファイル選択ダイアログを出せませんでした。パスを直接入力してください")
        return r.stdout.strip() or None
    what = "folder" if kind == "folder" else "file"
    script = (f'set p to POSIX path of (choose {what} with prompt "{prompt}")\n'
              'return p')
    r = subprocess.run(["osascript", "-e", 'tell application "System Events" to activate', "-e", script],
                       capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        return None
    return r.stdout.strip()


def reveal(path):
    """Finder（Windows はエクスプローラー）でファイルの場所を開く"""
    path = os.path.normpath(path)
    if sys.platform == "darwin":
        subprocess.run(["open", "-R", path])
    elif os.name == "nt":
        subprocess.run(["explorer", "/select,", path] if os.path.isfile(path) else ["explorer", path])
    else:
        subprocess.run(["xdg-open", path if os.path.isdir(path) else os.path.dirname(path)])


# ======================================================================
# HTTP サーバー
# ======================================================================
class Handler(BaseHTTPRequestHandler):
    server_version = "totonoumovie/1.0"

    def log_message(self, fmt, *args):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, ctype=None, cache=False):
        """Range 対応のファイル送信（動画のシークに必要）"""
        size = os.path.getsize(path)
        ctype = ctype or mimetypes.guess_type(path)[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        start, end, code = 0, size - 1, 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
                code = 206
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "max-age=600" if cache else "no-store")
        self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start)
                remain = length
                while remain > 0:
                    chunk = f.read(min(1 << 20, remain))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remain -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def parsed(self):
        path = self.path
        try:
            path = path.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        u = urllib.parse.urlparse(path)
        return u, dict(urllib.parse.parse_qsl(u.query))

    def read_body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def project_file(self, P, rel):
        """プロジェクト内のファイルだけを返す（外へ出るパスは拒否）"""
        full = os.path.realpath(os.path.join(P, rel))
        if not full.startswith(P + os.sep):
            raise PermissionError("プロジェクトの外は開けません")
        return full

    # ---- GET ----
    def do_GET(self):
        u, q = self.parsed()
        try:
            if u.path in ("/", "/index.html"):
                return self.send_file(os.path.join(STATIC_DIR, "index.html"), "text/html; charset=utf-8")
            if u.path.startswith("/static/"):
                f = os.path.realpath(os.path.join(STATIC_DIR, u.path[len("/static/"):]))
                if not f.startswith(STATIC_DIR) or not os.path.isfile(f):
                    return self.send_json({"error": "not found"}, 404)
                return self.send_file(f)
            if u.path == "/api/status":
                st = settings()
                d = {"workspace": workspace(), "cloudSync": cloud_sync_folder(workspace()), "settingsFileExists": st.get("_settingsFileExists"),
                     "reviewerName": st.get("reviewerName"), "claude": agentmod.claude_bin()}
                try:
                    root = plugin_root()
                    d["plugin"] = pluginmod.plugin_info(root)
                except pluginmod.PluginNotFound as e:
                    d["pluginError"] = str(e)
                return self.send_json(d)
            if u.path == "/api/projects":
                return self.send_json({"workspace": workspace(), "projects": list_projects()})
            if u.path == "/api/project":
                P = resolve_project(q.get("p"))
                return self.send_json(project_payload(P))
            if u.path == "/api/video":
                P = resolve_project(q.get("p"))
                src = input_video_path(P)
                if not src:
                    return self.send_json({"error": "元動画が見つかりません"}, 404)
                if q.get("orig") != "1":
                    px = ensure_proxy(src)
                    if px:
                        return self.send_file(px, "video/mp4", cache=True)
                return self.send_file(src)
            if u.path == "/api/frame":
                # 動画の1コマ（再生の準備ができる前の表示用）
                P = resolve_project(q.get("p"))
                src = input_video_path(P)
                t = float(q.get("t", 0) or 0)
                h = hashlib.md5(f"{src}:{os.path.getmtime(src)}:{t:.2f}".encode()).hexdigest()[:16]
                out = os.path.join(CACHE_DIR, "frame", h + ".jpg")
                if not os.path.exists(out):
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", src, "-frames:v", "1",
                                    "-vf", "scale=-2:720", "-q:v", "4", out], capture_output=True)
                return self.send_file(out, "image/jpeg", cache=True)
            if u.path == "/api/proxy_status":
                P = resolve_project(q.get("p"))
                src = input_video_path(P)
                ready = bool(src and os.path.exists(proxy_path(src)))
                if src and not ready:
                    ensure_proxy(src)
                return self.send_json({"ready": ready})
            if u.path == "/api/waveform":
                P = resolve_project(q.get("p"))
                wav = os.path.join(P, "work", "audio.wav")
                src = wav if os.path.exists(wav) else input_video_path(P)
                return self.send_json(waveform(src) if src else {"perSec": 50, "peaks": []})
            if u.path == "/api/pfile":
                P = resolve_project(q.get("p"))
                return self.send_file(self.project_file(P, q.get("path", "")))
            if u.path == "/api/afile":
                # AI が見せたい画像・動画（プロジェクト・作業フォルダ・ホーム配下のメディアだけ）
                full = os.path.realpath(q.get("path", ""))
                home = os.path.realpath(os.path.expanduser("~"))
                ext = full.lower().rsplit(".", 1)[-1]
                ws = os.path.realpath(workspace())
                inside = full.startswith(home + os.sep) or full.startswith(ws + os.sep)
                if not inside or ext not in IMAGE_EXT | VIDEO_EXT | AUDIO_EXT:
                    return self.send_json({"error": "開けないファイルです"}, 403)
                return self.send_file(full)
            if u.path == "/api/sefile":
                root = plugin_root()
                name = os.path.basename(q.get("name", ""))
                P = q.get("p")
                for d in ([os.path.join(resolve_project(P), "public", "se")] if P else []) + \
                         [os.path.join(root, "engine", "assets", "se")]:
                    if os.path.exists(os.path.join(d, name)):
                        return self.send_file(os.path.join(d, name), cache=True)
                return self.send_json({"error": "not found"}, 404)
            if u.path == "/api/video_check":
                # 使い方動画が再生できないとき、理由を調べる（ブラウザからはサイトの応答が読めないため、ここで確かめる）
                url = q.get("url", "")
                if not url.startswith("https://totonoumovie.aisys.earth/"):
                    return self.send_json({"error": "対象外の URL です"}, 400)
                import urllib.request
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=8) as r:
                        return self.send_json({"status": r.status, "length": int(r.headers.get("Content-Length") or 0)})
                except urllib.error.HTTPError as e:
                    return self.send_json({"status": e.code})
                except Exception as e:   # つながらない（回線・サイトの不調）
                    return self.send_json({"status": -1, "reason": str(e)[:200]})
            if u.path == "/api/tts":
                h = totono_tts(q.get("text", "")[:400])
                if not h:
                    return self.send_json({"audio": None})
                meta = read_json(os.path.join(CACHE_DIR, "tts", h + ".json"), {}) or {}
                return self.send_json({"audio": "/api/tts_audio?h=" + h, "visemes": meta.get("visemes", [])})
            if u.path == "/api/tts_audio":
                h = re.sub(r"[^0-9a-f]", "", q.get("h", ""))
                return self.send_file(os.path.join(CACHE_DIR, "tts", h + ".wav"), "audio/wav", cache=True)
            if u.path == "/api/jobs":
                P = resolve_project(q["p"]) if q.get("p") else None
                return self.send_json({"jobs": JOBS.list(P)})
            if u.path == "/api/job":
                j = JOBS.get(q.get("id"))
                return self.send_json(j.to_dict() if j else {"error": "not found"}, 200 if j else 404)
            if u.path == "/api/prompts":
                return self.send_json(agentmod.load_prompts())
            if u.path == "/api/runs":
                P = resolve_project(q["p"]) if q.get("p") else None
                return self.send_json({"runs": AGENTS.list(P)})
            if u.path == "/api/run":
                r = AGENTS.get(q.get("id"))
                if not r:
                    return self.send_json({"error": "not found"}, 404)
                return self.send_json(r.to_dict(int(q.get("since", 0) or 0)))
            return self.send_json({"error": "not found"}, 404)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self.send_json({"error": str(e)}, 500)

    # ---- POST ----
    def do_POST(self):
        u, _ = self.parsed()
        try:
            b = self.read_body()
            if u.path == "/api/data":
                P = resolve_project(b.get("p"))
                key = b.get("key")
                if key not in tsdata.DATA_FILES:
                    raise ValueError("不明なデータです")
                if key == "cut":
                    raise ValueError("カットは承認の仕組みで反映します（直接は書き換えません）")
                tpl = None
                try:
                    tpl = os.path.join(plugin_root(), "template")
                except Exception:
                    pass
                items = b.get("items") or []
                changed = tsdata.write_items(P, key, items, tpl)
                if key in ("se", "chapterCard"):
                    copy_missing_se(P, items)
                return self.send_json({"ok": True, "changed": changed})
            if u.path == "/api/bgm":
                P = resolve_project(b.get("p"))
                d = {k: b.get(k) for k in ("enabled", "file", "level", "startOffset", "rightsConfirmed")}
                with open(os.path.join(P, "work", "totonoumovie_bgm.json"), "w", encoding="utf-8") as f:
                    json.dump(d, f, ensure_ascii=False, indent=2)
                return self.send_json({"ok": True})
            if u.path == "/api/config":
                # project-config.json のごく一部（タイトル・字幕の高さなど）を直す
                P = resolve_project(b.get("p"))
                cfgp = os.path.join(P, "src", "project-config.json")
                cfg = read_json(cfgp, {}) or {}
                for k, v in (b.get("set") or {}).items():
                    cur = cfg
                    parts = k.split(".")
                    for part in parts[:-1]:
                        cur = cur.setdefault(part, {})
                    cur[parts[-1]] = v
                with open(cfgp, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
                return self.send_json({"ok": True})
            if u.path == "/api/action":
                P = resolve_project(b.get("p"))
                if JOBS.running_for(P) and b.get("action") in ("render", "cut_apply"):
                    raise RuntimeError("このプロジェクトで別の作業が動いています。終わってから実行してください")
                job = start_action(P, b.get("action"), b)
                return self.send_json({"job": job.to_dict()})
            if u.path == "/api/job_cancel":
                return self.send_json({"ok": JOBS.cancel(b.get("id"))})
            if u.path == "/api/add_image":
                # 持ち込みの画像を public/images/ にコピーする
                P = resolve_project(b.get("p"))
                src = os.path.expanduser(b.get("path") or "")
                if not os.path.isfile(src):
                    raise FileNotFoundError("画像が見つかりません")
                d = os.path.join(P, "public", "images")
                os.makedirs(d, exist_ok=True)
                name = os.path.basename(src)
                shutil.copy2(src, os.path.join(d, name))
                return self.send_json({"ok": True, "file": name})
            if u.path == "/api/choose":
                return self.send_json({"path": choose_path(b.get("kind", "file"), b.get("prompt") or "選んでください")})
            if u.path == "/api/reveal":
                path = b.get("path")
                if b.get("p"):
                    path = os.path.join(resolve_project(b["p"]), path or "")
                reveal(path)
                return self.send_json({"ok": True})
            if u.path == "/api/prompts":
                agentmod.save_prompts(b)
                return self.send_json({"ok": True})
            if u.path == "/api/run_start":
                return self.send_json(self.run_start(b))
            if u.path == "/api/run_answer":
                r = AGENTS.answer(b.get("id"), b.get("text") or "")
                return self.send_json({"run": {k: v for k, v in r.to_dict().items() if k != "events"}})
            if u.path == "/api/run_cut_answer":
                return self.send_json(self.run_cut_answer(b))
            if u.path == "/api/run_stop":
                r = AGENTS.stop(b.get("id"))
                return self.send_json({"ok": bool(r)})
            return self.send_json({"error": "not found"}, 404)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self.send_json({"error": str(e)}, 400)

    def run_start(self, b):
        kind = b.get("kind")
        prompts = agentmod.load_prompts()
        vars_ = {}
        P = None
        if kind in ("create", "voiceover"):
            video = os.path.expanduser(b.get("video") or "")
            if not os.path.exists(video):
                raise FileNotFoundError("動画（声）のファイルが見つかりません")
            vars_["video"] = video
            if kind == "voiceover":
                mats = os.path.expanduser(b.get("materials") or "")
                if not os.path.isdir(mats):
                    raise FileNotFoundError("素材フォルダが見つかりません")
                vars_["materials"] = mats
            title = ("AIで作る：" if kind == "create" else "アフレコ：") + os.path.basename(video)
        elif kind in ("fix", "free"):
            P = resolve_project(b.get("p"))
            vars_["project"] = P
            vars_["request"] = b.get("request") or ""
            if not vars_["request"].strip():
                raise ValueError("依頼の内容を書いてください")
            title = ("AIに直してもらう：" if kind == "fix" else "AIに依頼：") + os.path.basename(P)
        else:
            raise ValueError("不明な種類です")
        prompt = build = agentmod.build_prompt(kind, prompts, vars_, b.get("presets") or [], b.get("extra") or "")
        if b.get("dryRun"):
            return {"prompt": build}
        os.makedirs(workspace(), exist_ok=True)
        ws = workspace()
        system_extra = (f"\n\n## 作業フォルダ（このアプリの決まり）\n- 作業フォルダは {ws} です。新しいプロジェクトは、"
                        f"init_project.py に --output \"{ws}/<プロジェクト名>\" を付けて、必ずこのフォルダの中に作ってください"
                        "（TotonouMovie の設定 workspaceDir ではなく、こちらを使う）。")
        r = AGENTS.start(kind, title, ws, prompt, project=P, system_extra=system_extra)
        return {"run": {k: v for k, v in r.to_dict().items() if k != "events"}}

    def run_cut_answer(self, b):
        """AI が止まったカット承認を、画面で人が承認→反映し、結果を AI に返す"""
        r = AGENTS.get(b.get("id"))
        if not r or not r.project:
            raise ValueError("プロジェクトが分かりません")
        P = r.project
        ids = [str(x) for x in b.get("ids") or []]
        job = start_action(P, "cut_apply", {"ids": ids, "reviewer": b.get("reviewer")})
        note = b.get("note") or ""

        def wait_and_resume():
            while job.status in ("queued", "running"):
                time.sleep(1)
            if job.status == "done":
                res = job.result.get("apply") or {}
                msg = (f"カットの承認と反映を画面で行いました。承認した候補ID: {', '.join(ids) if ids else 'なし（0件）'}。\n"
                       f"apply の結果: {json.dumps(res, ensure_ascii=False)[:3000]}\n")
            else:
                msg = ("画面でのカットの承認・反映が失敗しました。\n" + "\n".join(job.log[-30:]) + "\n原因を調べて対応してください。\n")
            if note.strip():
                msg += "\nユーザーからの補足: " + note.strip()
            msg += "\nスキルの手順の続きを進めてください。"
            try:
                AGENTS.answer(r.id, msg)
            except Exception as e:  # noqa: BLE001
                r.add("system", f"続きを送れませんでした: {e}")

        threading.Thread(target=wait_and_resume, daemon=True).start()
        return {"job": job.to_dict()}


def main():
    ap = argparse.ArgumentParser(description="TotonouMovie の動画を作る・直すブラウザ編集アプリ")
    ap.add_argument("folder", nargs="?", default=None, help="作業フォルダ（省略時は起動したフォルダ）")
    ap.add_argument("--workspace", default=None, help="作業フォルダ（folder と同じ。互換のため残す）")
    ap.add_argument("--port", type=int, default=8780)
    ap.add_argument("--no-open", action="store_true", help="ブラウザを自動で開かない")
    args = ap.parse_args()
    # 作業フォルダは「起動したフォルダ」（引数で指定もできる）。プロジェクトはこの中に作る
    STATE["workspace_override"] = os.path.abspath(os.path.expanduser(args.folder or args.workspace or os.getcwd()))
    os.makedirs(CACHE_DIR, exist_ok=True)
    try:
        root = plugin_root()
        print(f"TotonouMovie プラグイン: {root}")
    except pluginmod.PluginNotFound as e:
        print("⚠ " + str(e))
    print(f"作業フォルダ: {workspace()}")
    if cloud_sync_folder(workspace()):
        print("⚠ 作業フォルダがクラウド同期フォルダの中です。書き出し中に同期とぶつかって止まることがあります")
    port = args.port
    for _ in range(20):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            port += 1
    else:
        print("使えるポートが見つかりません")
        sys.exit(1)
    url = f"http://127.0.0.1:{port}/"
    print(f"totonoumovie を起動しました → {url}（終了は Ctrl+C）")
    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n終了します")


if __name__ == "__main__":
    main()
