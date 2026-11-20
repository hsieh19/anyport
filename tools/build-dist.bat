@echo off
setlocal enabledelayedexpansion

:: Switch to repository root directory
cd /d "%~dp0.."

echo =======================================================
echo          Anyport Build and Distribution Tool
echo =======================================================

echo [1/4] Building Frontend...
call pnpm --filter frontend build
if errorlevel 1 (
    echo [ERROR] Frontend build failed!
    exit /b 1
)

echo [2/4] Syncing frontend dist to tools/anyport/dist...
if exist "tools\anyport\dist" rd /s /q "tools\anyport\dist"
mkdir "tools\anyport\dist"
xcopy /E /Y /I "packages\frontend\dist" "tools\anyport\dist" > nul

echo [3/4] Compiling anyport-bridge.exe (Headless Bridge)...
cd tools\anyport-bridge
go build -ldflags="-s -w" -o ..\..\anyport-bridge.exe main.go
if errorlevel 1 (
    echo [ERROR] anyport-bridge compilation failed!
    cd ..\..
    exit /b 1
)
cd ..\..

echo [4/4] Compiling anyport.exe (All-in-one Single Binary)...
cd tools\anyport
go build -ldflags="-s -w" -o ..\..\anyport.exe main.go
if errorlevel 1 (
    echo [ERROR] anyport compilation failed!
    cd ..\..
    exit /b 1
)
cd ..\..

echo.
echo =======================================================
echo  Build Success! Output binaries in root:
echo    - anyport.exe        (All-in-one Single Binary, ~8MB)
echo    - anyport-bridge.exe (Headless Bridge Binary, ~6MB)
echo =======================================================
