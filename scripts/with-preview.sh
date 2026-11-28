#!/bin/sh
# 確認用：プレビューサーバーを起こしてから、渡されたコマンドを実行し、終わったら止める。
# 例：sh scripts/with-preview.sh node scripts/check-m07.cjs
# 前の確認の取り残し（古いビルドを配るサーバー）があると、それを相手に確かめてしまうので、先に止める。
pkill -f "vite preview --port 4173" 2>/dev/null
npx vite preview --port 4173 --strictPort >/dev/null 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null http://localhost:4173/FALSE-CROWN/ && break; sleep 0.5; done
"$@"
CODE=$?
kill $PID 2>/dev/null
pkill -f "vite preview --port 4173" 2>/dev/null
exit $CODE
