#!/usr/bin/env python3
"""
SeaLevel Launcher
Запускает бэкенд и фронтенд для продакшн версии.
"""
import os
import sys
import subprocess
import time
import webbrowser
import socket

def find_free_port(start=8000):
    """Find a free port starting from given port."""
    for port in range(start, start + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    return start

def check_port(port):
    """Check if port is in use."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            s.connect(('127.0.0.1', port))
            return True
    except OSError:
        return False

def main():
    # Determine paths
    if getattr(sys, 'frozen', False):
        # Running as compiled executable
        app_dir = os.path.dirname(sys.executable)
        backend_dir = app_dir
        frontend_dir = app_dir
    else:
        # Running from source
        app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        backend_dir = os.path.join(app_dir, 'backend')
        frontend_dir = os.path.join(app_dir, 'dist')

    # DB path
    db_path = os.path.join(app_dir, 'sealevel.duckdb')
    
    print("=" * 50)
    print("SeaLevel Application Launcher")
    print("=" * 50)
    print(f"App directory: {app_dir}")
    print(f"Database: {db_path}")
    
    # Check if DB exists
    if not os.path.exists(db_path):
        print("\nВнимание: База данных не найдена!")
        print("Создайте базу данных, запустив backend/main.py с данными")
        print("После этого скопируйте sealevel.duckdb в папку с приложением\n")
    
    # Find free port for backend
    port = find_free_port(8000)
    print(f"\nBackend port: {port}")
    
    # Start backend
    backend_process = None
    try:
        print("\nЗапуск backend...")
        backend_script = os.path.join(backend_dir, 'main.py')
        backend_process = subprocess.Popen(
            [sys.executable, backend_script],
            cwd=backend_dir,
            env={**os.environ, 'PORT': str(port)}
        )
    except Exception as e:
        print(f"Ошибка запуска backend: {e}")
        return 1
    
    # Wait for backend to start
    print("Ожидание backend...")
    time.sleep(3)
    
    if backend_process.poll() is not None:
        print("Ошибка: backend завершился с ошибкой")
        return 1
    
    # Open browser
    frontend_url = f"http://127.0.0.1:{port}"
    print(f"\nОткрытие {frontend_url} в браузере...")
    webbrowser.open(frontend_url)
    
    print("\n" + "=" * 50)
    print("Нажмите Ctrl+C для выхода")
    print("=" * 50 + "\n")
    
    try:
        backend_process.wait()
    except KeyboardInterrupt:
        print("\nОстановка backend...")
        backend_process.terminate()
        backend_process.wait()
    
    return 0

if __name__ == '__main__':
    sys.exit(main())