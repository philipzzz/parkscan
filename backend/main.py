import io
import re
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image

from db import get_conn, init_db

# Confidence below this => "uncertain", officer must confirm manually
CONFIDENCE_THRESHOLD = 0.85
# Plate-detector gates: weaker/smaller detections are background noise, not plates
DETECTION_THRESHOLD = 0.60
MIN_BOX_WIDTH = 40
MIN_BOX_HEIGHT = 12
MIN_PLATE_CHARS = 4
# Expired less than this => yellow grace period instead of straight compound
GRACE_MINUTES = 15
# One compound per vehicle per zone within this window — a second officer
# scanning the same car sees the existing fine instead of writing another
COMPOUND_WINDOW_HOURS = 4

PHOTO_DIR = Path(__file__).parent / "photos"
PHOTO_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Parking AI Demo")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
app.mount("/photos", StaticFiles(directory=PHOTO_DIR), name="photos")

init_db()

print("Loading ALPR models (first run downloads them)...")
from fast_alpr import ALPR  # noqa: E402  (import after init_db so DB errors surface first)

import onnxruntime as ort  # noqa: E402

# One shared ALPR instance across all requests: ONNX Runtime sessions are
# thread-safe for concurrent inference, so the threadpool workers run
# predictions in parallel without a lock (and without a model copy per user).
#
# Each inference is capped to a few intra-op threads. Left at the default
# (one thread per core) every concurrent request would try to fan out across
# all cores at once and they would spend their time fighting each other —
# with many officers scanning, per-request parallelism is worth less than
# running many requests side by side.
_sess = ort.SessionOptions()
_sess.intra_op_num_threads = 4
_sess.inter_op_num_threads = 1

alpr = ALPR(
    detector_model="yolo-v9-s-608-license-plate-end2end",
    detector_sess_options=_sess,
    ocr_model="cct-s-v2-global-model",
    ocr_sess_options=_sess,
)
print("ALPR ready.")


def normalize_plate(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", text.upper())


# Malaysian plates: 1-3 letters + 1-4 digits + optional letter suffix (no I/O letters)
MY_PLATE = re.compile(r"^[A-Z]{1,3}[0-9]{1,4}[A-Z]?$")
# Common OCR confusions when a character sits in the digit section
TO_DIGIT = {"O": "0", "I": "1", "S": "5", "B": "8", "Z": "2", "G": "6"}


def coerce_malaysian(plate: str) -> tuple[str, bool]:
    """Try to fix common OCR confusions so the plate matches Malaysian format.

    Returns (plate, ok). ok=False means the read doesn't look like a real
    plate even after correction — treat as uncertain, never auto-flag unpaid.
    """
    if MY_PLATE.match(plate):
        return plate, True
    for split in range(1, min(4, len(plate))):
        head, tail = plate[:split], plate[split:]
        if not head.isalpha():
            continue
        candidate = head + "".join(TO_DIGIT.get(c, c) for c in tail)
        if MY_PLATE.match(candidate):
            return candidate, True
    return plate, False


def ocr_confidence(ocr) -> float:
    # fast-alpr returns per-character confidences; the weakest character
    # decides whether the whole plate needs manual confirmation
    conf = ocr.confidence
    if isinstance(conf, (list, tuple)):
        return min(conf) if conf else 0.0
    return float(conf)


# Privacy: photos are only written for frames that may become compound
# evidence (unpaid/uncertain). Anything not referenced by a compound within
# an hour is swept away — only actual evidence persists.
PHOTO_TTL_SECONDS = 3600
_last_prune = 0.0


def prune_orphan_photos():
    global _last_prune
    now = time.time()
    if now - _last_prune < 300:
        return
    _last_prune = now
    conn = get_conn()
    kept = {
        row["photo_path"]
        for row in conn.execute(
            "SELECT photo_path FROM compounds WHERE photo_path IS NOT NULL"
        )
    }
    kept |= {
        row["photo_path"]
        for row in conn.execute(
            "SELECT photo_path FROM payments WHERE photo_path IS NOT NULL"
        )
    }
    conn.close()
    for f in PHOTO_DIR.iterdir():
        if (
            f.is_file()
            and now - f.stat().st_mtime > PHOTO_TTL_SECONDS
            and f"/photos/{f.name}" not in kept
        ):
            f.unlink(missing_ok=True)


def payment_status(plate: str, zone_id: str) -> dict:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM payments WHERE plate = ? AND zone_id = ? ORDER BY paid_until DESC LIMIT 1",
        (plate, zone_id),
    ).fetchone()
    existing = conn.execute(
        "SELECT * FROM compounds WHERE plate = ? AND zone_id = ? AND created_at > ?",
        (
            plate,
            zone_id,
            (datetime.now() - timedelta(hours=COMPOUND_WINDOW_HOURS)).isoformat(),
        ),
    ).fetchone()
    conn.close()

    if existing:
        return {
            "status": "compounded",
            "detail": f"Compound #{existing['id']} already issued at "
            f"{existing['created_at'][11:16]}",
        }
    if row is None:
        return {"status": "unpaid", "detail": "No valid parking payment"}

    paid_until = datetime.fromisoformat(row["paid_until"])
    now = datetime.now()
    if paid_until > now:
        return {
            "status": "paid",
            "detail": f"Paid until {paid_until.strftime('%I:%M %p')}",
        }
    minutes_over = int((now - paid_until).total_seconds() // 60)
    if minutes_over <= GRACE_MINUTES:
        return {
            "status": "expired",
            "detail": f"Expired {minutes_over} minutes ago (grace period)",
        }
    return {"status": "unpaid", "detail": f"Expired {minutes_over} minutes ago"}


# NOTE: the ALPR endpoints are sync `def`, not `async def`, on purpose.
# ONNX inference is blocking CPU work; inside `async def` it would run on the
# event loop and serialise every request in the process. As plain `def`,
# FastAPI hands them to its threadpool and they run in parallel across cores.
@app.post("/scan")
def scan(image: UploadFile = File(...), zone_id: str = Form(...)):
    raw = image.file.read()
    pil = Image.open(io.BytesIO(raw)).convert("RGB")
    frame = np.array(pil)

    results = alpr.predict(frame)

    def plausible(r):
        if not r.ocr or not r.ocr.text:
            return False
        bb = r.detection.bounding_box
        return (
            r.detection.confidence >= DETECTION_THRESHOLD
            and bb.x2 - bb.x1 >= MIN_BOX_WIDTH
            and bb.y2 - bb.y1 >= MIN_BOX_HEIGHT
        )

    candidates = [r for r in results if plausible(r)]
    if not candidates:
        return {"found": False}

    best = max(candidates, key=lambda r: ocr_confidence(r.ocr))
    plate, format_ok = coerce_malaysian(normalize_plate(best.ocr.text))
    if len(plate) < MIN_PLATE_CHARS:
        return {"found": False}
    confidence = round(ocr_confidence(best.ocr), 3)

    def save_photo() -> str:
        name = f"{plate}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
        pil.save(PHOTO_DIR / name, quality=85)
        return f"/photos/{name}"

    prune_orphan_photos()

    if not format_ok:
        return {
            "found": True,
            "plate": plate,
            "confidence": confidence,
            "status": "uncertain",
            "detail": "Doesn't match Malaysian plate format — confirm manually",
            "photo": save_photo(),
        }

    if confidence < CONFIDENCE_THRESHOLD:
        return {
            "found": True,
            "plate": plate,
            "confidence": confidence,
            "status": "uncertain",
            "detail": "Low OCR confidence — confirm plate manually",
            "photo": save_photo(),
        }

    status = payment_status(plate, zone_id)
    # Photos persist only when they may become compound evidence
    photo = save_photo() if status["status"] == "unpaid" else None
    return {
        "found": True,
        "plate": plate,
        "confidence": confidence,
        "photo": photo,
        **status,
    }


@app.post("/identify")
def identify(image: UploadFile = File(...)):
    """Citizen-side plate reading: no enforcement logic, just OCR.

    The photo is kept — it becomes the citizen's own parking record/evidence.
    """
    raw = image.file.read()
    pil = Image.open(io.BytesIO(raw)).convert("RGB")
    frame = np.array(pil)

    results = alpr.predict(frame)

    def plausible(r):
        if not r.ocr or not r.ocr.text:
            return False
        bb = r.detection.bounding_box
        return (
            r.detection.confidence >= DETECTION_THRESHOLD
            and bb.x2 - bb.x1 >= MIN_BOX_WIDTH
            and bb.y2 - bb.y1 >= MIN_BOX_HEIGHT
        )

    candidates = [r for r in results if plausible(r)]
    if not candidates:
        return {"found": False}

    best = max(candidates, key=lambda r: ocr_confidence(r.ocr))
    plate, format_ok = coerce_malaysian(normalize_plate(best.ocr.text))
    if len(plate) < MIN_PLATE_CHARS:
        return {"found": False}
    confidence = round(ocr_confidence(best.ocr), 3)

    photo_name = f"cit_{plate}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
    pil.save(PHOTO_DIR / photo_name, quality=85)

    return {
        "found": True,
        "plate": plate,
        "confidence": confidence,
        "format_ok": format_ok,
        "photo": f"/photos/{photo_name}",
    }


def haversine_m(lat1, lng1, lat2, lng2):
    from math import asin, cos, radians, sin, sqrt

    lat1, lng1, lat2, lng2 = map(radians, (lat1, lng1, lat2, lng2))
    a = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
    return 6371000 * 2 * asin(sqrt(a))


@app.get("/zones/nearest")
def nearest_zone(lat: float, lng: float):
    conn = get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM zones WHERE lat IS NOT NULL")]
    conn.close()
    if not rows:
        return {"found": False}
    best = min(rows, key=lambda z: haversine_m(lat, lng, z["lat"], z["lng"]))
    return {
        "found": True,
        "zone": best,
        "distance_m": round(haversine_m(lat, lng, best["lat"], best["lng"])),
    }


@app.get("/status/{plate}")
def manual_status(plate: str, zone_id: str):
    """Manual lookup — used after officer corrects an uncertain OCR result."""
    return {"plate": normalize_plate(plate), **payment_status(normalize_plate(plate), zone_id)}


@app.post("/compounds")
def issue_compound(payload: dict):
    """Issue a compound — at most one per vehicle per zone per COMPOUND_WINDOW.

    Two officers (or an officer and the CCTV reviewer) can hit "issue" for the
    same car at the same moment. The duplicate check runs inside a write
    transaction so exactly one of them wins; the others get told about the
    compound that already exists instead of writing a second fine.
    """
    plate = normalize_plate(payload["plate"])
    zone_id = payload["zone_id"]
    now = datetime.now()
    cutoff = (now - timedelta(hours=COMPOUND_WINDOW_HOURS)).isoformat()

    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")  # take the write lock before checking
        existing = conn.execute(
            "SELECT id, officer_id, created_at FROM compounds "
            "WHERE plate = ? AND zone_id = ? AND created_at > ?",
            (plate, zone_id, cutoff),
        ).fetchone()
        if existing:
            conn.rollback()
            return {
                "id": existing["id"],
                "status": "duplicate",
                "detail": f"Compound #{existing['id']} already issued at "
                f"{existing['created_at'][11:16]} by {existing['officer_id']}",
            }

        cur = conn.execute(
            """INSERT INTO compounds
               (plate, zone_id, officer_id, lat, lng, photo_path, ocr_confidence, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                plate,
                zone_id,
                payload["officer_id"],
                payload.get("lat"),
                payload.get("lng"),
                payload.get("photo"),
                payload.get("confidence"),
                now.isoformat(),
            ),
        )
        conn.commit()
        return {"id": cur.lastrowid, "status": "issued"}
    finally:
        conn.close()


@app.post("/pay")
def simulate_payment(payload: dict):
    """Citizen-side simulation: mark a plate as paid for N minutes.

    Extending an active session adds time on top of the current expiry,
    so paying twice never shortens what the citizen already has.
    """
    plate = normalize_plate(payload["plate"])
    zone_id = payload["zone_id"]
    minutes = int(payload.get("minutes", 60))
    now = datetime.now()

    conn = get_conn()
    row = conn.execute(
        "SELECT paid_until FROM payments WHERE plate = ? AND zone_id = ? ORDER BY paid_until DESC LIMIT 1",
        (plate, zone_id),
    ).fetchone()
    base = now
    if row:
        current = datetime.fromisoformat(row["paid_until"])
        if current > now:
            base = current
    paid_until = base + timedelta(minutes=minutes)

    rate = conn.execute(
        "SELECT rate_per_hour FROM zones WHERE id = ?", (zone_id,)
    ).fetchone()
    amount = round(minutes / 60 * (rate["rate_per_hour"] if rate else 0.60), 2)

    cur = conn.execute(
        """INSERT INTO payments (plate, zone_id, paid_until, amount, lat, lng, photo_path, created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            plate,
            zone_id,
            paid_until.isoformat(),
            amount,
            payload.get("lat"),
            payload.get("lng"),
            payload.get("photo"),
            now.isoformat(),
        ),
    )
    conn.commit()
    payment_id = cur.lastrowid
    conn.close()
    return {
        "id": payment_id,
        "plate": plate,
        "zone_id": zone_id,
        "paid_until": paid_until.isoformat(),
        "amount": amount,
        "extended": row is not None and base != now,
    }


class RtspCamera:
    """Background RTSP reader: always holds the newest frame, drops the rest.

    Decoding in a thread (instead of on request) keeps the stream from
    buffering up and lagging further behind real time with every scan.
    """

    CONNECT_TIMEOUT_S = 15

    def __init__(self):
        self.url: str | None = None
        self.frame = None
        self.error: str | None = None
        self.connected = False
        self._thread = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        # Bumped on every connect so a dying reader can't overwrite the
        # state of the connection that replaced it
        self._generation = 0

    def connect(self, url: str) -> dict:
        self.disconnect()
        self._stop.clear()
        self._generation += 1
        gen = self._generation
        self.url = url
        self.error = None
        self._thread = threading.Thread(target=self._reader, args=(url, gen), daemon=True)
        self._thread.start()

        deadline = time.time() + self.CONNECT_TIMEOUT_S
        while time.time() < deadline:
            if self.connected or self.error:
                break
            time.sleep(0.25)
        if not self.connected and not self.error:
            self.error = (
                f"No frame within {self.CONNECT_TIMEOUT_S}s — check the IP, "
                "credentials, and that the camera is reachable from the server."
            )
        return self.status()

    def _reader(self, url: str, gen: int):
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            if gen == self._generation:
                self.error = (
                    "Could not open stream — check URL, credentials and that "
                    "RTSP is enabled on the camera."
                )
            cap.release()
            return
        is_file = not url.lower().startswith(("rtsp://", "http://", "https://"))
        while not self._stop.is_set() and gen == self._generation:
            ok, frame = cap.read()
            if not ok:
                if is_file:
                    # Video-file source: loop it so it behaves like a live feed
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                if gen == self._generation:
                    self.error = "Stream dropped"
                    self.connected = False
                break
            with self._lock:
                if gen == self._generation:
                    self.frame = frame
                    self.connected = True
        cap.release()

    def latest(self):
        with self._lock:
            return None if self.frame is None else self.frame.copy()

    def disconnect(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        self._thread = None
        self.connected = False
        self.frame = None

    def status(self) -> dict:
        return {
            "connected": self.connected,
            "url": (re.sub(r"//[^@]+@", "//***@", self.url) if self.url else None),
            "error": self.error,
        }


camera = RtspCamera()


# EZVIZ/Hikvision firmwares expose the stream under different paths — if the
# given one fails, try the other well-known ones before giving up
RTSP_FALLBACK_PATHS = [
    "/H.264",
    "/Streaming/Channels/101",
    "/Streaming/Channels/102",
    "/h264/ch1/main/av_stream",
    "/live/ch0",
]


def get_setting(key: str) -> str | None:
    conn = get_conn()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else None


def set_setting(key: str, value: str | None):
    conn = get_conn()
    if value is None:
        conn.execute("DELETE FROM settings WHERE key = ?", (key,))
    else:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
    conn.commit()
    conn.close()


@app.post("/cctv/camera/connect")
def camera_connect(payload: dict):
    url = payload["url"]
    remember = payload.get("remember", True)
    result = camera.connect(url)
    working_url = url

    # Path guessing only makes sense for RTSP URLs, not local files
    if not result["connected"] and url.lower().startswith("rtsp://"):
        base, _, path = url.rpartition("/")
        for candidate in RTSP_FALLBACK_PATHS:
            if f"/{path}" == candidate:
                continue
            result = camera.connect(base + candidate)
            if result["connected"]:
                working_url = base + candidate
                result["path_used"] = candidate
                break

    if result["connected"] and remember:
        set_setting("rtsp_url", working_url)
        remember_camera_mac(working_url)
        result["saved"] = True
    return result


@app.get("/cctv/camera/saved")
def camera_saved():
    """The stored RTSP URL, with the password masked for display."""
    url = get_setting("rtsp_url")
    if not url:
        return {"saved": False}
    return {
        "saved": True,
        "url_masked": re.sub(r"//([^:]+):[^@]+@", r"//\1:••••••@", url),
        "mac": get_setting("rtsp_mac"),
    }


@app.post("/cctv/camera/forget")
def camera_forget():
    set_setting("rtsp_url", None)
    set_setting("rtsp_mac", None)
    camera.disconnect()
    return {"saved": False}


@app.post("/cctv/camera/reconnect")
def camera_reconnect():
    """Reconnect using the saved URL — no need to retype credentials."""
    url = get_setting("rtsp_url")
    if not url:
        return {"connected": False, "error": "No saved camera."}
    result = camera.connect(url)
    if result["connected"]:
        remember_camera_mac(url)
    return result


def mac_for_ip(ip: str) -> str | None:
    """MAC address of an IP from the kernel ARP table (Linux)."""
    try:
        with open("/proc/net/arp") as f:
            for line in f.readlines()[1:]:
                cols = line.split()
                if cols[0] == ip and cols[3] != "00:00:00:00:00:00":
                    return cols[3].lower()
    except OSError:
        pass
    return None


def probe(ip: str, port: int, timeout: float = 0.5) -> bool:
    """TCP-touch an IP — also populates the ARP table so we can read its MAC."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        return s.connect_ex((ip, port)) == 0


def rediscover_camera(url: str) -> str | None:
    """The camera's DHCP lease moved it to a new IP — find it again.

    The camera is pinned by MAC address, which never changes. We sweep the
    server's /24 for open RTSP ports, then match the hardware address, so a
    router reboot or new DHCP lease can't take the demo down.
    """
    m = re.match(r"(rtsp://[^@]+@)([\d.]+)(:\d+)?(/.*)?$", url)
    if not m:
        return None
    creds, old_ip = m.group(1), m.group(2)
    port_s, path = m.group(3) or ":554", m.group(4) or "/H.264"
    port = int(port_s.lstrip(":"))
    subnet = old_ip.rsplit(".", 1)[0]
    known_mac = get_setting("rtsp_mac")

    candidates = [f"{subnet}.{i}" for i in range(1, 255) if f"{subnet}.{i}" != old_ip]
    with ThreadPoolExecutor(max_workers=64) as pool:
        hits = [
            ip
            for ip, ok in zip(candidates, pool.map(lambda i: probe(i, port), candidates))
            if ok
        ]

    # The camera's own MAC wins over any other RTSP device on the network
    if known_mac:
        hits.sort(key=lambda ip: mac_for_ip(ip) != known_mac)

    for ip in hits:
        if known_mac and mac_for_ip(ip) not in (known_mac, None):
            continue  # a different RTSP device — not our camera
        candidate_url = f"{creds}{ip}{port_s}{path}"
        if camera.connect(candidate_url)["connected"]:
            print(f"Camera rediscovered at {ip} (was {old_ip})")
            set_setting("rtsp_url", candidate_url)
            return candidate_url
    return None


def remember_camera_mac(url: str):
    """Pin the camera to its hardware address so IP changes don't matter."""
    m = re.search(r"@([\d.]+)", url)
    if not m:
        return
    ip = m.group(1)
    probe(ip, 554)  # ensure it's in the ARP table
    mac = mac_for_ip(ip)
    if mac:
        set_setting("rtsp_mac", mac)


def camera_watchdog():
    """Keep the saved camera alive: reconnect on drop, rediscover on IP change."""
    time.sleep(2)  # let the app finish starting
    failures = 0
    while True:
        url = get_setting("rtsp_url")
        if url and not camera.connected:
            if camera.connect(url)["connected"]:
                remember_camera_mac(url)  # keep the hardware pin fresh
                failures = 0
            else:
                failures += 1
                # A couple of plain retries first — a brief network blip
                # shouldn't trigger a full subnet scan
                if failures >= 3:
                    if rediscover_camera(url):
                        failures = 0
                    else:
                        failures = 0  # start the cycle over rather than scan on a loop
        else:
            failures = 0
        time.sleep(15)


threading.Thread(target=camera_watchdog, daemon=True).start()


@app.post("/cctv/camera/disconnect")
def camera_disconnect():
    camera.disconnect()
    return camera.status()


@app.get("/cctv/camera/status")
def camera_status():
    return camera.status()


@app.get("/cctv/camera/frame.jpg")
def camera_frame():
    frame = camera.latest()
    if frame is None:
        return Response(status_code=503)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return Response(status_code=500)
    return Response(
        content=buf.tobytes(),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/cctv/camera/analyse")
def camera_analyse(zone_id: str = "MBJB-A1"):
    """Run the multi-plate CCTV pipeline on the newest live frame."""
    frame = camera.latest()
    if frame is None:
        return {"vehicles": [], "frame": None, "error": camera.error or "No frame yet"}
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    vehicles = detect_all_plates(rgb, zone_id)
    h, w = frame.shape[:2]
    return {"vehicles": vehicles, "frame": {"w": w, "h": h}}


def detect_all_plates(frame: np.ndarray, zone_id: str) -> list[dict]:
    """Every plausible plate in the frame, with box + payment status."""
    vehicles = []
    for r in alpr.predict(frame):
        if not r.ocr or not r.ocr.text:
            continue
        bb = r.detection.bounding_box
        if (
            r.detection.confidence < DETECTION_THRESHOLD
            or bb.x2 - bb.x1 < MIN_BOX_WIDTH
            or bb.y2 - bb.y1 < MIN_BOX_HEIGHT
        ):
            continue
        plate, format_ok = coerce_malaysian(normalize_plate(r.ocr.text))
        if len(plate) < MIN_PLATE_CHARS:
            continue
        confidence = round(ocr_confidence(r.ocr), 3)
        entry = {
            "plate": plate,
            "confidence": confidence,
            "box": {
                "x1": round(bb.x1),
                "y1": round(bb.y1),
                "x2": round(bb.x2),
                "y2": round(bb.y2),
            },
        }
        if not format_ok or confidence < CONFIDENCE_THRESHOLD:
            entry.update(status="uncertain", detail="Low confidence read")
        else:
            entry.update(**payment_status(plate, zone_id))
        vehicles.append(entry)
    return vehicles


@app.post("/cctv/scan")
def cctv_scan(image: UploadFile = File(...), zone_id: str = Form(...)):
    """Unattended-camera mode: detect and check EVERY plate in the frame.

    Returns bounding boxes so the client can draw a live overlay. No photos
    are stored — CCTV evidence capture happens only when a violation is
    flagged and approved by a human reviewer.
    """
    raw = image.file.read()
    pil = Image.open(io.BytesIO(raw)).convert("RGB")
    vehicles = detect_all_plates(np.array(pil), zone_id)
    return {"vehicles": vehicles, "frame": {"w": pil.width, "h": pil.height}}


@app.get("/vehicle/{plate}")
def vehicle_record(plate: str):
    """Roadblock lookup against the mock JPJ registry: road tax, insurance,
    outstanding summons, stolen flag."""
    plate = normalize_plate(plate)
    conn = get_conn()
    row = conn.execute("SELECT * FROM vehicles WHERE plate = ?", (plate,)).fetchone()
    conn.close()
    if row is None:
        return {"found": False, "plate": plate}

    def expiry_status(date_str):
        expiry = datetime.fromisoformat(date_str).date()
        today = datetime.now().date()
        days = (expiry - today).days
        return {
            "status": "valid" if days >= 0 else "expired",
            "expiry": date_str,
            "days": days,
        }

    return {
        "found": True,
        "plate": plate,
        "make_model": row["make_model"],
        "color": row["color"],
        "road_tax": expiry_status(row["road_tax_expiry"]),
        "insurance": expiry_status(row["insurance_expiry"]),
        "summons_count": row["summons_count"],
        "stolen": bool(row["stolen"]),
    }


@app.get("/payments/{plate}")
def payment_history(plate: str):
    """Citizen's parking records — photo evidence included."""
    conn = get_conn()
    rows = [
        dict(r)
        for r in conn.execute(
            "SELECT * FROM payments WHERE plate = ? ORDER BY id DESC LIMIT 20",
            (normalize_plate(plate),),
        )
    ]
    conn.close()
    return rows


@app.get("/zones")
def zones():
    conn = get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM zones")]
    conn.close()
    return rows


@app.get("/officers")
def officers():
    conn = get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM officers")]
    conn.close()
    return rows


@app.get("/compounds")
def list_compounds():
    conn = get_conn()
    rows = [
        dict(r)
        for r in conn.execute("SELECT * FROM compounds ORDER BY created_at DESC")
    ]
    conn.close()
    return rows
