# -*- coding: utf-8 -*-
"""
Claude Code を拠点（totonoumovie の本体フォルダ）で起動したときに動く（.claude/settings.json の SessionStart フック）

- アプリと同じ準備をする（v2 の設定の引き継ぎ・フォルダを移したときのパスの直し・作業フォルダを projects/ に向ける）
- その後の Bash に TOTONOU_CONFIG_DIR=<拠点>/my/config を渡す（CLAUDE_ENV_FILE）。
  これで Claude Code だけで編集しても、マイスタイル・設定・表記辞書は画面と同じものを使う
- 標準出力は Claude への前提として読まれるので、拠点の場所と、いまあるマイスタイル・自作スキルの名前を短く出す
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tm_app import home  # noqa: E402


def main():
    try:
        notes = home.prepare()
    except Exception as e:  # noqa: BLE001
        print(f"[totonoumovie] 拠点の準備に失敗しました: {e}")
        return
    env_file = os.environ.get("CLAUDE_ENV_FILE")
    if env_file:
        q = home.CONFIG_DIR.replace('"', '\\"')
        with open(env_file, "a", encoding="utf-8") as f:
            f.write(f'export {home.CONFIG_ENV}="{q}"\n')
    try:
        from tm_app import customize
        styles = [f'{s["name"]}（{s["modeLabel"]}）' for s in customize.list_styles()]
        skills = [s["name"] for s in customize.list_skills()["mine"]]
    except Exception:  # noqa: BLE001
        styles, skills = [], []
    lines = [f"[totonoumovie] 拠点: {home.BASE}",
             f"- 動画のプロジェクトは {home.PROJECTS_DIR} に作る。設定フォルダ（{home.CONFIG_ENV}）は {home.CONFIG_DIR}",
             "- マイスタイル: " + ("、".join(styles) if styles else "まだ無い"),
             "- 自作スキル（.claude/skills）: " + ("、".join(skills) if skills else "まだ無い")]
    if not env_file:
        lines.append(f"- 注意: エンジンのコマンドの前に {home.CONFIG_ENV}=\"{home.CONFIG_DIR}\" を付けて実行すること")
    lines += ["- " + n for n in notes]
    print("\n".join(lines))


if __name__ == "__main__":
    main()
