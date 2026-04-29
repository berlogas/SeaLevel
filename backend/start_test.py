import subprocess
import sys
import os

os.chdir(r"N:\Development\SeaLevel\backend")

proc = subprocess.Popen(
    [r"N:\Development\SeaLevel\backend\.venv\Scripts\python.exe", "main.py"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)

print(f"Started process {proc.pid}")
for line in proc.stdout:
    print(line.strip())
    if "running on" in line.lower():
        break
        
proc.terminate()