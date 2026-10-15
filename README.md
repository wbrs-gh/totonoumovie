# totonoumovie

TotonouMovie（ととのうムービー）で作る動画を、ブラウザの編集画面で作る・直すアプリ。

- 導入と使い方：`_docs/site/introduction.html`（公開先 https://totonoumovie.aisys.earth/introduction.html ）／PDF 版 `_docs/totonoumovie_導入と使い方ガイド.pdf`
- 起動：作業フォルダで `totonoumovie`（Windows は `totonoumovie.cmd`）→ ブラウザで http://127.0.0.1:8780/ 。起動したフォルダが作業フォルダ（プロジェクトを作る・一覧する場所）になる

## 前提

- Claude Code に TotonouMovie プラグイン（totonou-movie）が導入済みで、セットアップが PASS していること
- Python 3、ffmpeg、uv、Node.js、Claude Code（claude コマンド）

## 構成

| パス | 役割 |
|---|---|
| `totonoumovie.py` | サーバー本体（HTTP・API・裏の作業の起動） |
| `tm_app/plugin.py` | 導入済みの TotonouMovie を探し、エンジン（engine/scripts）を呼ぶ |
| `tm_app/tsdata.py` | プロジェクトの `data/*.ts` の配列だけを読み書き（ヘッダ・行末の印は保持） |
| `tm_app/agent.py` | `claude -p` を動かし、スキルの「★確認」を ```` ```tm-ask ```` ブロックで受けて画面に出す |
| `tm_app/jobs.py` | 静止画・試作・書き出し・検査・カット承認などの裏の作業 |
| `prompts/default.json` | AI に渡すプロンプトの既定値（上書きは `~/.totonoumovie/prompts.json`） |
| `static/` | 画面（app.js＝プレビュー・タイムライン・プロパティ、panels.js＝一覧・カット承認・AI・プロンプト） |

## 決まりごと

- カットは `data/cutData.ts` を直接書き換えない。TotonouMovie の承認（`gen_cut_plan.py approve → apply`）を画面から人が実行する
- 完成の確認記録（`verify_render.py --record-human-check`）は AI に任せ、ユーザーの OK の後だけ
- アプリの記録・キャッシュは `~/.totonoumovie/`（runs＝AI の作業、cache＝再生用の軽い動画・波形）
- 開発時は環境変数 `TOTONOUMOVIE_PLUGIN_ROOT` でプラグインの場所を直接指定できる
