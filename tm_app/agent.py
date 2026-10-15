# -*- coding: utf-8 -*-
"""
画面から Claude Code（claude コマンド）を動かして、TotonouMovie のスキル手順で動画を作る・直す

- claude -p を stream-json で動かし、進み具合を画面に流す
- スキルの「★確認」は、AI が最後に書く ```tm-ask {...}``` ブロックで受け取り、画面で答えてもらう
- 答えは claude -p --resume <セッション> で同じ会話に返す
- API キーは使わず、claude コマンドにログインしているアカウントで動く
- 実行の記録は ~/.totonoumovie/runs/<id>.json に残す（アプリを再起動しても続きから答えられる）
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USER_DIR = os.path.expanduser("~/.totonoumovie")
RUNS_DIR = os.path.join(USER_DIR, "runs")
PROMPTS_USER = os.path.join(USER_DIR, "prompts.json")
PROMPTS_DEFAULT = os.path.join(APP_DIR, "prompts", "default.json")

ASK_RE = re.compile(r"```tm-ask\s*\n(.*?)\n```", re.S)
PROJECT_RE = re.compile(r'"project_dir"\s*:\s*"([^"]+)"')


# ======================================================================
# プロンプト（既定値＋ユーザーの上書き）
# ======================================================================
def load_prompts():
    base = json.load(open(PROMPTS_DEFAULT, encoding="utf-8"))
    base.pop("_説明", None)
    user = {}
    if os.path.exists(PROMPTS_USER):
        try:
            user = json.load(open(PROMPTS_USER, encoding="utf-8"))
        except Exception:
            user = {}
    merged = dict(base)
    merged.update({k: v for k, v in user.items() if v is not None})
    merged["_defaults"] = base
    merged["_overridden"] = sorted(k for k in user if k in base and user[k] != base[k])
    return merged


def save_prompts(data):
    """既定値と同じ項目は保存しない（既定値の更新が効くように）"""
    base = json.load(open(PROMPTS_DEFAULT, encoding="utf-8"))
    out = {}
    for k, v in data.items():
        if k.startswith("_") or k not in base:
            continue
        if v != base[k]:
            out[k] = v
    os.makedirs(USER_DIR, exist_ok=True)
    with open(PROMPTS_USER, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)


def build_prompt(kind, prompts, vars_, preset_names=(), extra=""):
    """種類別のプロンプトに、選んだオリジナル指示・毎回の指示・今回の追加指示を足す"""
    tmpl = prompts.get(kind) or ""
    adds = []
    for p in prompts.get("presets", []):
        if p.get("name") in preset_names and p.get("text"):
            adds.append(p["text"].strip())
    if prompts.get("always", "").strip():
        adds.append(prompts["always"].strip())
    if extra and extra.strip():
        adds.append(extra.strip())
    extra_text = ("\n## 追加の指示\n" + "\n".join(f"- {a}" for a in adds)) if adds else ""
    v = dict(vars_)
    v["extra"] = extra_text
    out = tmpl
    for k, val in v.items():
        out = out.replace("{" + k + "}", str(val or ""))
    return out.strip()


# ======================================================================
# claude コマンド
# ======================================================================
def claude_bin():
    p = shutil.which("claude")
    if p:
        return p
    for c in ("~/.local/bin/claude", "~/.npm-global/bin/claude", "~/.claude/local/claude",
              "/opt/homebrew/bin/claude", "/usr/local/bin/claude"):
        c = os.path.expanduser(c)
        if os.path.exists(c):
            return c
    return None


class Run:
    """1回分の AI 作業（同じ会話を何度も再開する）"""

    def __init__(self, kind, title, cwd, project=None):
        self.id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
        self.kind = kind
        self.title = title
        self.cwd = cwd
        self.project = project
        self.session_id = None
        self.status = "running"   # running / waiting / done / error / stopped
        self.question = None
        self.events = []          # 画面に出す進み具合 {t, role, text}
        self.turns = []           # 送ったメッセージ
        self.cost = 0.0
        self.created = time.time()
        self.updated = time.time()
        self.proc = None
        self.error = None

    def add(self, role, text):
        text = (text or "").strip()
        if not text:
            return
        self.events.append({"t": time.time(), "role": role, "text": text[:4000]})
        if len(self.events) > 3000:
            self.events = self.events[-2500:]
        self.updated = time.time()

    def to_dict(self, since=0):
        return {"id": self.id, "kind": self.kind, "title": self.title, "project": self.project,
                "status": self.status, "question": self.question, "sessionId": self.session_id,
                "cost": round(self.cost, 4), "created": self.created, "updated": self.updated,
                "error": self.error, "eventCount": len(self.events), "events": self.events[since:]}

    def save(self):
        os.makedirs(RUNS_DIR, exist_ok=True)
        d = self.to_dict()
        d["cwd"] = self.cwd
        d["turns"] = self.turns
        with open(os.path.join(RUNS_DIR, self.id + ".json"), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False)

    @classmethod
    def load(cls, path):
        d = json.load(open(path, encoding="utf-8"))
        r = cls(d.get("kind"), d.get("title"), d.get("cwd"), d.get("project"))
        r.id = d["id"]
        r.session_id = d.get("sessionId")
        r.status = d.get("status")
        if r.status == "running":
            r.status = "stopped"   # アプリが終了した時に動いていたもの
        r.question = d.get("question")
        r.events = d.get("events", [])
        r.turns = d.get("turns", [])
        r.cost = d.get("cost") or 0.0
        r.created = d.get("created") or time.time()
        r.updated = d.get("updated") or r.created
        r.error = d.get("error")
        return r


def _tool_summary(name, inp):
    """ツール呼び出しを1行の説明にする"""
    if name == "Bash":
        cmd = inp.get("command", "")
        m = re.search(r"engine/scripts/([\w_]+\.py)\"?\s*(\w+)?", cmd)
        if m:
            return f"⚙ {m.group(1)} {m.group(2) or ''}".strip()
        return "⚙ " + (inp.get("description") or cmd)[:160]
    if name in ("Read", "Write", "Edit"):
        p = inp.get("file_path", "")
        return {"Read": "📖 読む", "Write": "✏️ 書く", "Edit": "✏️ 直す"}[name] + " " + os.path.basename(p)
    if name == "Skill":
        return "🧩 スキル " + str(inp.get("skill", ""))
    return f"🔧 {name}"


class AgentManager:
    def __init__(self, plugin_root_getter):
        self.runs = {}
        self.lock = threading.Lock()
        self.plugin_root_getter = plugin_root_getter
        os.makedirs(RUNS_DIR, exist_ok=True)
        for fn in sorted(os.listdir(RUNS_DIR))[-100:]:
            if fn.endswith(".json"):
                try:
                    r = Run.load(os.path.join(RUNS_DIR, fn))
                    self.runs[r.id] = r
                except Exception:
                    pass

    # ---- 開始・再開 ----
    def start(self, kind, title, cwd, prompt, project=None):
        r = Run(kind, title, cwd, project)
        with self.lock:
            self.runs[r.id] = r
        self._launch(r, prompt, resume=False)
        return r

    def answer(self, run_id, text):
        r = self.runs.get(run_id)
        if not r:
            raise KeyError("その作業が見つかりません")
        if r.status == "running":
            raise RuntimeError("AI がまだ作業中です")
        if not r.session_id:
            raise RuntimeError("会話の記録が無いため続きを送れません")
        r.question = None
        self._launch(r, text, resume=True)
        return r

    def stop(self, run_id):
        r = self.runs.get(run_id)
        if r and r.proc and r.proc.poll() is None:
            r.proc.terminate()
            r.status = "stopped"
            r.add("system", "⏹ 止めました")
            r.save()
        return r

    def list(self, project=None):
        rs = [r for r in self.runs.values() if project is None or r.project == project]
        rs.sort(key=lambda r: r.updated, reverse=True)
        return [{k: v for k, v in r.to_dict().items() if k != "events"} for r in rs[:50]]

    def get(self, run_id):
        return self.runs.get(run_id)

    # ---- 実行 ----
    def _launch(self, r, message, resume):
        exe = claude_bin()
        if not exe:
            r.status = "error"
            r.error = "claude コマンドが見つかりません（Claude Code を入れてください）"
            r.add("system", r.error)
            r.save()
            return
        prompts = load_prompts()
        cmd = [exe, "-p", message, "--output-format", "stream-json", "--verbose",
               "--append-system-prompt", prompts.get("system", "")]
        tools = prompts.get("allowedTools") or []
        if tools:
            cmd += ["--allowedTools", ",".join(tools)]
        if prompts.get("model"):
            cmd += ["--model", prompts["model"]]
        if resume:
            cmd += ["--resume", r.session_id]
        root = None
        try:
            root = self.plugin_root_getter()
        except Exception:
            pass
        add_dirs = {d for d in (r.project, root, os.path.expanduser("~/.config/totonou-movie")) if d}
        for d in sorted(add_dirs):
            cmd += ["--add-dir", d]
        env = dict(os.environ)
        env["PATH"] = os.pathsep.join(["/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.local/bin"),
                                       env.get("PATH", "")])
        if root:
            env["CLAUDE_PLUGIN_ROOT"] = root
        os.makedirs(r.cwd, exist_ok=True)
        r.turns.append({"t": time.time(), "text": message, "resume": resume})
        r.add("user", message if resume else "▶ 開始しました\n" + message)
        r.status = "running"
        r.error = None
        r.save()
        try:
            r.proc = subprocess.Popen(cmd, cwd=r.cwd, env=env, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                      errors="replace", bufsize=1)
        except Exception as e:  # noqa: BLE001
            r.status = "error"
            r.error = str(e)
            r.add("system", f"起動できませんでした: {e}")
            r.save()
            return
        threading.Thread(target=self._reader, args=(r,), daemon=True).start()

    def _reader(self, r):
        final_text = ""
        got_result = False
        for line in r.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                r.add("log", line)
                continue
            t = ev.get("type")
            if t == "system" and ev.get("session_id"):
                r.session_id = ev["session_id"]
            elif t == "assistant":
                for c in (ev.get("message") or {}).get("content", []):
                    if c.get("type") == "text":
                        r.add("assistant", ASK_RE.sub("（確認を画面に表示します）", c.get("text", "")))
                    elif c.get("type") == "tool_use":
                        r.add("tool", _tool_summary(c.get("name", ""), c.get("input") or {}))
            elif t == "user":
                for c in (ev.get("message") or {}).get("content", []):
                    if isinstance(c, dict) and c.get("type") == "tool_result":
                        body = c.get("content")
                        if isinstance(body, list):
                            body = "\n".join(x.get("text", "") for x in body if isinstance(x, dict))
                        m = PROJECT_RE.search(str(body or ""))
                        if m and not r.project:
                            r.project = m.group(1)
            elif t == "result":
                got_result = True
                r.session_id = ev.get("session_id") or r.session_id
                r.cost += float(ev.get("total_cost_usd") or 0)
                final_text = ev.get("result") or ""
                if ev.get("is_error"):
                    r.error = final_text or ev.get("subtype")
            r.updated = time.time()
            if len(r.events) % 20 == 0:
                r.save()
        err = r.proc.stderr.read() if r.proc.stderr else ""
        code = r.proc.wait()
        if r.status == "stopped":
            r.save()
            return
        q = None
        m = None
        for m in ASK_RE.finditer(final_text or ""):
            pass
        if m:
            try:
                q = json.loads(m.group(1))
            except Exception as e:  # noqa: BLE001
                q = {"kind": "question", "title": "AI からの確認", "body": m.group(1),
                     "questions": [], "_parseError": str(e)}
        if q:
            if q.get("project") and os.path.isdir(q["project"]):
                r.project = q["project"]
            q["text"] = ASK_RE.sub("", final_text).strip()
            r.question = q
            r.status = "done" if q.get("kind") == "done" else "waiting"
        elif got_result and not r.error:
            # 確認ブロックが無いまま止まった：普通の返事として答えられるようにしておく
            r.question = {"kind": "question", "title": "AI からの返事", "body": "", "questions": [],
                          "text": final_text}
            r.status = "waiting"
        else:
            r.status = "error"
            r.error = r.error or (err.strip()[-1500:] or f"claude が終了コード {code} で止まりました")
            r.add("system", "エラー: " + r.error)
        r.save()
