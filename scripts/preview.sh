#!/usr/bin/env bash
# 本機／右手邊預覽（同監考系統用法）
# 用法：bash scripts/preview.sh
# 之後喺 Cursor 右手邊開 http://127.0.0.1:8766/
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8766}"
python3 src/build.py
echo "預覽已起：http://127.0.0.1:${PORT}/  （右手邊 Simple Browser 貼呢個網址）"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
