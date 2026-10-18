# -*- coding: utf-8 -*-
"""
拠点：totonoumovie の本体フォルダ1つに、動画・自分好み・自作スキルを全部まとめる

    <拠点>/                 ← totonoumovie 本体（このフォルダごと別の場所へ移しても動く）
      projects/             動画のプロジェクト（TotonouMovie の作業フォルダ）
      my/config/            TotonouMovie の設定フォルダ（TOTONOU_CONFIG_DIR）
                            ＝ マイスタイル（my-styles）・設定（settings.json）・表記辞書・自分の効果音（se-library）
      my/app/               このアプリの記録（いつもの指示＝prompts.json、AI の作業＝runs）
      .claude/settings.json 17スキル（totonou-movie）をこの拠点でだけ有効にする＋起動時の自己修復
      .claude/skills/       自作スキル（グローバルの ~/.claude/skills には作らない）
      CLAUDE.md             Claude Code だけで編集するときの案内

- 絶対パスはどこにも「正」として持たない。起動のたびに今の場所から決め直し、前回と場所が変わっていたら
  設定の workspaceDir とプロジェクト内の記録のパスを書き換える（Dropbox などへ移しても、そのまま使える）
- v2 まで（Claude Code だけ）の設定フォルダ（~/.config/totonou-movie）と作業フォルダのプロジェクトを引き継ぐ
- 再生用の軽い動画・波形のキャッシュだけは、大きくて作り直せるので ~/.totonoumovie/cache（パソコンごと）に置く
"""
import json
import os
import shutil
import time

BASE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
PROJECTS_DIR = os.path.join(BASE, "projects")
MY_DIR = os.path.join(BASE, "my")
CONFIG_DIR = os.path.join(MY_DIR, "config")
APP_USER_DIR = os.path.join(MY_DIR, "app")
STATE_PATH = os.path.join(MY_DIR, "state.json")
SKILLS_DIR = os.path.join(BASE, ".claude", "skills")
LOCAL_CACHE_DIR = os.path.expanduser("~/.totonoumovie/cache")

PLUGIN_NAME = "totonou-movie"
CONFIG_ENV = "TOTONOU_CONFIG_DIR"
# 拠点に移したあとも、引き継ぎの元として見る場所（アプリを起動する前の環境変数・既定の場所）
LEGACY_CONFIG_DIR = os.path.expanduser(os.environ.get(CONFIG_ENV, "").strip() or "~/.config/totonou-movie")
LEGACY_APP_DIR = os.path.expanduser("~/.totonoumovie")
USER_SETTINGS = os.path.expanduser("~/.claude/settings.json")
# プロジェクト内でパスを書き換えてよいファイル（記録・設定だけ。動画や node_modules には触れない）
REWRITE_DIRS = ("src", "work", "data")
REWRITE_EXT = (".json", ".ts", ".md", ".txt", ".srt")
REWRITE_MAX_BYTES = 5 * 1024 * 1024


# ======================================================================
# 小さな道具
# ======================================================================
def _read_json(path, default=None):
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def load_state():
    return _read_json(STATE_PATH, {}) or {}


def save_state(state):
    _write_json(STATE_PATH, state)


def is_project(path):
    return os.path.exists(os.path.join(path, "src", "project-config.json"))


def _same(a, b):
    return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))


# ======================================================================
# 起動時の準備（引き継ぎ・自己修復）
# ======================================================================
def prepare():
    """拠点のフォルダを用意し、設定フォルダをこの拠点に向ける。起動のたびに呼ぶ。何をしたかの一覧を返す"""
    notes = []
    for d in (PROJECTS_DIR, CONFIG_DIR, APP_USER_DIR, SKILLS_DIR, LOCAL_CACHE_DIR):
        os.makedirs(d, exist_ok=True)
    state = load_state()

    # 1) v2 までの設定フォルダを引き継ぐ（初回だけ。元は消さずに残す）
    if not state.get("migratedConfig"):
        legacy_ws = None
        if os.path.isdir(LEGACY_CONFIG_DIR) and not _same(LEGACY_CONFIG_DIR, CONFIG_DIR):
            legacy_ws = (_read_json(os.path.join(LEGACY_CONFIG_DIR, "settings.json"), {}) or {}).get("workspaceDir")
            n = _copy_missing(LEGACY_CONFIG_DIR, CONFIG_DIR)
            if n:
                notes.append(f"前の設定（{LEGACY_CONFIG_DIR}）から {n} 個のファイルを引き継ぎました")
        state["migratedConfig"] = {"from": LEGACY_CONFIG_DIR, "at": time.strftime("%Y-%m-%d %H:%M:%S")}
        if legacy_ws:
            state["legacyWorkspace"] = os.path.expanduser(legacy_ws)

    # 2) 前の版のアプリの記録（いつもの指示・AI の作業）を引き継ぐ
    if not state.get("migratedApp"):
        old_prompts = os.path.join(LEGACY_APP_DIR, "prompts.json")
        new_prompts = os.path.join(APP_USER_DIR, "prompts.json")
        if os.path.exists(old_prompts) and not os.path.exists(new_prompts):
            shutil.copy2(old_prompts, new_prompts)
            notes.append("前の版のプロンプトといつもの指示を引き継ぎました")
        old_runs = os.path.join(LEGACY_APP_DIR, "runs")
        if os.path.isdir(old_runs):
            _copy_missing(old_runs, os.path.join(APP_USER_DIR, "runs"))
        state["migratedApp"] = True

    # 3) TotonouMovie（エンジン・claude）にこの拠点の設定フォルダを使わせる
    os.environ[CONFIG_ENV] = CONFIG_DIR

    # 4) 拠点の場所が前回と違う（フォルダごと移した）なら、記録の中のパスを書き換える
    last = state.get("base")
    if last and not _same(last, BASE):
        n = 0
        for name in os.listdir(PROJECTS_DIR):
            P = os.path.join(PROJECTS_DIR, name)
            if is_project(P):
                n += rewrite_paths(P, last.rstrip("/\\"), BASE)
        notes.append(f"拠点の場所が変わったので、プロジェクトの記録のパスを直しました（{n} ファイル）")
    state["base"] = BASE

    # 5) 設定の作業フォルダを、いつも拠点の projects/ に向ける（Claude Code だけで使うときも同じ場所に作られる）
    heal_settings()
    save_state(state)
    return notes


def heal_settings():
    p = os.path.join(CONFIG_DIR, "settings.json")
    data = _read_json(p, None)
    if data is None and os.path.exists(p):
        return   # 壊れている設定は触らない（エンジン側が退避して直す）
    data = data or {}
    if data.get("workspaceDir") != PROJECTS_DIR:
        data["workspaceDir"] = PROJECTS_DIR
        _write_json(p, data)


def _copy_missing(src, dst):
    """src の中身を dst へ写す。dst に同じ名前があるものは上書きしない。写した数を返す"""
    n = 0
    for root, dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        out = os.path.join(dst, rel) if rel != "." else dst
        os.makedirs(out, exist_ok=True)
        for f in files:
            if f in (".DS_Store",):
                continue
            t = os.path.join(out, f)
            if not os.path.exists(t):
                shutil.copy2(os.path.join(root, f), t)
                n += 1
    return n


def rewrite_paths(P, old, new):
    """プロジェクトの記録・設定ファイルの中の old（フォルダの絶対パス）を new に置き換える。書き換えた数を返す"""
    if not old or old == new:
        return 0
    variants = [(old, new), (old.replace("\\", "/"), new.replace("\\", "/")),
                (json.dumps(old)[1:-1], json.dumps(new)[1:-1])]
    n = 0
    for sub in REWRITE_DIRS:
        d = os.path.join(P, sub)
        if not os.path.isdir(d):
            continue
        for root, dirs, files in os.walk(d):
            dirs[:] = [x for x in dirs if x != "node_modules"]
            for f in files:
                if not f.endswith(REWRITE_EXT):
                    continue
                fp = os.path.join(root, f)
                try:
                    if os.path.getsize(fp) > REWRITE_MAX_BYTES:
                        continue
                    text = open(fp, encoding="utf-8").read()
                except Exception:
                    continue
                out = text
                for a, b in variants:
                    out = out.replace(a, b)
                if out != text:
                    with open(fp, "w", encoding="utf-8") as fw:
                        fw.write(out)
                    n += 1
    return n


# ======================================================================
# v2 の作業フォルダにあるプロジェクト
# ======================================================================
def legacy_dirs():
    state = load_state()
    cands = [state.get("legacyWorkspace"),
             (_read_json(os.path.join(LEGACY_CONFIG_DIR, "settings.json"), {}) or {}).get("workspaceDir"),
             "~/Movies/totonou", "~/Videos/totonou"]
    out = []
    for c in cands:
        if not c:
            continue
        c = os.path.expanduser(c)
        if os.path.isdir(c) and not _same(c, PROJECTS_DIR) and not any(_same(c, x) for x in out):
            out.append(c)
    return out


def legacy_projects():
    out = []
    for d in legacy_dirs():
        for name in sorted(os.listdir(d)):
            P = os.path.join(d, name)
            if is_project(P):
                cfg = _read_json(os.path.join(P, "src", "project-config.json"), {}) or {}
                out.append({"name": name, "path": P, "title": cfg.get("title") or name, "dir": d,
                            "mode": "voiceover" if cfg.get("voiceover") else (cfg.get("mode") or "long")})
    return out


def move_legacy(paths):
    """v2 の作業フォルダのプロジェクトを拠点の projects/ へ移す（中の記録のパスも直す）"""
    allowed = {p["path"] for p in legacy_projects()}
    moved = []
    for src in paths:
        if src not in allowed:
            raise ValueError(f"引き継げるプロジェクトではありません: {src}")
        name = os.path.basename(src.rstrip("/\\"))
        dst = os.path.join(PROJECTS_DIR, name)
        i = 2
        while os.path.exists(dst):
            dst = os.path.join(PROJECTS_DIR, f"{name}-{i}")
            i += 1
        shutil.move(src, dst)
        rewrite_paths(dst, src.rstrip("/\\"), dst)
        moved.append(dst)
    return moved


# ======================================================================
# 17スキル（プラグイン）を有効にする範囲
# ======================================================================
def plugin_key():
    """installed_plugins.json の "totonou-movie@<マーケット>" の名前"""
    reg = _read_json(os.path.expanduser("~/.claude/plugins/installed_plugins.json"), {}) or {}
    for key in (reg.get("plugins") or {}):
        if key.split("@")[0] == PLUGIN_NAME:
            return key
    return None


def plugin_scope():
    """{"key", "global": グローバルで有効か, "base": 拠点で有効か}"""
    key = plugin_key()
    user = _read_json(USER_SETTINGS, {}) or {}
    base = _read_json(os.path.join(BASE, ".claude", "settings.json"), {}) or {}
    g = bool(key) and (user.get("enabledPlugins") or {}).get(key) is True
    b = bool(key) and (base.get("enabledPlugins") or {}).get(key) is True
    return {"key": key, "global": g, "base": b}


def set_plugin_scope(global_on):
    """グローバル（~/.claude/settings.json）での有効・無効を切り替える。拠点では常に有効にしておく"""
    key = plugin_key()
    if not key:
        raise RuntimeError("TotonouMovie プラグインが見つかりません")
    ensure_base_settings(key)
    if os.path.exists(USER_SETTINGS):
        data = _read_json(USER_SETTINGS, None)
        if data is None:
            raise RuntimeError("~/.claude/settings.json を読めないため、変更をやめました")
        shutil.copy2(USER_SETTINGS, USER_SETTINGS + ".totonoumovie.bak")
    else:
        data = {}
    data.setdefault("enabledPlugins", {})[key] = bool(global_on)
    _write_json(USER_SETTINGS, data)
    return plugin_scope()


def ensure_base_settings(key=None):
    """拠点の .claude/settings.json に、プラグインの有効化（マーケットの名前が違う人向け）を書き足す"""
    key = key or plugin_key()
    if not key:
        return
    p = os.path.join(BASE, ".claude", "settings.json")
    data = _read_json(p, {}) or {}
    ep = data.setdefault("enabledPlugins", {})
    if ep.get(key) is not True:
        ep[key] = True
        _write_json(p, data)


def claude_settings_arg():
    """claude -p に渡す --settings（グローバルで無効にしてあっても、アプリの作業では必ず有効にする）"""
    key = plugin_key()
    return json.dumps({"enabledPlugins": {key: True}}) if key else None
