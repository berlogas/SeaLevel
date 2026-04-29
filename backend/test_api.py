import requests
import json
import sys

try:
    r = requests.post('http://127.0.0.1:8000/import', 
                   json={'files': ['N:/Development/SeaLevel/test.dat']}, 
                   timeout=30)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text}")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)