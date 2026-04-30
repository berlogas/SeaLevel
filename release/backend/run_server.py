import sys
import os

# Change to proper directory
os.chdir(r"N:\Development\SeaLevel\backend")

# Import and run uvicorn programmatically
import uvicorn
from main import app

print("Starting server...")
sys.stdout.flush()

uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)