#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '未找到 Node.js。请安装 Node.js 22 或更新版本后重试。'
  read -k 1 '?按任意键关闭…'
  exit 1
fi
print 'ABD-FOC · AI-Based Development for FOC'
print '启动后请打开 http://127.0.0.1:4317/'
node workbench/server.mjs
