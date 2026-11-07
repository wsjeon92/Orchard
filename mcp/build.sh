#!/usr/bin/env bash
# .mcpb 만들기 — 다른 사람이 한 번 클릭으로 설치할 수 있는 꾸러미.
# 서버 코드를 고쳤으면 이걸 다시 돌린다.
set -euo pipefail
cd "$(dirname "$0")"

npm run bundle                       # SDK 까지 한 파일로
cp bundle/server.js pack/server/index.js
npx -y @anthropic-ai/mcpb validate pack/manifest.json
npx -y @anthropic-ai/mcpb pack pack ../orchard.mcpb
echo "→ orchard.mcpb"
