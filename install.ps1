#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "BajaClaw needs Node.js 20+. Install from https://nodejs.org then rerun."
  exit 1
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "Claude Code CLI not found. Install it first: https://docs.claude.com/claude-code"
  exit 1
}
npx create-bajaclaw @args
