#!/usr/bin/env python3
"""
SeaLevel Build Script
Собирает продакшн версию приложения.
"""

import os
import shutil
import sys


def main():
    app_dir = os.path.dirname(os.path.abspath(__file__))
    dist_dir = os.path.join(app_dir, "dist")
    backend_dir = os.path.join(app_dir, "backend")
    output_dir = os.path.join(app_dir, "release")

    print("=" * 50)
    print("SeaLevel Build Script")
    print("=" * 50)

    # Check if frontend built
    if not os.path.exists(dist_dir):
        print("\nФронтенд не собран. Запустите: npm run build")
        return 1

    # Check if backend DB exists
    db_path = os.path.join(backend_dir, "sealevel.duckdb")
    if not os.path.exists(db_path):
        print(f"\nВнимание: {db_path} не найден")
        print("Данные не будут включены в сборку")

    # Create release directory
    print("\n[1/2] Копирование файлов...")
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    os.makedirs(output_dir)
    os.makedirs(os.path.join(output_dir, "backend"))
    os.makedirs(os.path.join(output_dir, "dist"))

    # Copy backend files
    for f in os.listdir(backend_dir):
        src = os.path.join(backend_dir, f)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(output_dir, "backend", f))

    # Copy frontend
    for f in os.listdir(dist_dir):
        src = os.path.join(dist_dir, f)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(output_dir, "dist", f))
        elif os.path.isdir(src):
            shutil.copytree(
                src, os.path.join(output_dir, "dist", f), dirs_exist_ok=True
            )

    # Copy DB if exists
    if os.path.exists(db_path):
        shutil.copy2(db_path, os.path.join(output_dir, "sealevel.duckdb"))

    # Copy launcher
    shutil.copy2(
        os.path.join(app_dir, "launcher.py"), os.path.join(output_dir, "launcher.py")
    )

    print(f"Release готов в папке: {output_dir}")
    print("\nДля запуска:")
    print(f"  cd {output_dir}")
    print("  python launcher.py")

    return 0


if __name__ == "__main__":
    sys.exit(main())
