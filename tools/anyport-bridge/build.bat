@echo off
echo Building Anyport BACnet Bridge...
go build -ldflags="-s -w" -o anyport-bridge.exe main.go
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)
echo Build success: anyport-bridge.exe
pause
