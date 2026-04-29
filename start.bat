@echo off
chcp 65001 >nul
title SeaLevel - Запуск

echo ========================================
echo   SeaLevel - Запуск приложения
echo ========================================
echo.

:: Проверка, что мы в корне проекта
if not exist "backend\main.py" (
    echo [ERROR] backend/main.py не найден!
    echo Запустите этот файл из папки: N:\Development\SeaLevel\
    pause
    exit /b 1
)

:: Проверка, что .venv существует
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Виртуальное окружение .venv не найдено!
    echo Выполните: python -m venv .venv && .venv\Scripts\pip.exe install fastapi uvicorn duckdb pydantic numpy
    pause
    exit /b 1
)

echo [1/3] Запуск SeaLevel API (Backend)...
start "SeaLevel API" cmd /k "cd /d N:\Development\SeaLevel\backend && ..\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"

echo [2/3] Ожидание запуска бэкенда (5 сек)...
timeout /t 5 /nobreak >nul

echo [3/3] Запуск Frontend (Tauri)...
start "SeaLevel Frontend" cmd /k "cd /d N:\Development\SeaLevel && npm run tauri dev"

echo.
echo ========================================
echo   Готово!
echo   - Backend: http://127.0.0.1:8000
echo   - Frontend: окно Tauri откроется автоматически
echo   - Для остановки: закройте окна или Ctrl+C в терминалах
echo ========================================
