# totonoumovie の拠点（動画編集はこのフォルダで）

このフォルダは totonoumovie の本体であり、動画編集の「拠点」です。動画・自分好み・自作スキルは全部この中にあります。
フォルダごと別の場所（Dropbox など）へ移しても、そのまま使えます（起動時に `tm_app/session_env.py` が場所を直します）。

| 場所 | 中身 |
|---|---|
| `projects/` | 動画のプロジェクト（TotonouMovie の作業フォルダ。新しいプロジェクトもここに作る） |
| `my/config/` | TotonouMovie の設定フォルダ（`TOTONOU_CONFIG_DIR`）：マイスタイル `my-styles/`・設定 `settings.json`・共通の表記辞書 `typo_dict.json`／`protected_terms.json`・自分の効果音 `se-library/` |
| `my/app/prompts.json` | 画面の「いつもの指示」とプロンプトの書き換え |
| `.claude/skills/` | 自作スキル（グローバルの `~/.claude/skills` には作らない） |

## Claude Code だけで編集するとき

- このフォルダで `claude` を起動し、「この動画を編集して ＋ 動画のパス」と頼む（TotonouMovie の produce スキル）
- エンジンのコマンドは、必ず `TOTONOU_CONFIG_DIR` がこの拠点の `my/config` を指した状態で動かす（起動時のフックで自動で入る。入っていなければコマンドの前に付ける）。`~/.config/totonou-movie` は v2 までの古い場所なので使わない
- プロジェクトは `projects/` の中に作る（`init_project.py` の `--output "<拠点>/projects/<名前>"`。設定の workspaceDir も同じ場所を指している）
- マイスタイルを使ったら、`tm_style.py use` の出力の `notes`（メモ）は、その動画の編集のルールとして必ず守る。画面の「いつもの指示」をマイスタイルに入れたものがここに入っている
- 自作スキル（`.claude/skills/`）は、名前と説明が依頼に合うときに使う。新しく作るときもここに作る
- 画面（totonoumovie）と同じファイルを読み書きするので、どちらで育てた好みも、もう一方で使える

## 開発するとき

本体のしくみは README.md を参照。マニュアルサイトのソースは `_docs/site_src/`。
