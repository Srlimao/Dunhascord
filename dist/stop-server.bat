@echo off
echo Stopping StreamHub server...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /f /pid %%a
echo Server stopped.
pause
