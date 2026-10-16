"""Run inside the started image: python /tmp/smoke.py (no phone/model required)."""
import json
import os
import socket
import subprocess
import urllib.request

port = int(os.environ.get("PORT", "8890"))
with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=5) as response:
    assert "device" in json.load(response)
with socket.create_connection(("127.0.0.1", int(os.environ.get("DEVICE_PORT", "7300"))), timeout=5):
    pass
for plugin in ("h264parse", "avdec_h264", "videoconvert", "videorate", "jpegenc", "fdsink"):
    subprocess.run(["gst-inspect-1.0", plugin], check=True, stdout=subprocess.DEVNULL)
# Require a real UxPlay listener, not merely a successful HTTP probe.
uxplay_pid = next(
    pid for pid in os.listdir("/proc") if pid.isdigit()
    and open(f"/proc/{pid}/comm").read().strip() == "uxplay"
)
inodes = set()
for fd in os.listdir(f"/proc/{uxplay_pid}/fd"):
    target = os.readlink(f"/proc/{uxplay_pid}/fd/{fd}")
    if target.startswith("socket:["):
        inodes.add(target[8:-1])
base = int(os.environ["AIRPLAY_PORT"])
with open("/proc/net/tcp") as table:
    assert any(row.split()[3] == "0A" and row.split()[9] in inodes
               and base <= int(row.split()[1].split(":")[1], 16) <= base + 2
               for row in list(table)[1:])
print("HTTP, board TCP, GStreamer plugins and fixed-port UxPlay listener: OK")
