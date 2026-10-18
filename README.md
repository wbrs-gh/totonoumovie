# totonoumovie

TotonouMovie（ととのうムービー）で作る動画を、ブラウザの編集画面で作る・直すアプリ。

- 導入と使い方：https://totonoumovie.aisys.earth/ （ソースは `_docs/site_src/`、`python3 build.py` で `_docs/site/` に書き出す）／PDF 版 `_docs/totonoumovie_使い方マニュアル.pdf`
- 起動：`totonoumovie`（Windows は `totonoumovie.cmd`）→ ブラウザで http://127.0.0.1:8780/ 。どこで起動しても、このフォルダ（拠点）の `projects/` が作業フォルダになる

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
| `tm_app/home.py` | 拠点（このフォルダ）の準備：v2 の設定の引き継ぎ・フォルダを移したときのパスの直し・17スキルを読み込む範囲 |
| `tm_app/customize.py` | 「🌱 自分好み」の画面（マイスタイル・スキル・表記辞書・設定・効果音）の読み書き |
| `tm_app/session_env.py` | Claude Code をこのフォルダで起動したときの準備（`.claude/settings.json` の SessionStart フック） |
| `prompts/default.json` | AI に渡すプロンプトの既定値（上書きは `my/app/prompts.json`） |
| `static/` | 画面（app.js＝プレビュー・タイムライン・プロパティ、panels.js＝一覧・カット承認・AI の作業画面・プロンプト、totono.js＝案内役トトノちゃんとツアー） |
| `static/totono/` | トトノちゃんの絵（ポーズ・歩き）と口の位置（meta.json）、あらかじめ作った声（voice/） |
| `static/icons/` | AI の作業画面などのアイコン |
| `assets_src/totono/` | トトノちゃんの絵の整形（process.py）と、せりふの声づくり（make_voice.py・lines.json） |

## 拠点（このフォルダに全部まとめる）

- `projects/`＝動画、`my/config/`＝TotonouMovie の設定フォルダ（`TOTONOU_CONFIG_DIR`。マイスタイル・設定・表記辞書・自分の効果音）、`my/app/`＝いつもの指示と AI の作業の記録、`.claude/skills/`＝自作スキル。どれも git 管理外
- フォルダごと別の場所へ移しても動く（起動時に `my/state.json` の前回の場所と比べ、設定とプロジェクトの記録のパスを直す）
- 最初の起動で `~/.config/totonou-movie`（v2 の設定）と `~/.totonoumovie`（前の版のアプリ）を写す（元は残す）。v2 の作業フォルダの動画は「🌱 自分好み → 拠点・引き継ぎ」から移せる
- 17スキルは `.claude/settings.json` でこの拠点だけ有効。グローバルの有効・無効は画面から切り替える。アプリの AI は `--settings` で必ず有効にして拠点で動かす
- Claude Code だけで使うときの案内は `CLAUDE.md`
- 再生用キャッシュだけは `~/.totonoumovie/cache`（大きくて作り直せるため）

## 決まりごと

- カットは `data/cutData.ts` を直接書き換えない。TotonouMovie の承認（`gen_cut_plan.py approve → apply`）を画面から人が実行する
- 完成の確認記録（`verify_render.py --record-human-check`）は AI に任せ、ユーザーの OK の後だけ
- アプリの記録は `my/app/`（runs＝AI の作業）、キャッシュは `~/.totonoumovie/cache`（再生用の軽い動画・波形）
- 開発時は環境変数 `TOTONOUMOVIE_PLUGIN_ROOT` でプラグインの場所を直接指定できる

## トトノちゃん

- 絵は codex-image で生成した元絵を `assets_src/totono/process.py` で背景を抜いて大きさをそろえたもの。口は母音（あいうえお・閉じ）ごとに画面側で描いて重ねる
- 声は VOICEVOX:春日部つむぎ。ツアーや AI の作業画面の決まったせりふは `make_voice.py` で前もって作って同梱（VOICEVOX が無いパソコンでも声が出る）。それ以外は VOICEVOX があればその場で読み上げ、無ければ吹き出しだけ
- せりふを足したら `python3 assets_src/totono/make_voice.py assets_src/totono/lines.json static/totono/voice`
