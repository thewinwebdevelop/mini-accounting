#!/usr/bin/env bash
set -euo pipefail

# สำรองข้อมูล documents/, data/ (ฐานข้อมูล SQLite) และ config/ ไปไว้นอก repo
# ดูรายละเอียดกลไกและตัวแปรแวดล้อมที่ปรับได้ (SWEET_HOUSE_ROOT_DIR,
# SWEET_HOUSE_BACKUP_DIR) ใน scripts/backup.mjs
#
# วิธีใช้: ./scripts/backup.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="/Users/tar/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if [ ! -x "$NODE_BIN" ]; then
  echo "ไม่พบ Node runtime ที่แนบมากับโปรเจกต์ (ต้องใช้ node:sqlite): $NODE_BIN" >&2
  exit 1
fi

exec "$NODE_BIN" "$SCRIPT_DIR/backup.mjs"
