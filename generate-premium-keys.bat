@echo off
setlocal EnableExtensions

cd /d "%~dp0"
echo.
set /p KEY_COUNT=How many premium keys do you want to generate? 

if not defined KEY_COUNT (
  echo No key count entered. Exiting.
  pause
  exit /b 1
)

echo.
echo Generating %KEY_COUNT% premium key(s)...
node "%~dp0bot\generate-keys.js" %KEY_COUNT%
echo.
echo Finished.
pause