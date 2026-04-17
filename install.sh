#!/usr/bin/env bash
set -euo pipefail
if ! command -v node >/dev/null 2>&1; then
  echo "BajaClaw needs Node.js 20+. Install from https://nodejs.org then rerun."
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI not found. Install it first: https://docs.claude.com/claude-code"
  exit 1
fi
exec npx create-bajaclaw "$@"
