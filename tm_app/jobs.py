# -*- coding: utf-8 -*-
"""
裏で動かす作業（静止画・試作・書き出し・検査・カットの承認など）を管理する

1つの作業は「複数のコマンドを順に実行する」もので、ログと進み具合を画面に返す。
"""
import os
import subprocess
import threading
import time
import uuid


class Job:
    def __init__(self, project, kind, title):
        self.id = uuid.uuid4().hex[:12]
        self.project = project
        self.kind = kind
        self.title = title
        self.status = "queued"   # queued / running / done / error / canceled
        self.log = []
        self.result = {}
        self.started = time.time()
        self.ended = None
        self.proc = None
        self.cancel_flag = False

    def add_log(self, line):
        line = line.rstrip("\n")
        if line:
            self.log.append(line)
            if len(self.log) > 2000:
                self.log = self.log[-1500:]

    def to_dict(self, with_log=True):
        d = {"id": self.id, "project": self.project, "kind": self.kind, "title": self.title,
             "status": self.status, "result": self.result, "started": self.started, "ended": self.ended}
        if with_log:
            d["log"] = self.log[-400:]
        return d


class Jobs:
    def __init__(self):
        self.jobs = {}
        self.lock = threading.Lock()

    def start(self, project, kind, title, steps, env=None, cwd=None, on_done=None):
        """steps: [(説明, コマンドのリスト or 関数(job)->None[, 警告として続ける終了コードの集合])] を順に実行する"""
        job = Job(project, kind, title)
        with self.lock:
            self.jobs[job.id] = job
        threading.Thread(target=self._run, args=(job, steps, env, cwd, on_done), daemon=True).start()
        return job

    def _run(self, job, steps, env, cwd, on_done):
        job.status = "running"
        try:
            for entry in steps:
                label, step = entry[0], entry[1]
                warn_codes = entry[2] if len(entry) > 2 else ()
                if job.cancel_flag:
                    job.status = "canceled"
                    break
                job.add_log(f"▶ {label}")
                if callable(step):
                    step(job)
                    continue
                job.proc = subprocess.Popen(step, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                            text=True, encoding="utf-8", errors="replace",
                                            env=env, cwd=cwd, bufsize=1)
                out = []
                for line in job.proc.stdout:
                    out.append(line)
                    job.add_log(line)
                code = job.proc.wait()
                job.result.setdefault("outputs", []).append("".join(out)[-20000:])
                if code in warn_codes and not job.cancel_flag:
                    # 検査の「警告だけ」（終了コード 1 など）は止めずに続け、結果に残す
                    job.result.setdefault("warnings", []).append(label)
                    job.add_log(f"⚠ 「{label}」で警告があります（続けます）")
                    continue
                if code != 0 and not job.cancel_flag:
                    job.status = "error"
                    job.result["error"] = f"「{label}」で止まりました（終了コード {code}）"
                    job.result["exitCode"] = code
                    break
            if job.status == "running":
                job.status = "canceled" if job.cancel_flag else "done"
        except Exception as e:  # noqa: BLE001
            job.status = "error"
            job.result["error"] = str(e)
            job.add_log(f"エラー: {e}")
        job.ended = time.time()
        if on_done:
            try:
                on_done(job)
            except Exception as e:  # noqa: BLE001
                job.add_log(f"後処理でエラー: {e}")

    def cancel(self, job_id):
        job = self.jobs.get(job_id)
        if not job:
            return False
        job.cancel_flag = True
        if job.proc and job.proc.poll() is None:
            job.proc.terminate()
        return True

    def get(self, job_id):
        return self.jobs.get(job_id)

    def list(self, project=None):
        js = [j for j in self.jobs.values() if project is None or j.project == project]
        js.sort(key=lambda j: j.started, reverse=True)
        return [j.to_dict(with_log=False) for j in js[:30]]

    def running_for(self, project):
        return [j for j in self.jobs.values() if j.project == project and j.status in ("queued", "running")]


def which_project_busy(jobs, project):
    return bool(jobs.running_for(project))


def safe_name(s):
    return "".join(c for c in s if c not in '/\\:*?"<>|').strip() or "untitled"


def ensure_dir(p):
    os.makedirs(p, exist_ok=True)
    return p
