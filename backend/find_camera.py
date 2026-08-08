"""Find an EZVIZ/Hikvision camera on the current LAN and work out its RTSP URL.

Run this on a machine that is on the SAME WiFi/LAN as the camera:

    .venv/bin/python find_camera.py                 # scan + try common paths
    .venv/bin/python find_camera.py 192.168.1.50    # test one known IP

EZVIZ prerequisites (in the EZVIZ phone app, per camera):
  1. Settings → Image/Video Encryption → OFF   (encryption ON disables RTSP)
  2. Settings → Local Network / RTSP → ON      (some firmwares call it LAN Live View)
  3. Password = the 6-capital-letter Verification Code on the camera's sticker
"""

import socket
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import cv2

# EZVIZ CS-C6N speaks Hikvision-style paths; try the common ones in order
RTSP_PATHS = [
    "/H.264",
    "/Streaming/Channels/101",
    "/Streaming/Channels/102",  # sub-stream, lower res
    "/h264/ch1/main/av_stream",
    "/live/ch0",
]
USERNAME = "admin"


def local_subnet() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    ip = s.getsockname()[0]
    s.close()
    return ip.rsplit(".", 1)[0]


def port_open(ip: str, port: int, timeout: float = 0.6) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        return s.connect_ex((ip, port)) == 0


def scan(subnet: str) -> list[str]:
    hosts = [f"{subnet}.{i}" for i in range(1, 255)]
    with ThreadPoolExecutor(max_workers=128) as pool:
        results = pool.map(lambda ip: (ip, port_open(ip, 554)), hosts)
    return [ip for ip, open_ in results if open_]


def try_rtsp(ip: str, code: str) -> str | None:
    for path in RTSP_PATHS:
        url = f"rtsp://{USERNAME}:{code}@{ip}:554{path}"
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        ok = cap.isOpened() and cap.read()[0]
        if ok:
            frame = cap.read()[1]
            cap.release()
            h, w = frame.shape[:2] if frame is not None else (0, 0)
            print(f"  ✅ WORKS  {path}   ({w}x{h})")
            return url
        cap.release()
        print(f"  ✗  {path}")
    return None


def main():
    code = input("Camera verification code (6 capital letters on the sticker): ").strip()
    if not code:
        print("Need the verification code — it's the RTSP password.")
        return

    targets = sys.argv[1:]
    if not targets:
        subnet = local_subnet()
        print(f"\nScanning {subnet}.0/24 for RTSP (port 554)…")
        targets = scan(subnet)
        if not targets:
            print(
                "\n❌ No device on this network has port 554 open.\n"
                "   Either the camera is on a different WiFi, or RTSP is still\n"
                "   disabled — turn OFF video encryption in the EZVIZ app first."
            )
            return
        print(f"Found RTSP host(s): {', '.join(targets)}")

    for ip in targets:
        print(f"\nTrying {ip} …")
        url = try_rtsp(ip, code)
        if url:
            print(f"\n🎉 Use this URL in the ParkScan CCTV page:\n\n   {url}\n")
            return

    print(
        "\n❌ Port is open but no stream path worked.\n"
        "   Check the verification code, and that encryption is OFF in the app."
    )


if __name__ == "__main__":
    main()
