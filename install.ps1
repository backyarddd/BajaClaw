#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "BajaClaw needs Node.js 20+. Install from https://nodejs.org then rerun."
  exit 1
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "The 'claude' CLI backend was not found on your PATH."
  Write-Host "BajaClaw drives it as a subprocess - install it first, then rerun."
  exit 1
}
npm install -g github:backyarddd/BajaClaw @args
