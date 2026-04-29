import socket
import sys

def check_port(host='127.0.0.1', port=8000):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        result = sock.connect_ex((host, port))
        sock.close()
        if result == 0:
            print(f"Port {port} is OPEN")
            return True
        else:
            print(f"Port {port} is CLOSED (code: {result})")
            return False
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    check_port('127.0.0.1', 8000)