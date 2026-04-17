#!/usr/bin/env bash
set -euo pipefail
if ! command -v node >/dev/null 2>&1; then
  echo "BajaClaw needs Node.js 20+. Install from https://nodejs.org then rerun."
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "The \`claude\` CLI backend was not found on your PATH."
  echo "BajaClaw drives it as a subprocess — install it first, then rerun."
  exit 1
fi
exec npx create-bajaclaw "$@"
