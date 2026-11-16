#!/bin/sh
# Linux 启动脚本：独立构建服务。
cd -- "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo '未找到 Node.js。请安装 Node.js 22 或更新版本后重试。'
  exit 1
fi
BUILD_SERVICE_ENVIRONMENT=development
BUILD_SERVICE_ROLE=developer
export BUILD_SERVICE_ENVIRONMENT BUILD_SERVICE_ROLE
echo 'ABD-FOC · 独立构建服务'
echo '接口地址：POST http://127.0.0.1:4320/v1/build（凭据见 workbench/.workbench-local/build-service-token）'
exec node workbench/build-server.mjs
