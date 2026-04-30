@echo off
echo SeaLevel Application
echo ========================
echo.
echo Starting backend...
start "SeaLevel Backend" cmd /k "cd /d %~dp0backend && python main.py"
timeout /t 3 /nobreak
echo Opening browser...
start http://127.0.0.1:8000
echo.
echo Press any key to exit (backend will keep running)...
pause >nul