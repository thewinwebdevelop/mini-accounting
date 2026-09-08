#!/usr/bin/env bash
set -euo pipefail

# สร้างดัชนีเอกสาร (documents index) ใหม่จากไฟล์บนดิสก์ทั้งหมด ดูรายละเอียด
# กลไกและตัวแปรแวดล้อมที่ปรับได้ (SWEET_HOUSE_ROOT_DIR) ใน
# scripts/rebuild-document-index.mjs
#
# วิธีใช้: ./scripts/rebuild-document-index.sh
#   หรือ:  SWEET_HOUSE_ROOT_DIR=/path/to/root ./scripts/rebuild-document-index.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [ ! -x "$NODE_BIN" ]; then
  echo "ไม่พบ Node runtime ที่แนบมากับโปรเจกต์ (ต้องใช้ node:sqlite): $NODE_BIN" >&2
  exit 1
fi

exec "$NODE_BIN" "$SCRIPT_DIR/rebuild-document-index.mjs"
