# マニュアルサイトのソース（totonoumovie.aisys.earth）

- `pages/*.html` … 各ページの本文（先頭の `<!--meta {...} -->` にタイトルと説明）
- `layout.html` … 共通の枠（ヘッダー・左の目次・検索・Mac/Windows 切り替え）
- `assets/` … 見た目（site.css）と動き（site.js：コピー・できたチェック・用語の説明・検索・見出し一覧）
- `images/` … サイトで使う写真・画面写真（JPEG）
- `videos/` … マニュアル動画と見本動画（MP4 は git 管理外。作り直しは下）
- `build.py` … 組み立てて `../site/` に書き出す（検索の索引も作る）

## 作り直し

```bash
python3 build.py                                   # サイトを組み立てる
node video/cdpshot.mjs video/shots_app.json        # 画面写真を撮り直す（totonoumovie を見本の作業フォルダで起動しておく）
python3 video/mkvideo.py video/specs/v04-first.json --out videos/v04-first.mp4   # 動画を作る（VOICEVOX を起動しておく）
```

- 動画の台本は `video/specs/*.json`。位置は `"@要素名"` で書くと、画面写真と一緒に測った位置（`video/img/*.rects.json`）が使われる
- ナレーションは VOICEVOX:冥鳴ひまり（speaker 14）。見本の人物は codex-image で生成、声は VOICEVOX:もち子さん

## 公開

公開サーバーの公開フォルダに `../site/` の中身を上げる（サーバー側の `_backup/`・`.user.ini`・`default_page.png` は残す）。接続先は手元のメモで管理し、リポジトリには書かない。
