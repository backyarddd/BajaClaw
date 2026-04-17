#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bajaclaw start "{{AGENT_NAME}}" "$@"
