#!/usr/bin/env bash
set -e
command -v node >/dev/null || { echo "Node.js 18+ is required."; exit 1; }
[ -d node_modules ] || npm install
npm start
