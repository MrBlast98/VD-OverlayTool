@echo off
setlocal

cd /d "%~dp0"
echo Starting Discord bot...
npm run bot
echo.
echo Bot stopped.
pause