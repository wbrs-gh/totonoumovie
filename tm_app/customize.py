# -*- coding: utf-8 -*-
"""
「自分好み」の画面の読み書き（マイスタイル・スキル・表記辞書・設定・自分の効果音）

- どれも TotonouMovie（Claude Code のプラグイン）と同じファイルを読み書きする。
  Claude Code だけで育てたものも画面に出て、画面で育てたものも Claude Code から使える
- マイスタイル：<設定フォルダ>/my-styles/<名前>.json（エンジン tm_style.py と同じ形式）
- 自作スキル：<拠点>/.claude/skills/<名前>/SKILL.md（拠点で動く Claude Code だけが読む）
"""
import json
import os
import re
import shutil

from . import home
from . import plugin as pluginmod

STYLE_DIRNAME = "my-styles"
STYLE_SCHEMA = 1
MAX_NOTES_LEN = 2000
SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
BAD_STYLE_CHARS = set('/\\:*?"<>|')
MODE_LABEL = {"shorts": "ショート", "long": "ロング", "voiceover": "アフレコ"}


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


def _engine(script, *args):
    """エンジンのスクリプトを動かし、最後の JSON を返す。失敗したら日本語のメッセージで例外"""
    root = pluginmod.find_plugin_root()
    code, out, err = pluginmod.run_engine(root, script, *args, timeout=180)
    res = pluginmod.parse_json_out(out)
    if code != 0 or res is None:
        msg = (err or out or "").strip().splitlines()
        raise RuntimeError(msg[-1] if msg else f"{script} が失敗しました")
    return res


# ======================================================================
# マイスタイル
# ======================================================================
def style_dir():
    return os.path.join(home.CONFIG_DIR, STYLE_DIRNAME)


def _style_path(name):
    name = (name or "").strip()
    if not name or name.startswith(".") or any(c in BAD_STYLE_CHARS for c in name) or len(name) > 40:
        raise ValueError(f"マイスタイルの名前が使えません: {name}")
    return os.path.join(style_dir(), name + ".json")


def list_styles():
    out = []
    d = style_dir()
    if os.path.isdir(d):
        for fn in os.listdir(d):
            if not fn.endswith(".json"):
                continue
            s = _read_json(os.path.join(d, fn))
            if not isinstance(s, dict) or s.get("schemaVersion") != STYLE_SCHEMA:
                continue
            out.append(_style_brief(fn[:-5], s))
    out.sort(key=lambda x: x["updatedAt"] or "", reverse=True)
    return out


def _style_brief(name, s):
    d = s.get("design") or {}
    a = s.get("audio") or {}
    return {"name": name, "mode": s.get("mode"), "modeLabel": MODE_LABEL.get(s.get("mode"), s.get("mode") or "?"),
            "updatedAt": s.get("updatedAt") or "", "tone": d.get("tone"), "tempo": d.get("tempo"),
            "captionStyle": d.get("captionStyle"), "sePreset": a.get("sePreset"), "seEnabled": a.get("seEnabled"),
            "skin": (s.get("skinRetouch") or {}).get("strength"), "chapters": s.get("chapters") or {},
            "imageLayout": (s.get("images") or {}).get("preferredLayout"),
            "bgm": (s.get("bgm") or {}).get("fileName") if isinstance(s.get("bgm"), dict) else None,
            "glossary": s.get("glossary") or [], "notes": s.get("notes") or ""}


def save_style_from_project(project, name, notes=None, overwrite=False):
    """プロジェクト（今の版でも v2 で作った動画でも）の見た目を、マイスタイルとして保存する（エンジンで）"""
    _style_path(name)
    args = ["save", "--project", project, "--name", name.strip()]
    if notes is not None:
        args += ["--notes", notes]
    if overwrite:
        args.append("--overwrite")
    return _engine("tm_style.py", *args)


def update_style_notes(name, notes):
    """マイスタイルのメモ（自由記述の編集のルール）だけを書き換える"""
    p = _style_path(name)
    s = _read_json(p)
    if not isinstance(s, dict):
        raise FileNotFoundError(f"マイスタイルが見つかりません: {name}")
    notes = (notes or "").strip()
    if len(notes) > MAX_NOTES_LEN:
        raise ValueError(f"メモは {MAX_NOTES_LEN} 字以内にしてください（今は {len(notes)} 字）")
    s["notes"] = notes
    _write_json(p, s)
    return _style_brief(name, s)


def rename_style(name, new_name):
    src, dst = _style_path(name), _style_path(new_name)
    if not os.path.exists(src):
        raise FileNotFoundError(f"マイスタイルが見つかりません: {name}")
    if os.path.exists(dst):
        raise FileExistsError(f"同じ名前のマイスタイルがあります: {new_name}")
    s = _read_json(src) or {}
    s["name"] = new_name.strip()
    _write_json(dst, s)
    os.remove(src)


def delete_style(name):
    p = _style_path(name)
    if not os.path.exists(p):
        raise FileNotFoundError(f"マイスタイルが見つかりません: {name}")
    os.remove(p)


# ======================================================================
# スキル（17スキル＋自作スキル）
# ======================================================================
def _frontmatter(path):
    """SKILL.md の先頭の name / description を読む（簡易。複数行の description にも対応）"""
    try:
        text = open(path, encoding="utf-8").read()
    except Exception:
        return {}, ""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if not m:
        return {}, text
    meta, key = {}, None
    for line in m.group(1).splitlines():
        km = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
        if km:
            key = km.group(1)
            meta[key] = km.group(2).strip().strip('"').strip("'")
        elif key and line.startswith((" ", "\t")):
            meta[key] = (meta[key] + " " + line.strip()).strip()
    for k, v in meta.items():
        if v in (">", "|", ">-", "|-"):
            meta[k] = ""
    return meta, m.group(2)


def list_skills():
    out = {"plugin": [], "mine": []}
    try:
        root = pluginmod.find_plugin_root()
        sd = os.path.join(root, "skills")
        for name in sorted(os.listdir(sd)):
            p = os.path.join(sd, name, "SKILL.md")
            if os.path.exists(p):
                meta, _ = _frontmatter(p)
                out["plugin"].append({"name": name, "id": "totonou-movie:" + name,
                                      "description": meta.get("description") or ""})
    except Exception:
        pass
    if os.path.isdir(home.SKILLS_DIR):
        for name in sorted(os.listdir(home.SKILLS_DIR)):
            p = os.path.join(home.SKILLS_DIR, name, "SKILL.md")
            if os.path.exists(p):
                meta, body = _frontmatter(p)
                out["mine"].append({"name": name, "id": name, "description": meta.get("description") or "",
                                    "body": body.strip()})
    out["dir"] = home.SKILLS_DIR
    return out


def save_skill(name, description, body, old_name=None):
    name = (name or "").strip()
    if not SKILL_NAME_RE.match(name):
        raise ValueError("スキルの名前は、英小文字・数字・ハイフンで40字以内にしてください（例: my-telop-rules）")
    description = " ".join((description or "").split())
    if not description:
        raise ValueError("「いつ使うか」を書いてください（AI がこのスキルを使う目安になります）")
    if old_name and old_name != name:
        if os.path.exists(os.path.join(home.SKILLS_DIR, name)):
            raise FileExistsError(f"同じ名前のスキルがあります: {name}")
        old = os.path.join(home.SKILLS_DIR, old_name)
        if os.path.isdir(old):
            shutil.move(old, os.path.join(home.SKILLS_DIR, name))
    d = os.path.join(home.SKILLS_DIR, name)
    os.makedirs(d, exist_ok=True)
    text = f"---\nname: {name}\ndescription: {json.dumps(description, ensure_ascii=False)}\n---\n\n{(body or '').strip()}\n"
    with open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8") as f:
        f.write(text)
    return {"name": name, "path": os.path.join(d, "SKILL.md")}


def delete_skill(name):
    if not SKILL_NAME_RE.match(name or ""):
        raise ValueError("スキルの名前が不正です")
    d = os.path.join(home.SKILLS_DIR, name)
    if not os.path.isdir(d):
        raise FileNotFoundError(f"スキルが見つかりません: {name}")
    shutil.rmtree(d)


# ======================================================================
# 表記辞書（全部の動画で使う共通の辞書）
# ======================================================================
def glossary():
    typo = _read_json(os.path.join(home.CONFIG_DIR, "typo_dict.json"), {}) or {}
    prot = _read_json(os.path.join(home.CONFIG_DIR, "protected_terms.json"), {}) or {}
    entries = typo.get("entries", []) if isinstance(typo, dict) else []
    terms = prot.get("terms", []) if isinstance(prot, dict) else []
    return {"entries": [e for e in entries if isinstance(e, dict)], "terms": [t for t in terms if isinstance(t, str)]}


def save_glossary(entries, terms):
    """誤字の直し（wrong→correct）と、字幕で崩さない言葉を保存する。他のキーは残す"""
    tp = os.path.join(home.CONFIG_DIR, "typo_dict.json")
    typo = _read_json(tp, {}) or {}
    if not isinstance(typo, dict):
        typo = {}
    olds = {(e.get("wrong"), e.get("correct")): e for e in typo.get("entries", []) if isinstance(e, dict)}
    clean = []
    for e in entries or []:
        w, c = str(e.get("wrong") or "").strip(), str(e.get("correct") or "").strip()
        if w and c and w != c:
            clean.append({**olds.get((w, c), {}), "wrong": w, "correct": c})
    typo["entries"] = clean
    _write_json(tp, typo)
    pp = os.path.join(home.CONFIG_DIR, "protected_terms.json")
    prot = _read_json(pp, {}) or {}
    if not isinstance(prot, dict):
        prot = {}
    seen, out = set(), []
    for t in terms or []:
        t = str(t).strip()
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    prot["terms"] = out
    _write_json(pp, prot)
    return glossary()


# ======================================================================
# 設定（エンジンの tm_settings で読み書きする＝検証もエンジンに任せる）
# ======================================================================
SETTING_KEYS = ("reviewerName", "deliveryDir", "skinRetouch.portrait", "skinRetouch.landscape",
                "cues.vocative", "cues.chapter", "cues.image", "cues.list", "chapters.cardSec", "chapters.cardSfx")


def settings_view():
    return _engine("tm_settings.py", "show")


def settings_set(key, value):
    if key not in SETTING_KEYS:
        raise ValueError(f"画面からは変えられない設定です: {key}")
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False)
    elif value is None or value == "":
        value = "null"
    return _engine("tm_settings.py", "set", key, str(value))


# ======================================================================
# 自分の効果音（se-library）
# ======================================================================
def se_view():
    lib = os.path.join(home.CONFIG_DIR, "se-library")
    os.makedirs(lib, exist_ok=True)
    mine = sorted(f for f in os.listdir(lib) if f.lower().endswith(".mp3"))
    bundled = []
    try:
        d = os.path.join(pluginmod.find_plugin_root(), "engine", "assets", "se")
        bundled = sorted(f for f in os.listdir(d) if f.lower().endswith(".mp3"))
    except Exception:
        pass
    return {"dir": lib, "mine": mine, "bundled": bundled}
