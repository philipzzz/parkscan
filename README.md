# ParkScan — AI-assisted parking enforcement (hackathon demo)

Officer points a phone camera at a license plate → on-device-quality ALPR reads it →
instant payment status (green/yellow/red/grey) → if unpaid, the AI pre-fills a compound
with photo, GPS, time and OCR confidence — **the officer always confirms; AI never fines
anyone automatically**.

## Stack

- `frontend/` — Next.js PWA (camera via `getUserMedia`, Tailwind). Proxies `/api/backend/*` → FastAPI.
- `backend/` — FastAPI + [fast-alpr](https://github.com/ankandrew/fast-alpr) (ONNX plate detection + OCR, runs on CPU) + SQLite.

## Run

```bash
# Backend (port 8000)
cd backend
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend (port 3000)
cd frontend
npm run dev
```

Open http://localhost:3000 — camera works on localhost without HTTPS.

## Test without a car

```bash
cd backend
curl -F "image=@test_car.png" -F "zone_id=MBJB-A1" http://localhost:8000/scan
```

The sample image reads as plate `5AU5341` (a US plate, so it lands in the grey
"confirm manually" path — only Malaysian-format plates get an automatic verdict).
Mark any plate as paid via the citizen page at http://localhost:3000/pay (or `POST /pay`).

## Demo on a real phone

`getUserMedia` requires HTTPS off-localhost. Easiest path:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

Open the generated `https://…trycloudflare.com` URL on the phone, allow camera +
location, then "Add to Home Screen" for the full-screen PWA feel. Only the frontend
needs tunneling — it proxies all API calls to the backend.

## Demo script (3 paths)

Seeded data (zone `MBJB-A1`):

| Plate     | Status                              |
| --------- | ----------------------------------- |
| `WVX2345` | Paid (green)                        |
| `JQA8123` | Expired 12 min ago (yellow, grace)  |
| anything else | Unpaid (red) → compound flow    |

1. **Green** — pay for a real plate at `/pay`, then scan it.
2. **Red** — scan any unpaid plate → "Issue compound" → review AI-prepared evidence → confirm.
3. **Grey** — a dirty/angled plate drops OCR confidence below 85% → officer corrects the plate manually. Duplicate scans of a compounded car show "already compounded".

## Key knobs

- `backend/main.py`: `CONFIDENCE_THRESHOLD` (0.85), `GRACE_MINUTES` (15)
- Reset demo data: delete `backend/parking.db` and restart the backend.

## Roadmap: cloud-connected cameras

The live CCTV mode uses **local RTSP** today (`rtsp://…@camera-ip:554/H.264`),
which is low-latency (~180 ms/frame) and works fully offline, but requires the
camera and backend to be on the same LAN. A watchdog re-discovers the camera by
MAC address if DHCP changes its IP.

For multi-site rollout, integrate the **EZVIZ Open Platform** cloud API instead
of (or alongside) local RTSP:

- Auth: `POST /api/lapp/token/get` with `appKey` + `appSecret` → `accessToken`
- Devices: `POST /api/lapp/device/list`
- Live address: `POST /api/lapp/live/address/get` → HLS/RTMP/FLV URL
- Snapshot: `POST /api/lapp/device/capture`

Trade-off: cameras can live anywhere (no VPN / same-subnet requirement), but
latency rises to ~1–3 s (cloud relay) and calls are rate-limited. Plan is to add
this as a second video source in the `/cctv` page. Requires an EZVIZ developer
account (appKey/appSecret) — not needed for the local-RTSP demo.
