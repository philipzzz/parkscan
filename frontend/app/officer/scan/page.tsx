"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Check,
  X,
  AlertTriangle,
  HelpCircle,
  Ticket,
  MapPin,
  FileText,
  ScanLine,
} from "lucide-react";

type Patrol = {
  zoneId: string;
  officerId: string;
  zoneName?: string;
  council?: string;
  officerName?: string;
};

type Box = { x1: number; y1: number; x2: number; y2: number };

type Status = "paid" | "expired" | "unpaid" | "uncertain" | "compounded";

type Detection = {
  plate: string;
  confidence: number;
  box: Box;
  status: Status;
  detail?: string;
};

type Tracked = Detection & {
  firstSeen: number;
  lastSeen: number;
  photo?: string | null;
  compoundId?: number;
};

const STATUS: Record<
  string,
  {
    stroke: string;
    pill: string;
    label: string;
    Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  }
> = {
  paid: { stroke: "#2d7a3a", pill: "bg-green-bg text-green", label: "Paid", Icon: Check },
  expired: { stroke: "#a05c0a", pill: "bg-amber-bg text-amber", label: "Grace", Icon: AlertTriangle },
  unpaid: { stroke: "#b42525", pill: "bg-red-bg text-red", label: "Unpaid", Icon: X },
  uncertain: { stroke: "#87867f", pill: "bg-ivory-2 text-slate-3", label: "Confirm plate", Icon: HelpCircle },
  compounded: { stroke: "#3b6fc0", pill: "bg-blue-bg text-blue", label: "Compounded", Icon: Ticket },
};

// A car stays in the on-screen list this long after it was last seen, so an
// officer can still act on a plate that has already driven out of frame.
const KEEP_MS = 20_000;

export default function ScanPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(false);
  const buzzedRef = useRef<Set<string>>(new Set());
  const patrolRef = useRef<Patrol | null>(null);

  const [patrol, setPatrol] = useState<Patrol | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [tracked, setTracked] = useState<Record<string, Tracked>>({});
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [now, setNow] = useState(0);

  // Plate the officer tapped to act on, and the flow step for it
  const [selected, setSelected] = useState<string | null>(null);
  const [editedPlate, setEditedPlate] = useState("");
  const [view, setView] = useState<"scan" | "compound" | "issued">("scan");
  const [compoundId, setCompoundId] = useState<number | null>(null);

  // Load patrol config, open the camera and start watching GPS
  useEffect(() => {
    const saved = localStorage.getItem("patrol");
    if (!saved) {
      router.replace("/officer");
      return;
    }
    const cfg = JSON.parse(saved) as Patrol;
    patrolRef.current = cfg;
    setPatrol(cfg);

    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() =>
        setCameraError(
          "Camera unavailable. Use HTTPS (or localhost) and allow camera access."
        )
      );

    const watchId = navigator.geolocation?.watchPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (watchId != null) navigator.geolocation?.clearWatch(watchId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Map a plate box (in original frame pixels) onto the object-cover video,
  // which is scaled up and centre-cropped to fill the screen.
  const drawOverlay = useCallback(
    (detections: Detection[], frameW: number, frameH: number) => {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || !overlay) return;
      const cw = video.clientWidth;
      const ch = video.clientHeight;
      overlay.width = cw;
      overlay.height = ch;
      const scale = Math.max(cw / frameW, ch / frameH);
      const offX = (cw - frameW * scale) / 2;
      const offY = (ch - frameH * scale) / 2;
      const ctx = overlay.getContext("2d")!;
      ctx.clearRect(0, 0, cw, ch);
      ctx.font = "700 13px ui-monospace, monospace";
      for (const d of detections) {
        const color = STATUS[d.status]?.stroke ?? "#87867f";
        const x = d.box.x1 * scale + offX;
        const y = d.box.y1 * scale + offY;
        const w = (d.box.x2 - d.box.x1) * scale;
        const h = (d.box.y2 - d.box.y1) * scale;
        const pad = 12;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
        const label = ` ${d.plate} · ${STATUS[d.status]?.label ?? d.status} `;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(x - pad, y - pad - 21, tw + 4, 21);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, x - pad + 2, y - pad - 6);
      }
    },
    []
  );

  // One full-frame pass: detect every plate, draw boxes, keep evidence.
  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = captureRef.current;
    if (!video || !canvas || video.readyState < 2 || busyRef.current) return;
    busyRef.current = true;
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      canvas.width = vw;
      canvas.height = vh;
      canvas.getContext("2d")!.drawImage(video, 0, 0, vw, vh);

      const blob: Blob = await new Promise((res) =>
        canvas.toBlob((b) => res(b!), "image/jpeg", 0.85)
      );
      const form = new FormData();
      form.append("image", blob, "frame.jpg");
      form.append("zone_id", patrolRef.current!.zoneId);

      const r = await fetch("/api/backend/cctv/scan", { method: "POST", body: form });
      const data: { vehicles: Detection[]; frame: { w: number; h: number } } =
        await r.json();
      setScanCount((c) => c + 1);
      drawOverlay(data.vehicles, data.frame.w, data.frame.h);

      // A single downscaled snapshot of this frame becomes the evidence photo
      // for any plate read in it — the actual car, at the moment it was seen.
      let snapshot: string | null = null;
      if (data.vehicles.some((v) => v.status === "unpaid" || v.status === "uncertain")) {
        const shot = document.createElement("canvas");
        const sw = Math.min(960, vw);
        shot.width = sw;
        shot.height = Math.round((vh / vw) * sw);
        shot.getContext("2d")!.drawImage(video, 0, 0, shot.width, shot.height);
        snapshot = shot.toDataURL("image/jpeg", 0.6);
      }

      const t = Date.now();
      setTracked((prev) => {
        const next = { ...prev };
        for (const d of data.vehicles) {
          const existing = next[d.plate];
          next[d.plate] = {
            ...d,
            firstSeen: existing?.firstSeen ?? t,
            lastSeen: t,
            // keep the old evidence photo if we didn't take a fresh one
            photo: snapshot ?? existing?.photo ?? null,
            // never downgrade a car we've already fined
            status: existing?.compoundId ? "compounded" : d.status,
            compoundId: existing?.compoundId,
          };
        }
        return next;
      });

      for (const d of data.vehicles) {
        if (d.status === "unpaid" && !buzzedRef.current.has(d.plate)) {
          buzzedRef.current.add(d.plate);
          navigator.vibrate?.([90, 50, 90]);
        }
      }
    } catch {
      // transient network error — the next tick retries
    } finally {
      busyRef.current = false;
    }
  }, [drawOverlay]);

  // Scan continuously, but pause while the officer is reviewing a plate so the
  // list underneath the sheet stops shifting around.
  const paused = view !== "scan" || selected !== null;
  useEffect(() => {
    if (paused || cameraError) {
      const o = overlayRef.current;
      o?.getContext("2d")?.clearRect(0, 0, o.width, o.height);
      return;
    }
    const id = setInterval(scanFrame, 800);
    return () => clearInterval(id);
  }, [scanFrame, paused, cameraError]);

  // Tick so "Xs ago" and the auto-expiry of stale cars stay live
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  function openPlate(plate: string) {
    setSelected(plate);
    setEditedPlate(plate);
  }

  function closeSheet() {
    setSelected(null);
    setView("scan");
    setCompoundId(null);
  }

  async function recheckPlate() {
    const r = await fetch(
      `/api/backend/status/${editedPlate}?zone_id=${patrolRef.current!.zoneId}`
    );
    const data = await r.json();
    setTracked((prev) => {
      const base = prev[selected!];
      if (!base) return prev;
      return {
        ...prev,
        [selected!]: { ...base, ...data, plate: editedPlate, confidence: base.confidence },
      };
    });
  }

  async function issueCompound() {
    const v = tracked[selected!];
    const r = await fetch("/api/backend/compounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plate: editedPlate,
        zone_id: patrolRef.current!.zoneId,
        officer_id: patrolRef.current!.officerId,
        lat: gps?.lat,
        lng: gps?.lng,
        photo: v?.photo,
        confidence: v?.confidence,
      }),
    });
    const data = await r.json();
    setTracked((prev) => ({
      ...prev,
      [selected!]: {
        ...prev[selected!],
        status: "compounded",
        compoundId: data.id,
        detail: data.detail ?? prev[selected!]?.detail,
      },
    }));
    if (data.status === "duplicate") {
      // Another officer (or the CCTV reviewer) got there first
      setView("scan");
      setSelected(null);
      return;
    }
    setCompoundId(data.id);
    setView("issued");
  }

  // Newest activity first; unpaid always floats to the top. Drop cars we
  // haven't seen for a while (unless they still need action).
  const vehicles = Object.values(tracked)
    .filter((v) => now - v.lastSeen < KEEP_MS || v.status === "unpaid")
    .sort((a, b) => {
      const rank = (s: Status) => (s === "unpaid" ? 0 : s === "uncertain" ? 1 : 2);
      if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
      return b.lastSeen - a.lastSeen;
    });
  const unpaidCount = vehicles.filter((v) => v.status === "unpaid").length;
  const sel = selected ? tracked[selected] : null;

  return (
    <main className="flex-1 flex flex-col relative bg-slate min-h-dvh overflow-hidden">
      {/* Top bar */}
      <header className="absolute top-0 inset-x-0 z-30 p-3">
        <div className="flex items-center justify-between bg-white/95 backdrop-blur rounded-full px-2 py-2 text-[13px] shadow-[0_2px_16px_rgba(20,20,19,0.12)]">
          <button
            onClick={() => router.push("/officer")}
            className="flex items-center gap-0.5 font-[620] text-slate-2 rounded-full px-3 py-1.5 active:bg-ivory-2 transition-colors"
          >
            <ChevronLeft size={15} strokeWidth={2} />
            <span className="font-mono text-[12.5px]">{patrol?.zoneId}</span>
          </button>
          <div className="flex items-center gap-2 pr-2.5">
            <span className="text-cloud">{scanCount} scans</span>
            <span
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-[620] ${
                gps ? "bg-green-bg text-green" : "bg-ivory-2 text-cloud-2"
              }`}
            >
              <MapPin size={11} strokeWidth={2} /> GPS
            </span>
          </div>
        </div>
      </header>

      {/* Camera + live detection overlay */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />
      <canvas ref={captureRef} className="hidden" />

      {cameraError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-8 bg-ivory">
          <div className="bg-white rounded-[16px] border border-border p-6 text-center text-slate-3 text-[15px] animate-fade-in">
            {cameraError}
          </div>
        </div>
      )}

      {/* Drive-and-scan hint until the first plate shows up */}
      {!cameraError && vehicles.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none gap-3">
          <ScanLine size={30} strokeWidth={1.6} className="text-white/70 animate-pulse" />
          <p className="text-white/75 text-[13.5px]">
            Scanning every plate in view — just drive
          </p>
        </div>
      )}

      {/* Live detections — the officer taps any plate to act on it */}
      {!cameraError && vehicles.length > 0 && !selected && view === "scan" && (
        <div className="absolute bottom-0 inset-x-0 z-20 animate-sheet-up">
          <div className="relative bg-white/97 backdrop-blur rounded-t-[22px] shadow-[0_-8px_40px_rgba(20,20,19,0.25)] max-h-[46dvh] flex flex-col">
            <div className="w-9 h-1 rounded-full bg-ivory-3 absolute left-1/2 -translate-x-1/2 top-1.5" />
            <div className="flex items-center justify-between px-5 pt-3.5 pb-2">
              <span className="text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud">
                In view · {vehicles.length}
              </span>
              {unpaidCount > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-red-bg text-red px-2.5 py-1 text-[11.5px] font-[700]">
                  {unpaidCount} unpaid
                </span>
              )}
            </div>
            <div className="overflow-y-auto px-3 pb-4 space-y-1.5">
              {vehicles.map((v) => {
                const s = STATUS[v.status] ?? STATUS.uncertain;
                return (
                  <button
                    key={v.plate}
                    onClick={() => openPlate(v.plate)}
                    className={`w-full flex items-center justify-between gap-3 rounded-[14px] px-3.5 py-3 text-left transition-all active:scale-[0.99] ${
                      v.status === "unpaid" ? "bg-red-bg" : "bg-ivory-2 active:bg-ivory-3"
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-[17px] tracking-[0.1em] text-slate">
                        {v.plate}
                      </span>
                      <span className="block text-[11.5px] text-cloud mt-0.5 truncate">
                        {v.compoundId
                          ? `compound #${v.compoundId}`
                          : v.detail ??
                            `seen ${Math.max(0, Math.floor((now - v.lastSeen) / 1000))}s ago`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-[620] ${s.pill}`}
                      >
                        <s.Icon size={12} strokeWidth={2.2} />
                        {s.label}
                      </span>
                      {v.status === "unpaid" && (
                        <span className="flex items-center gap-1 bg-clay text-white rounded-full px-3 py-1.5 text-[12px] font-[620]">
                          <Ticket size={13} strokeWidth={2} /> Issue
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Action sheet — review one plate, correct it, then issue */}
      {sel && view === "scan" && (
        <div className="absolute inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-slate/40" onClick={closeSheet} />
          <div className="relative bg-white rounded-t-[24px] shadow-[0_-8px_40px_rgba(20,20,19,0.3)] p-5 pb-8 space-y-5 animate-sheet-up">
            <div className="w-9 h-1 rounded-full bg-ivory-3 mx-auto -mt-1" />
            <div className="text-center space-y-2.5">
              <div className="font-mono text-[34px] font-bold tracking-[0.12em] text-slate leading-none">
                {sel.plate}
              </div>
              <div
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-[620] ${
                  (STATUS[sel.status] ?? STATUS.uncertain).pill
                }`}
              >
                {(() => {
                  const I = (STATUS[sel.status] ?? STATUS.uncertain).Icon;
                  return <I size={15} strokeWidth={2.2} />;
                })()}
                {(STATUS[sel.status] ?? STATUS.uncertain).label}
              </div>
              {sel.detail && (
                <div className="text-[13.5px] text-slate-3">{sel.detail}</div>
              )}
              {sel.confidence != null && (
                <div className="text-[12px] text-cloud-2">
                  OCR confidence {(sel.confidence * 100).toFixed(0)}%
                </div>
              )}
            </div>

            {/* Manual correction — the grey "confirm plate" path */}
            <div className="flex gap-2">
              <input
                value={editedPlate}
                onChange={(e) => setEditedPlate(e.target.value.toUpperCase())}
                className="flex-1 bg-ivory border border-ivory-3 rounded-[12px] px-3 py-3 font-mono text-[17px] text-center tracking-[0.15em] focus:outline-none focus:border-clay focus:ring-2 focus:ring-clay/15"
              />
              <button
                onClick={recheckPlate}
                className="bg-slate text-white font-[620] rounded-[12px] px-5 active:scale-[0.97] transition-transform"
              >
                Check
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={closeSheet}
                className="flex-1 bg-ivory-2 active:bg-ivory-3 text-slate-2 rounded-full py-4 font-[620] text-[15px] transition-all active:scale-[0.98]"
              >
                Close
              </button>
              {sel.status === "unpaid" && (
                <button
                  onClick={() => setView("compound")}
                  className="flex-[1.4] flex items-center justify-center gap-1.5 bg-clay hover:bg-clay-dk text-white rounded-full py-4 font-[620] text-[15px] transition-all active:scale-[0.98]"
                >
                  <Ticket size={16} strokeWidth={1.8} />
                  Issue compound
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compound confirmation — the human-in-the-loop step */}
      {view === "compound" && sel && (
        <div className="absolute inset-0 z-50 bg-ivory overflow-y-auto animate-fade-in">
          <div className="max-w-md mx-auto p-5 space-y-4">
            <h2 className="font-serif text-[28px] tracking-tight pt-5">
              Confirm compound
            </h2>
            <p className="text-[14px] text-slate-3 -mt-2">
              AI prepared this notice. Nothing is issued without your
              confirmation.
            </p>

            {sel.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sel.photo}
                alt="Evidence"
                className="rounded-[16px] border border-border w-full"
              />
            )}

            <div className="bg-white rounded-[16px] border border-border divide-y divide-border text-[14px]">
              {[
                ["Plate", editedPlate],
                ["Zone", `${patrol?.zoneId} — ${patrol?.zoneName ?? ""}`],
                ["Council", patrol?.council ?? "—"],
                ["Officer", `${patrol?.officerId} ${patrol?.officerName ?? ""}`],
                ["Time", new Date().toLocaleString()],
                [
                  "GPS",
                  gps
                    ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
                    : "unavailable",
                ],
                [
                  "OCR confidence",
                  sel.confidence != null
                    ? `${(sel.confidence * 100).toFixed(0)}%`
                    : "manual entry",
                ],
                ["Offence", "Parking without valid payment"],
                ["Amount", "RM 100.00"],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-4 px-4 py-3">
                  <span className="text-cloud">{k}</span>
                  <span className="text-right font-[550] text-slate-2">{v}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-3 pb-8 pt-1">
              <button
                onClick={() => setView("scan")}
                className="flex-1 bg-white border border-ivory-3 active:bg-ivory-2 text-slate-2 rounded-full py-4 font-[620] text-[15px] transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={issueCompound}
                className="flex-[1.4] bg-clay hover:bg-clay-dk text-white rounded-full py-4 font-[620] text-[15px] transition-all active:scale-[0.98]"
              >
                Confirm &amp; issue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issued */}
      {view === "issued" && (
        <div className="absolute inset-0 z-50 bg-ivory flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-green-bg text-green flex items-center justify-center animate-pop-in">
            <Check size={30} strokeWidth={2.4} />
          </div>
          <h2 className="font-serif text-[28px] tracking-tight animate-fade-in">
            Compound #{compoundId} issued
          </h2>
          <p className="text-slate-3 text-[14px] max-w-xs animate-fade-in">
            <span className="font-mono font-[620]">{editedPlate}</span> ·{" "}
            {patrol?.zoneId} · recorded with photo, GPS and a full audit trail
          </p>
          <div className="flex flex-col items-center gap-3 mt-3 animate-fade-in">
            <button
              onClick={closeSheet}
              className="bg-clay hover:bg-clay-dk text-white rounded-full px-9 py-4 font-[620] text-[15px] transition-all active:scale-[0.98]"
            >
              Continue patrol
            </button>
            <a
              href="/officer/records"
              className="flex items-center gap-1.5 text-[13px] text-slate-3 hover:text-slate"
            >
              <FileText size={14} strokeWidth={1.8} /> View all records
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
