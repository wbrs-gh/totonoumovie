@echo off
rem totonoumovie 起動用コマンド（Windows）。このフォルダを PATH に入れると、どこからでも totonoumovie で起動できる
chcp 65001 >nul
rem py ランチャーを先に使う（Microsoft Store の python が先に当たる環境があるため）
where py >nul 2>nul && (py -3 "%~dp0totonoumovie.py" %*) || (python "%~dp0totonoumovie.py" %*)
