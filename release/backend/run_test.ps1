# Start backend in background without new window
$ErrorActionPreference = "Stop"
$env:PYTHONUNBUFFERED = "1"

$venvPython = "N:\Development\SeaLevel\backend\.venv\Scripts\python.exe"
$script = "N:\Development\SeaLevel\backend\main.py"

$proc = Start-Process -FilePath $venvPython -ArgumentList $script -WorkingDirectory "N:\Development\SeaLevel\backend" -PassThru -WindowStyle Hidden

Write-Host "Started process ID: $($proc.Id)"
Start-Sleep 2

$testScript = @"
import requests
try:
    r = requests.post('http://127.0.0.1:8000/import', json={'files': ['N:/Development/SeaLevel/test.dat']}, timeout=30)
    print(f'Status: {r.status_code}')
    print(f'Response: {r.text[:300]}')
except Exception as e:
    print(f'Error: {e}')
"@

$result = & "N:\Development\SeaLevel\backend\.venv\Scripts\python.exe" -c $testScript
Write-Host $result