@echo off
chcp 65001 >nul
title ABD-FOC 独立构建服务
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请安装 Node.js 22 或更新版本后重试。
  pause
  exit /b 1
)
set BUILD_SERVICE_ENVIRONMENT=development
set BUILD_SERVICE_ROLE=developer
echo ABD-FOC · 独立构建服务
echo 接口地址：POST http://127.0.0.1:4320/v1/build（凭据见 workbench\.workbench-local\build-service-token）
node workbench\build-server.mjs
pause
