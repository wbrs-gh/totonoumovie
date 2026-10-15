@echo off
rem totonoumovie 起動用コマンド（Windows）。このフォルダを PATH に入れると、どこからでも totonoumovie で起動できる
chcp 65001 >nul
python "%~dp0totonoumovie.py" %*
