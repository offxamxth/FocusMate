"""Start the React dashboard for local development."""

import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DASHBOARD_DIR = os.path.join(BASE_DIR, "dashboard")
NODE_MODULES = os.path.join(DASHBOARD_DIR, "node_modules")


def available_port(start):
    for port in range(start, start + 100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            try:
                listener.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"No available local port near {start}.")


def wait_for(url, processes, seconds=35):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            return False
        try:
            with urllib.request.urlopen(url, timeout=1):
                return True
        except (OSError, urllib.error.URLError):
            time.sleep(0.25)
    return False


def stop_process(process):
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def main():
    print("=" * 54)
    print("                 FOCUSMATE")
    print("              React dashboard")
    print("=" * 54)

    if not os.path.isdir(NODE_MODULES):
        raise FileNotFoundError("React dependencies are missing. Run `npm install --prefix dashboard` first.")
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise FileNotFoundError("npm was not found. Install Node.js 20.19+ and run `npm install --prefix dashboard`.")

    web_port = available_port(5173)
    environment = {**os.environ, "FOCUSMATE_WEB_PORT": str(web_port)}
    web_process = None
    try:
        web_process = subprocess.Popen(
            [npm, "run", "dev"],
            cwd=DASHBOARD_DIR,
            env=environment,
            shell=False,
        )
        url = f"http://127.0.0.1:{web_port}"
        if not wait_for(url, [web_process]):
            raise RuntimeError("The React dashboard did not start.")

        print(f"\nDashboard: {url}")
        print("Webcam analysis runs locally in your browser when requested.")
        print("Close this launcher to stop FocusMate.")
        webbrowser.open(url)
        while web_process.poll() is None:
            time.sleep(0.5)
        print("\nFocusMate has stopped.")
    except KeyboardInterrupt:
        print("\nStopping FocusMate...")
    finally:
        stop_process(web_process)
        print("FocusMate closed.")


if __name__ == "__main__":
    try:
        main()
    except (FileNotFoundError, RuntimeError) as error:
        print(f"ERROR: {error}")
        sys.exit(1)