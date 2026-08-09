# ParkScan

**Parking you can actually pay for.** Photograph your car, confirm, pay — and get a
reminder before the session runs out.

Live: **https://parking.trai.my**

Collection is the product. Enforcement is only the backstop.

## Why

People are willing to pay. Millions do it every day at mall car parks and toll gantries
without a single complaint — because there is nothing there to argue with. You used it,
the system counted it, you paid.

Street parking is the opposite. To pay once, a motorist opens an app, picks a state, a
council, a zone, types or selects a plate, picks a duration, discovers the prepaid wallet
is short, tops it up, and comes back. Seven or eight steps, with money lodged in advance.
Own three cars and you must first pick the right one from a dropdown.

So collection is low — and the usual answer is to enforce harder. That is treating the
symptom. ParkScan treats the cause.

## Paying, in three steps

```
photograph → confirm duration → pay
```

The photograph yields the **plate** (ALPR) and the **zone** (GPS) at the same time, so
there is no state, council, zone or plate to choose. **The plate is the account** — no
registration, no login, no prepaid wallet.

Before the session expires, ParkScan sends a reminder with a one-tap extension. The
operator is paid for the extra time, the driver avoids a compound, and nobody is
penalised. Raising revenue and improving the citizen's experience are the same action
here, not a trade-off.

## The backstop: enforcement

Compounds still have to exist, or payment becomes purely voluntary. An officer points a
phone at a plate and gets one verdict:

| | Verdict | Meaning |
|---|---|---|
| 🟢 | **Paid** | A valid session covers this plate in this zone |
| 🟡 | **Grace** | The session expired less than `GRACE_MINUTES` ago |
| 🔴 | **Unpaid** | No session — the compound flow opens |
| ⚫ | **Unreadable** | OCR confidence below `CONFIDENCE_THRESHOLD`, or not a valid Malaysian plate format — handed to the officer to type manually |

A compound is pre-filled with the evidence photo, GPS, timestamp, OCR confidence, zone and
the issuing officer's ID — then it waits. **The system never issues a compound on its own.**
That is a constraint in the code, not a marketing line, and the confidence threshold is a
*policy* setting a council can tune and be accountable for.

## Architecture

| Layer | Implementation |
|---|---|
| Detection + OCR | [`fast-alpr`](https://github.com/ankandrew/fast-alpr) — `yolo-v9-s-608-license-plate-end2end` detector + `cct-s-v2-global-model` OCR, both ONNX, **CPU inference**. No GPU, no third-party vision API: images never leave the server. |
| Backend | FastAPI + SQLite. Payment sessions, scanning, compound issue, vehicle records, nearest-zone lookup by GPS, camera control. |
| Frontend | Next.js PWA, camera via `getUserMedia`. Citizen `/park`, officer `/officer`, police lookup `/police`. |
| Fixed camera | `/cctv` pulls RTSP frames and reads every plate in view; a watchdog re-discovers the camera by MAC address when DHCP moves it, and backs off when it stays unreachable. |
| Malaysian plates | Reads are normalised and format-checked against Malaysian plate patterns. A read that does not fit is never given an automatic verdict. |

RTSP is a standard protocol, so ParkScan runs on CCTV that is **already installed** — no
system replacement, no cabling, no site shutdown. Measured, one 1080p H.264 stream costs
about 0.2 of a CPU core.

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

## Demo script

Seeded data (zone `MBJB-A1`):

| Plate | Status |
| --------- | ----------------------------------- |
| `WVX2345` | Paid (green) |
| `JQA8123` | Expired 12 min ago (yellow, grace) |
| anything else | Unpaid (red) → compound flow |

1. **Pay** — pay for a real plate at `/pay`, then scan it: green.
2. **Grace** — a session that lapsed minutes ago is not a fine.
3. **Compound** — scan an unpaid plate → review the AI-prepared evidence → confirm.
4. **Grey** — a dirty or angled plate drops OCR confidence below 85% and goes to the officer.

## Demo on a real phone

`getUserMedia` requires HTTPS off-localhost:

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000
```

Open the generated URL on the phone, allow camera and location, then "Add to Home Screen".
Only the frontend needs tunnelling — it proxies all API calls to the backend.

## Deployment

`parking.trai.my` runs from this repository, not from a build artifact. Two systemd units
behind a Cloudflare Tunnel:

| Unit | Process | Port |
|---|---|---|
| `parkscan-backend.service` | `uvicorn main:app` | `127.0.0.1:8010` (loopback only) |
| `parkscan-frontend.service` | `next start` | `:3010`, reached through the tunnel |

The frontend talks to the backend over `BACKEND_URL=http://127.0.0.1:8010`; the API is
never exposed directly. Both units are `enabled` with `Restart=always`. Deploying is
`git pull` and a restart of the affected unit.

## Current status

Honest about what is real and what is staged:

- **Real**: the ALPR pipeline, the verdict logic, the compound evidence chain, the citizen
  and officer flows, the fixed-camera mode, and the live deployment above.
- **Seeded**: zones (`MBJB-A1`, `MBJB-A2`, `MBPP-B1`), officers, vehicle records.
- **Simulated**: payment. `POST /pay` writes a session directly rather than settling
  through a rail.

Runtime data — `backend/parking.db` and `backend/photos/` — is deliberately not tracked:
it holds real plate reads and evidence photographs.

## Roadmap

Ordered by the collection thesis, not by what is fun to build:

1. **A real payment rail** (Curlec / Touch 'n Go) replacing simulated payment.
2. **Expiry reminder with one-tap extension** — the action that actually raises collection.
3. **Pay-by-photograph polish** — the three steps, end to end.
4. **First-sighting policy** — the first time an unpaid vehicle is seen it produces a
   reminder, never a compound; only a later sighting can.
5. **Cloud-connected cameras** — local RTSP works offline at ~180 ms/frame but requires the
   same LAN. The EZVIZ Open Platform API (`/api/lapp/token/get`, `/device/list`,
   `/live/address/get`, `/device/capture`) removes that constraint at the cost of 1–3 s of
   cloud relay latency.

## Key knobs

- `backend/main.py`: `CONFIDENCE_THRESHOLD` (0.85), `GRACE_MINUTES` (15)
- Reset demo data: delete `backend/parking.db` and restart the backend.

## AI disclosure

The plate detector and OCR are pre-trained open weights used as published; no model here
has been trained or fine-tuned on Malaysian personal data. This codebase was built with AI
assistance (Claude Code), with the architecture, the enforcement policy and every
deployment decided and reviewed by the team.
