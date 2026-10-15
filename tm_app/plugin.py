# -*- coding: utf-8 -*-
"""
Claude Code に導入済みの TotonouMovie プラグインを探し、エンジン（engine/scripts）を呼び出す

- 導入先は ~/.claude/plugins/installed_plugins.json の "totonou-movie@<マーケット>" から探す
- 開発用に、環境変数 TOTONOUMOVIE_PLUGIN_ROOT で場所を直接指定することもできる
"""
import json
import os
import shutil
import subprocess

PLUGIN_NAME = "totonou-movie"


class PluginNotFound(Exception):
    pass


def find_plugin_root():
    """導入済みの TotonouMovie プラグインのフォルダを返す。見つからなければ PluginNotFound"""
    env = os.environ.get("TOTONOUMOVIE_PLUGIN_ROOT")
    if env:
        if os.path.isdir(os.path.join(env, "engine", "scripts")):
            return os.path.abspath(env)
        raise PluginNotFound(f"TOTONOUMOVIE_PLUGIN_ROOT の場所にエンジンがありません: {env}")
    reg = os.path.expanduser("~/.claude/plugins/installed_plugins.json")
    if os.path.exists(reg):
        try:
            data = json.load(open(reg, encoding="utf-8"))
        except Exception:
            data = {}
        plugins = data.get("plugins", {}) if isinstance(data, dict) else {}
        cands = []
        for key, entries in plugins.items():
            if key.split("@")[0] != PLUGIN_NAME:
                continue
            for e in entries if isinstance(entries, list) else [entries]:
                p = e.get("installPath") if isinstance(e, dict) else None
                if p and os.path.isdir(os.path.join(p, "engine", "scripts")):
                    cands.append((e.get("lastUpdated") or "", p))
        if cands:
            cands.sort()
            return cands[-1][1]
    raise PluginNotFound(
        "Claude Code に TotonouMovie プラグインが入っていません。"
        "先に TotonouMovie の導入ガイド（QUICKSTART）の手順でプラグインを入れてください。")


def plugin_info(root):
    """プラグインのバージョンなど"""
    info = {"root": root, "version": None}
    for p in (os.path.join(root, ".claude-plugin", "plugin.json"),):
        if os.path.exists(p):
            try:
                info["version"] = json.load(open(p, encoding="utf-8")).get("version")
            except Exception:
                pass
    return info


def uv_bin():
    p = shutil.which("uv")
    if p:
        return p
    for c in ("~/.local/bin/uv", "/opt/homebrew/bin/uv", "/usr/local/bin/uv", "~/.cargo/bin/uv"):
        c = os.path.expanduser(c)
        if os.path.exists(c):
            return c
    return "uv"


def engine_cmd(root, script, *args):
    """エンジンのスクリプトを呼ぶコマンド（スキルの `E/<script>.py` と同じ形）"""
    return [uv_bin(), "run", "--project", os.path.join(root, "engine"), "python", "-X", "utf8",
            os.path.join(root, "engine", "scripts", script)] + [str(a) for a in args]


def engine_env(root):
    env = dict(os.environ)
    env["CLAUDE_PLUGIN_ROOT"] = root
    env["PYTHONIOENCODING"] = "utf-8"
    # サーバーから起動したときにも Homebrew の道具が見えるようにする
    extra = ["/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.local/bin")]
    env["PATH"] = os.pathsep.join(extra + [env.get("PATH", "")])
    return env


def run_engine(root, script, *args, timeout=600):
    """エンジンのスクリプトを実行し、(終了コード, 標準出力, 標準エラー) を返す"""
    r = subprocess.run(engine_cmd(root, script, *args), capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=engine_env(root), timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def parse_json_out(out):
    """スクリプトの出力から最後の JSON オブジェクトを取り出す（前に進捗の行が混ざってもよい）"""
    out = (out or "").strip()
    try:
        return json.loads(out)
    except Exception:
        pass
    i = out.rfind("\n{")
    while i >= 0:
        try:
            return json.loads(out[i + 1:])
        except Exception:
            i = out.rfind("\n{", 0, i)
    if out.startswith("{"):
        try:
            return json.loads(out)
        except Exception:
            pass
    return None


def config_dir():
    """TotonouMovie の設定フォルダ（エンジンの tm_settings.config_dir と同じ決め方）"""
    env = os.environ.get("TOTONOU_CONFIG_DIR", "").strip()
    return os.path.expanduser(env) if env else os.path.expanduser("~/.config/totonou-movie")


def load_settings():
    """TotonouMovie の設定（settings.json）を既定値と合わせて返す。uv を起動しないので速い"""
    d = {"workspaceDir": os.path.expanduser("~/Movies/totonou"), "deliveryDir": None,
         "reviewerName": None, "language": "ja"}
    p = os.path.join(config_dir(), "settings.json")
    exists = os.path.exists(p)
    if exists:
        try:
            d.update(json.load(open(p, encoding="utf-8")) or {})
        except Exception:
            pass
    d["workspaceDir"] = os.path.expanduser(str(d.get("workspaceDir") or "~/Movies/totonou"))
    d["_settingsFileExists"] = exists
    return d
