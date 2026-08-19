@echo off
title StreamHub 1080p 60fps Server
cd /d "%~dp0"
echo ===================================================
echo   Starting StreamHub WebRTC Server...
echo ===================================================
node src/server/server.js
pause
