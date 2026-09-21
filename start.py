"""
Smart Health Monitoring System - All-in-One System Launcher

Launches all 3 microservices concurrently:
  1. Node.js Express Backend API (Port 4000)
  2. FastAPI ML Microservice         (Port 8000)
  3. React Dashboard Frontend    (Port 5173)

Usage:
    python start.py
"""

import os
import sys
import time
import subprocess
import warnings
from pathlib import Path

# Suppress sklearn unpickling warnings
warnings.filterwarnings("ignore", category=UserWarning)

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
ML_DIR = ROOT / "ml-service"
FRONTEND_DIR = ROOT / "frontend"

PYTHON_VENV = ML_DIR / ".venv" / ("Scripts" if sys.platform == "win32" else "bin") / ("python.exe" if sys.platform == "win32" else "python")

def kill_existing_on_ports(ports=(4000, 8000, 5173)):
    """Clean up any leftover processes listening on target ports."""
    if sys.platform == "win32":
        for port in ports:
            try:
                cmd = f'for /f "tokens=5" %a in (\'netstat -aon ^| findstr :{port} ^| findstr LISTEN\') do taskkill /f /pid %a'
                subprocess.run(cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                pass
    time.sleep(1)

def main():
    print("=" * 65)
    print("   🚀 STARTING SMART HEALTH MONITORING SYSTEM")
    print("=" * 65)
    print("  - Backend API     : http://localhost:4000")
    print("  - ML Microservice : http://127.0.0.1:8000")
    print("  - React Dashboard : http://localhost:5173")
    print("=" * 65)
    print()

    print("Cleaning up any previous server instances...")
    kill_existing_on_ports()

    processes = []

    try:
        # 1. Express Backend
        print("[1/3] Starting Express Backend API (Port 4000)...")
        p_backend = subprocess.Popen(
            ["node", "server.js"],
            cwd=str(BACKEND_DIR)
        )
        processes.append(("Backend API", p_backend))

        # 2. FastAPI ML Service
        print("[2/3] Starting FastAPI ML Microservice (Port 8000)...")
        python_bin = str(PYTHON_VENV) if PYTHON_VENV.exists() else sys.executable
        p_ml = subprocess.Popen(
            [python_bin, "-W", "ignore", "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
            cwd=str(ML_DIR)
        )
        processes.append(("ML Service", p_ml))

        # 3. React Dashboard
        print("[3/3] Starting React Dashboard Frontend (Port 5173)...")
        p_frontend = subprocess.Popen(
            ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"],
            cwd=str(FRONTEND_DIR),
            shell=(sys.platform == "win32")
        )
        processes.append(("React Dashboard", p_frontend))

        print()
        print("=" * 65)
        print("  ✅ ALL SERVICES LAUNCHED SUCCESSFULLY!")
        print("  Dashboard: http://localhost:5173")
        print("  Press Ctrl+C to stop all services.")
        print("=" * 65)
        print()

        reported_exits = set()
        while True:
            for name, proc in processes:
                poll = proc.poll()
                if poll is not None and name not in reported_exits:
                    reported_exits.add(name)
                    print(f"⚠️ Service '{name}' stopped with exit code {poll}")
            time.sleep(2)

    except KeyboardInterrupt:
        print("\n\nShutting down all services...")
        for name, proc in processes:
            print(f"  Stopping {name}...")
            try:
                proc.terminate()
            except Exception:
                pass
        print("All services stopped.")
        sys.exit(0)

if __name__ == "__main__":
    main()
