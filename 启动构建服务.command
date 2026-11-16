#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '未找到 Node.js。请安装 Node.js 22 或更新版本后重试。'
  read -k 1 '?按任意键关闭…'
  exit 1
fi
export BUILD_SERVICE_ENVIRONMENT=development
export BUILD_SERVICE_ROLE=developer
print 'ABD-FOC · 独立构建服务'
print '接口地址：POST http://127.0.0.1:4320/v1/build（凭据见 workbench/.workbench-local/build-service-token）'
node workbench/build-server.mjs
