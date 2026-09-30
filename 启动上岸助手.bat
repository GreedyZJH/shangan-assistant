@echo off
chcp 65001 >nul
cd /d %~dp0
title 上岸助手 · 考公刷题

py -3.12 -c "import webview, httpx, PIL" 2>nul
if not errorlevel 1 goto run

echo 首次运行，正在安装依赖（需要联网）...
py -3.12 -m pip install -r requirements.txt

:run
py -3.12 desktop\app.py
if errorlevel 1 (
  echo.
  echo 程序异常退出，请将以上信息反馈给开发者。
  pause
)