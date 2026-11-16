@echo off
chcp 65001 >nul
title ABD-FOC 工作台
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请安装 Node.js 22 或更新版本后重试。
  pause
  exit /b 1
)
echo ABD-FOC · AI-Based Development for FOC
echo 启动后请打开 http://127.0.0.1:4317/
node workbench\server.mjs
pause
