#!/bin/sh
# Linux 启动脚本：工作台（客户端 + 本地 API）。
cd -- "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '未找到 Node.js。请安装 Node.js 22 或更新版本后重试。'
  exit 1
fi
echo 'ABD-FOC · AI-Based Development for FOC'
echo '启动后请打开 http://127.0.0.1:4317/'
exec node workbench/server.mjs
