# ParkScan

**AI reads the plate. A human signs the compound.**

Live: **https://parking.trai.my**

An enforcement officer points a phone at a licence plate. On-device-class ALPR reads it,
the backend checks whether that vehicle has paid *for the zone the officer is standing in*,
and returns a verdict in one screen. If the vehicle is unpaid, ParkScan pre-fills a compound
with the evidence photo, GPS, timestamp and the OCR confidence score — and then waits.
**The system never issues a compound on its own; an officer confirms every one.**

## The four verdicts

| | Verdict | Meaning |
|---|---|---|
| 🟢 | **Paid** | A valid session covers this plate in this zone |
| 🟡 | **Grace** | The session expired less than `GRACE_MINUTES` ago |
| 🔴 | **Unpaid** | No session — the compound flow opens |
| ⚫ | **Unreadable** | OCR confidence below `CONFIDENCE_THRESHOLD`, or the read is not a valid Malaysian plate format — handed to the officer to type manually |

The threshold is a *policy* setting, not a technical artefact: a council can tune how much
model uncertainty it is willing to act on, and is accountable for that number. Anything below
it becomes a human decision before it can become a fine.

## Why the evidence matters

A compound is easy to issue and expensive to defend. Every ParkScan compound carries its own
evidence: the photograph the verdict was made from, where and when it was taken, how confident
the model was, and which officer signed it. That is the point of the product — enforcement that
is faster to carry out and harder to overturn on appeal.

## Architecture

| Layer | Implementation |
|---|---|
| Detection + OCR | [`fast-alpr`](https://github.com/ankandrew/fast-alpr) — `yolo-v9-s-608-license-plate-end2end` detector + `cct-s-v2-global-model` OCR, both ONNX, **CPU inference**. No GPU, no third-party vision API: images never leave the server. |
| Backend | FastAPI + SQLite. Scanning, payment status, compound issue, vehicle records, nearest-zone lookup by GPS, camera control. |
| Frontend | Next.js PWA (camera via `getUserMedia`, Tailwind). Proxies `/api/backend/*` → FastAPI. |
| Surfaces | Citizen `/park` · Officer `/officer` · Police lookup `/police` · Fixed camera `/cctv` |

No LLM sits anywhere in the enforcement path — the verdict logic is deterministic code.

## Run locally

```bash
# Backend (port 8000)
cd backend
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000

# Frontend (port 3000)
cd frontend
npm run dev
```

Open http://localhost:3000 — the camera works on localhost without HTTPS.

## Test without a car

```bash
cd backend
curl -F "image=@test_car.png" -F "zone_id=MBJB-A1" http://localhost:8000/scan
```

The sample image reads as plate `5AU5341` (a US plate, so it lands in the grey
"confirm manually" path — only Malaysian-format plates get an automatic verdict).
Mark any plate as paid via the citizen page at http://localhost:3000/pay (or `POST /pay`).

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

## Demo on a real phone

`getUserMedia` requires HTTPS off-localhost. Easiest path:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

Open the generated `https://…trycloudflare.com` URL on the phone, allow camera +
location, then "Add to Home Screen" for the full-screen PWA feel. Only the frontend
needs tunnelling — it proxies all API calls to the backend.

## Deployment

`parking.trai.my` runs from this repository, not from a build artifact. Two systemd units,
fronted by a Cloudflare Tunnel:

| Unit | Process | Port |
|---|---|---|
| `parkscan-backend.service` | `uvicorn main:app` | `127.0.0.1:8010` (loopback only) |
| `parkscan-frontend.service` | `next start` | `:3010`, reached through the tunnel |

The frontend talks to the backend over `BACKEND_URL=http://127.0.0.1:8010`; the API is never
exposed directly. Both units are `enabled` with `Restart=always`.

Deploying is `git pull` followed by a restart of the affected unit.

## Current status

Honest about what is real and what is staged:

- **Real**: the ALPR pipeline, the verdict logic, the compound evidence chain, the officer and
  citizen flows, the fixed-camera mode, and the live deployment above.
- **Seeded**: zones (`MBJB-A1`, `MBJB-A2`, `MBPP-B1`), officers, and vehicle records.
- **Simulated**: payment. `POST /pay` writes a session directly rather than settling through a
  real rail. Wiring a Malaysian payment rail is the next piece of work.

Runtime data — `backend/parking.db` and `backend/photos/` — is deliberately not tracked: it
holds real plate reads and evidence photographs.

## Key knobs

- `backend/main.py`: `CONFIDENCE_THRESHOLD` (0.85), `GRACE_MINUTES` (15)
- Reset demo data: delete `backend/parking.db` and restart the backend.

## Roadmap: cloud-connected cameras

The live CCTV mode uses **local RTSP** today (`rtsp://…@camera-ip:554/H.264`),
which is low-latency (~180 ms/frame) and works fully offline, but requires the
camera and backend to be on the same LAN. A watchdog re-discovers the camera by
MAC address if DHCP changes its IP, and backs off to a long poll interval when the
camera stays unreachable.

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

## AI disclosure

The plate detector and OCR are pre-trained open weights used as published; no model here has
been trained or fine-tuned on Malaysian personal data. This codebase was built with AI
assistance (Claude Code), with the architecture, enforcement policy and every deployment
decided and reviewed by the team.
