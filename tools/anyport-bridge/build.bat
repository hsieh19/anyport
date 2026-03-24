@echo off
echo Building Anyport Multi-Protocol Bridge...
set GOOS=windows
set GOARCH=amd64
go build -ldflags="-s -w" -o anyport-bridge.exe main.go
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)
echo Build success: anyport-bridge.exe
pause
