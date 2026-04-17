@echo off
setlocal
cd /d "%~dp0\.."
bajaclaw start "{{AGENT_NAME}}" %*
