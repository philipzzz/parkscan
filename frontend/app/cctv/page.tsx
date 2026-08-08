"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cctv,
  Check,
  ChevronLeft,
  Film,
  ShieldCheck,
  Ticket,
  TriangleAlert,
  Upload,
  Video,
} from "lucide-react";

const ZONE_ID = "MBJB-A1";
// Unpaid this long (demo-compressed) => violation candidate for human review
const VIOLATION_AFTER_MS = 15_000;

type Box = { x1: number; y1: number; x2: number; y2: number };

type Detection = {
  plate: string;
  confidence: number;
  box: Box;
  status: "paid" | "expired" | "unpaid" | "uncertain" | "compounded";
  detail?: string;
};

type Tracked = Detection & {
  firstSeen: number;
  lastSeen: number;
  compoundId?: number;
};

const STATUS_COLOR: Record<string, { stroke: string; pill: string; label: string }> = {
  paid: { stroke: "#2d7a3a", pill: "bg-green-bg text-green", label: "Paid" },
  expired: { stroke: "#a05c0a", pill: "bg-amber-bg text-amber", label: "Grace" },
  unpaid: { stroke: "#b42525", pill: "bg-red-bg text-red", label: "Unpaid" },
  uncertain: { stroke: "#87867f", pill: "bg-ivory-2 text-slate-3", label: "Reading" },
  compounded: { stroke: "#3b6fc0", pill: "bg-blue-bg text-blue", label: "Compounded" },
};

export default function CctvPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(false);

  const [tracked, setTracked] = useState<Record<string, Tracked>>({});
  const [scans, setScans] = useState(0);
  const [issuing, setIssuing] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [videoSrc, setVideoSrc] = useState("/cctv-demo.mp4");
  const [customVideo, setCustomVideo] = useState(false);
  const [deviceCam, setDeviceCam] = useState(false);

  // Live RTSP camera mode
  const [live, setLive] = useState(false);
  const [rtspUrl, setRtspUrl] = useState(
    "rtsp://admin:VERIFY_CODE@10.8.0.119:554/H.264"
  );
  const [connecting, setConnecting] = useState(false);
  const [camError, setCamError] = useState("");
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [savedMac, setSavedMac] = useState<string | null>(null);
  const [frameTick, setFrameTick] = useState(0);
  const liveImgRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function stopDeviceCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setDeviceCam(false);
  }

  function loadOwnVideo(file: File | undefined) {
    if (!file) return;
    stopDeviceCamera();
    setLive(false); // stop reading server frames; the RTSP camera stays saved
    setVideoSrc(URL.createObjectURL(file));
    setCustomVideo(true);
    setTracked({});
    setScans(0);
  }

  function useDemoVideo() {
    stopDeviceCamera();
    setLive(false);
    setVideoSrc("/cctv-demo.mp4");
    setCustomVideo(false);
    setTracked({});
    setScans(0);
  }

  // A saved camera reconnects itself on the server at boot — pick it up here
  useEffect(() => {
    (async () => {
      try {
        const [savedRes, statusRes] = await Promise.all([
          fetch("/api/backend/cctv/camera/saved").then((r) => r.json()),
          fetch("/api/backend/cctv/camera/status").then((r) => r.json()),
        ]);
        if (savedRes.saved) {
          setSavedUrl(savedRes.url_masked);
          setSavedMac(savedRes.mac ?? null);
        }
        if (statusRes.connected) setLive(true);
      } catch {
        // backend not up yet — the demo video keeps playing
      }
    })();
  }, []);

  async function connectCamera(useSaved = false) {
    setConnecting(true);
    setCamError("");
    try {
      const endpoint = useSaved
        ? "/api/backend/cctv/camera/reconnect"
        : "/api/backend/cctv/camera/connect";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: useSaved ? undefined : JSON.stringify({ url: rtspUrl }),
      });
      const data = await r.json();
      if (data.connected) {
        stopDeviceCamera();
        setLive(true);
        setTracked({});
        setScans(0);
        if (data.saved) {
          const masked = await fetch("/api/backend/cctv/camera/saved").then((x) =>
            x.json()
          );
          if (masked.saved) {
            setSavedUrl(masked.url_masked);
            setSavedMac(masked.mac ?? null);
          }
        }
      } else {
        setCamError(data.error ?? "Could not connect to the camera.");
      }
    } catch {
      setCamError("Could not reach the backend.");
    } finally {
      setConnecting(false);
    }
  }

  async function forgetCamera() {
    await fetch("/api/backend/cctv/camera/forget", { method: "POST" });
    setSavedUrl(null);
    setLive(false);
  }

  // Use this device's own camera as the fixed CCTV feed — prop up a spare
  // phone or laptop and it behaves exactly like a mounted camera
  async function useDeviceCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 } },
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      setCamError("");
      setLive(false); // switch off the RTSP feed; it stays saved for later
      setDeviceCam(true);
      setCustomVideo(false);
      setTracked({});
      setScans(0);
    } catch {
      setCamError("Camera permission denied — HTTPS is required off-localhost.");
    }
  }

  // The <video> element remounts when deviceCam flips (its key changes), and in
  // live mode it isn't mounted at all — so the stream can only be attached
  // here, after the element for the new mode exists.
  useEffect(() => {
    if (!deviceCam) return;
    const video = videoRef.current;
    if (video && streamRef.current) {
      video.srcObject = streamRef.current;
      video.play().catch(() => {});
    }
    const overlay = overlayRef.current;
    overlay?.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
  }, [deviceCam]);

  // Live mode: refresh the MJPEG-style still and analyse the newest frame
  useEffect(() => {
    if (!live) return;
    const refresh = setInterval(() => setFrameTick((t) => t + 1), 500);
    // The server watchdog reconnects/rediscovers the camera on its own —
    // surface what it's doing instead of showing a frozen frame
    const health = setInterval(async () => {
      try {
        const st = await fetch("/api/backend/cctv/camera/status").then((r) => r.json());
        setCamError(st.connected ? "" : (st.error ?? "Camera offline — reconnecting…"));
      } catch {
        /* backend blip */
      }
    }, 5000);
    const analyse = setInterval(async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const r = await fetch(
          `/api/backend/cctv/camera/analyse?zone_id=${ZONE_ID}`
        );
        const data = await r.json();
        if (!data.frame) return;
        setScans((c) => c + 1);
        drawLiveOverlay(data.vehicles, data.frame.w, data.frame.h);
        const t = Date.now();
        setTracked((prev) => {
          const next = { ...prev };
          for (const d of data.vehicles as Detection[]) {
            const existing = next[d.plate];
            next[d.plate] = {
              ...d,
              firstSeen: existing?.firstSeen ?? t,
              lastSeen: t,
              compoundId: existing?.compoundId,
            };
          }
          return next;
        });
      } catch {
        // transient — next tick retries
      } finally {
        busyRef.current = false;
      }
    }, 1500);
    return () => {
      clearInterval(refresh);
      clearInterval(analyse);
      clearInterval(health);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const drawLiveOverlay = useCallback(
    (detections: Detection[], frameW: number, frameH: number) => {
      const img = liveImgRef.current;
      const overlay = overlayRef.current;
      if (!img || !overlay) return;
      const rect = img.getBoundingClientRect();
      overlay.width = rect.width;
      overlay.height = rect.height;
      const sx = rect.width / frameW;
      const sy = rect.height / frameH;
      const ctx = overlay.getContext("2d")!;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.font = "600 13px ui-monospace, monospace";
      for (const d of detections) {
        const color = STATUS_COLOR[d.status]?.stroke ?? "#87867f";
        const x = d.box.x1 * sx;
        const y = d.box.y1 * sy;
        const w = (d.box.x2 - d.box.x1) * sx;
        const h = (d.box.y2 - d.box.y1) * sy;
        const pad = 14;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
        const label = ` ${d.plate} · ${STATUS_COLOR[d.status]?.label ?? d.status} `;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(x - pad, y - pad - 22, tw + 4, 22);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, x - pad + 2, y - pad - 7);
      }
    },
    []
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const drawOverlay = useCallback((detections: Detection[], frameW: number, frameH: number) => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;
    const rect = video.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    const sx = rect.width / frameW;
    const sy = rect.height / frameH;
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.font = "600 13px ui-monospace, monospace";

    for (const d of detections) {
      const color = STATUS_COLOR[d.status]?.stroke ?? "#87867f";
      const x = d.box.x1 * sx;
      const y = d.box.y1 * sy;
      const w = (d.box.x2 - d.box.x1) * sx;
      const h = (d.box.y2 - d.box.y1) * sy;
      // expand box a little around the plate for visibility
      const pad = 14;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);

      const label = ` ${d.plate} · ${STATUS_COLOR[d.status]?.label ?? d.status} `;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(x - pad, y - pad - 22, tw + 4, 22);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x - pad + 2, y - pad - 7);
    }
  }, []);

  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = captureRef.current;
    if (!video || !canvas || video.readyState < 2 || busyRef.current) return;
    busyRef.current = true;
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      const blob: Blob = await new Promise((res) =>
        canvas.toBlob((b) => res(b!), "image/jpeg", 0.85)
      );
      const form = new FormData();
      form.append("image", blob, "frame.jpg");
      form.append("zone_id", ZONE_ID);
      const r = await fetch("/api/backend/cctv/scan", { method: "POST", body: form });
      const data = await r.json();
      setScans((c) => c + 1);
      drawOverlay(data.vehicles, data.frame.w, data.frame.h);

      const t = Date.now();
      setTracked((prev) => {
        const next = { ...prev };
        for (const d of data.vehicles as Detection[]) {
          const existing = next[d.plate];
          next[d.plate] = {
            ...d,
            firstSeen: existing?.firstSeen ?? t,
            lastSeen: t,
            compoundId: existing?.compoundId,
          };
        }
        return next;
      });
    } catch {
      // transient network error — next tick retries
    } finally {
      busyRef.current = false;
    }
  }, [drawOverlay]);

  useEffect(() => {
    if (live) return; // live mode analyses server-side frames instead
    const id = setInterval(scanFrame, 1500);
    return () => clearInterval(id);
  }, [scanFrame, live]);

  async function approveCompound(v: Tracked) {
    setIssuing(v.plate);
    try {
      const r = await fetch("/api/backend/compounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: v.plate,
          zone_id: ZONE_ID,
          officer_id: "OFC-001 · CCTV CAM-03 review",
          lat: 1.4589,
          lng: 103.7641,
          confidence: v.confidence,
        }),
      });
      const data = await r.json();
      // "duplicate" means an officer already fined this car — show that
      // compound instead of pretending the reviewer created a new one
      setTracked((prev) => ({
        ...prev,
        [v.plate]: {
          ...prev[v.plate],
          compoundId: data.id,
          status: "compounded",
          detail: data.detail ?? prev[v.plate]?.detail,
        },
      }));
    } finally {
      setIssuing(null);
    }
  }

  const vehicles = Object.values(tracked).sort((a, b) => a.firstSeen - b.firstSeen);
  const violations = vehicles.filter(
    (v) => v.status === "unpaid" && now - v.firstSeen > VIOLATION_AFTER_MS && !v.compoundId
  );

  return (
    <main className="flex-1 max-w-5xl w-full mx-auto px-5 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-3 pt-8 mb-5">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-[620] uppercase tracking-[0.08em] text-blue mb-1">
            <Cctv size={14} strokeWidth={2} /> Unattended enforcement · pilot
          </div>
          <h1 className="font-serif text-[30px] leading-[1.1] tracking-tight">
            Night-market CCTV monitor
          </h1>
          <p className="text-[13.5px] text-slate-3 mt-1.5 max-w-lg">
            One fixed camera checks every plate in frame, around the clock.
            Violations queue for a human reviewer — the AI never fines anyone
            on its own.
          </p>
        </div>
        <a
          href="/"
          className="flex items-center gap-0.5 text-[13px] font-[620] text-slate-2 bg-white border border-ivory-3 rounded-full pl-2.5 pr-4 py-2 active:bg-ivory-2 transition-colors"
        >
          <ChevronLeft size={14} strokeWidth={2} /> Home
        </a>
      </header>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5 items-start">
        {/* Video feed */}
        <div className="space-y-3">
          <div className="relative rounded-[16px] overflow-hidden border border-border bg-slate shadow-sm">
            {live ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={liveImgRef}
                src={`/api/backend/cctv/camera/frame.jpg?t=${frameTick}`}
                alt="Live camera"
                className="w-full block"
              />
            ) : (
              <video
                key={deviceCam ? "device-cam" : videoSrc}
                ref={videoRef}
                src={deviceCam ? undefined : videoSrc}
                autoPlay
                muted
                loop={!deviceCam}
                playsInline
                className="w-full block"
              />
            )}
            {deviceCam && (
              <span
                className="absolute top-3 right-3 flex items-center gap-1.5 text-white rounded-full px-3 py-1 text-[11px] font-[700]"
                style={{ backgroundColor: "#b42525" }}
              >
                ● LIVE CAMERA
              </span>
            )}
            {live && (
              <span className="absolute top-3 right-3 flex items-center gap-1.5 bg-red text-white rounded-full px-3 py-1 text-[11px] font-[700]" style={{ backgroundColor: "#b42525" }}>
                ● LIVE CAMERA
              </span>
            )}
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            <canvas ref={captureRef} className="hidden" />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-28 bg-white rounded-[14px] border border-border p-3.5">
              <div className="font-serif text-[24px] leading-none">{scans}</div>
              <div className="text-[11.5px] text-cloud mt-1">frames analysed</div>
            </div>
            <div className="flex-1 min-w-28 bg-white rounded-[14px] border border-border p-3.5">
              <div className="font-serif text-[24px] leading-none">{vehicles.length}</div>
              <div className="text-[11.5px] text-cloud mt-1">vehicles tracked</div>
            </div>
            <div className="flex-1 min-w-28 bg-white rounded-[14px] border border-border p-3.5">
              <div className="font-serif text-[24px] leading-none text-clay-dk">
                {violations.length}
              </div>
              <div className="text-[11.5px] text-cloud mt-1">awaiting review</div>
            </div>
          </div>

          {/* Video source switcher — always available during a demo */}
          <div className="bg-white rounded-[14px] border border-border p-3">
            <div className="text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud mb-2.5 px-1">
              Video source
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                onClick={() => connectCamera(!!savedUrl)}
                disabled={connecting}
                className={`flex flex-col items-center justify-center gap-1 rounded-[10px] py-2.5 text-[12px] font-[620] transition-all active:scale-[0.98] disabled:opacity-50 ${
                  live
                    ? "bg-green-bg text-green"
                    : "bg-ivory-2 text-slate-2 hover:bg-ivory-3"
                }`}
              >
                <Cctv size={16} strokeWidth={1.8} />
                {connecting ? "Connecting…" : "IP camera"}
              </button>

              <button
                onClick={useDeviceCamera}
                className={`flex flex-col items-center justify-center gap-1 rounded-[10px] py-2.5 text-[12px] font-[620] transition-all active:scale-[0.98] ${
                  deviceCam
                    ? "bg-green-bg text-green"
                    : "bg-ivory-2 text-slate-2 hover:bg-ivory-3"
                }`}
              >
                <Video size={16} strokeWidth={1.8} />
                This device
              </button>

              <label
                className={`flex flex-col items-center justify-center gap-1 rounded-[10px] py-2.5 text-[12px] font-[620] cursor-pointer transition-all active:scale-[0.98] ${
                  customVideo
                    ? "bg-green-bg text-green"
                    : "bg-ivory-2 text-slate-2 hover:bg-ivory-3"
                }`}
              >
                <Upload size={16} strokeWidth={1.8} />
                Upload video
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => loadOwnVideo(e.target.files?.[0])}
                />
              </label>

              <button
                onClick={useDemoVideo}
                className={`flex flex-col items-center justify-center gap-1 rounded-[10px] py-2.5 text-[12px] font-[620] transition-all active:scale-[0.98] ${
                  !live && !deviceCam && !customVideo
                    ? "bg-green-bg text-green"
                    : "bg-ivory-2 text-slate-2 hover:bg-ivory-3"
                }`}
              >
                <Film size={16} strokeWidth={1.8} />
                Demo clip
              </button>
            </div>
          </div>

          {/* RTSP setup — only needed until a camera is saved */}
          {savedUrl ? (
            <div className="flex items-center justify-between gap-3 flex-wrap px-1">
              <span className="font-mono text-[11.5px] text-cloud truncate">
                {savedUrl}
                {savedMac && (
                  <span className="ml-2 text-green">
                    · pinned to {savedMac}
                  </span>
                )}
              </span>
              <button
                onClick={forgetCamera}
                className="text-[11.5px] font-[620] text-slate-3 hover:text-red shrink-0"
              >
                Forget camera
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-[14px] border border-border p-4 space-y-2.5">
              <div className="flex items-center gap-1.5 text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud">
                <Cctv size={13} strokeWidth={2} /> Connect an IP camera (RTSP)
              </div>
              <div className="flex gap-2">
                <input
                  value={rtspUrl}
                  onChange={(e) => setRtspUrl(e.target.value)}
                  placeholder="rtsp://admin:CODE@192.168.1.50:554/H.264"
                  className="flex-1 min-w-0 bg-ivory border border-ivory-3 rounded-[10px] px-3 py-2.5 font-mono text-[12.5px] focus:outline-none focus:border-clay focus:ring-2 focus:ring-clay/15"
                />
                <button
                  onClick={() => connectCamera()}
                  disabled={!rtspUrl || connecting}
                  className="bg-slate text-white font-[620] text-[13px] rounded-[10px] px-4 disabled:opacity-40 active:scale-[0.97] transition-transform"
                >
                  {connecting ? "Connecting…" : "Connect"}
                </button>
              </div>
              <p className="text-[11.5px] text-cloud leading-relaxed">
                Saved on the server once it connects — you only type this once.
              </p>
            </div>
          )}
          {camError && <p className="text-[12px] text-red px-1">{camError}</p>}
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {/* Violation queue — the human-in-the-loop station */}
          <div className="bg-white rounded-[16px] border border-border p-4">
            <div className="flex items-center gap-1.5 text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud mb-3">
              <TriangleAlert size={13} strokeWidth={2} /> Review queue
            </div>
            {violations.length === 0 ? (
              <div className="flex items-center gap-2 text-[13px] text-cloud py-2">
                <ShieldCheck size={15} strokeWidth={1.8} className="text-green" />
                Nothing awaiting review.
              </div>
            ) : (
              <div className="space-y-3">
                {violations.map((v) => (
                  <div key={v.plate} className="rounded-[12px] bg-red-bg p-3.5 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-[16px] tracking-[0.1em]">
                        {v.plate}
                      </span>
                      <span className="text-[11.5px] text-red font-[620]">
                        unpaid · {Math.floor((now - v.firstSeen) / 1000)}s on camera
                      </span>
                    </div>
                    <div className="text-[12px] text-slate-3 mt-1">{v.detail}</div>
                    <button
                      onClick={() => approveCompound(v)}
                      disabled={issuing === v.plate}
                      className="mt-2.5 w-full flex items-center justify-center gap-1.5 bg-clay hover:bg-clay-dk disabled:opacity-50 text-white rounded-full py-2.5 text-[13px] font-[620] transition-all active:scale-[0.98]"
                    >
                      <Ticket size={14} strokeWidth={1.8} />
                      {issuing === v.plate ? "Issuing…" : "Review & issue compound"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tracked vehicles */}
          <div className="bg-white rounded-[16px] border border-border p-4">
            <div className="text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud mb-3">
              Vehicles in frame
            </div>
            {vehicles.length === 0 && (
              <div className="text-[13px] text-cloud py-2">Analysing feed…</div>
            )}
            <div className="space-y-2">
              {vehicles.map((v) => {
                const c = STATUS_COLOR[v.status] ?? STATUS_COLOR.uncertain;
                return (
                  <div
                    key={v.plate}
                    className="flex items-center justify-between gap-2 py-1.5"
                  >
                    <div>
                      <span className="font-mono font-bold text-[15px] tracking-[0.1em]">
                        {v.plate}
                      </span>
                      <span className="block text-[11px] text-cloud mt-0.5">
                        first seen{" "}
                        {new Date(v.firstSeen).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                        {v.compoundId ? ` · compound #${v.compoundId}` : ""}
                      </span>
                    </div>
                    <span
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-[620] ${c.pill}`}
                    >
                      {v.status === "paid" && <Check size={12} strokeWidth={2.2} />}
                      {c.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[12px] text-cloud leading-relaxed px-1">
            Live loop demo: pay for the plate you see above in the{" "}
            <a href="/park" className="font-mono font-[620] text-clay-dk">
              citizen app
            </a>{" "}
            and watch its box turn green on the next frame — no refresh needed.
          </p>
        </div>
      </div>
    </main>
  );
}
