"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Car,
  Check,
  ChevronLeft,
  FileWarning,
  Keyboard,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";

type Expiry = { status: "valid" | "expired"; expiry: string; days: number };

type Vehicle = {
  found: boolean;
  plate: string;
  make_model?: string;
  color?: string;
  road_tax?: Expiry;
  insurance?: Expiry;
  summons_count?: number;
  stolen?: boolean;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

function ExpiryPill({ label, e }: { label: string; e: Expiry }) {
  const ok = e.status === "valid";
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-cloud text-[13.5px]">{label}</span>
      <span
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-[620] ${
          ok ? "bg-green-bg text-green" : "bg-red-bg text-red"
        }`}
      >
        {ok ? <Check size={13} strokeWidth={2.2} /> : <X size={13} strokeWidth={2.2} />}
        {ok
          ? `Valid until ${fmtDate(e.expiry)}`
          : `Expired ${Math.abs(e.days)} days ago`}
      </span>
    </div>
  );
}

export default function PolicePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(false);
  const frozenRef = useRef(false);
  const readsRef = useRef<string[]>([]);

  const [cameraError, setCameraError] = useState("");
  const [hint, setHint] = useState("");
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [manualPlate, setManualPlate] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [checkCount, setCheckCount] = useState(0);

  useEffect(() => {
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
        setCameraError("Camera unavailable — type a plate to check instead.")
      );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const lookup = useCallback(async (plate: string) => {
    const r = await fetch(`/api/backend/vehicle/${plate}`);
    const data: Vehicle = await r.json();
    setVehicle(data);
    setCheckCount((c) => c + 1);
    frozenRef.current = true;
    navigator.vibrate?.(data.stolen ? [150, 80, 150, 80, 150] : 100);
  }, []);

  const captureAndScan = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    if (busyRef.current || frozenRef.current) return;
    busyRef.current = true;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    canvas.width = vw * 0.7;
    canvas.height = vh * 0.4;
    canvas
      .getContext("2d")!
      .drawImage(video, vw * 0.15, vh * 0.3, vw * 0.7, vh * 0.4, 0, 0, canvas.width, canvas.height);

    try {
      const blob: Blob = await new Promise((res) =>
        canvas.toBlob((b) => res(b!), "image/jpeg", 0.9)
      );
      const form = new FormData();
      form.append("image", blob, "frame.jpg");
      const r = await fetch("/api/backend/identify", { method: "POST", body: form });
      const data = await r.json();

      if (data.found && data.plate) {
        const reads = readsRef.current;
        reads.push(data.plate);
        if (reads.length > 3) reads.shift();
        const agreed = reads.length >= 2 && reads[reads.length - 2] === data.plate;
        const veryConfident = (data.confidence ?? 0) >= 0.93 && data.format_ok;

        if (agreed || veryConfident) {
          readsRef.current = [];
          setHint("");
          await lookup(data.plate);
        } else {
          setHint(data.plate);
        }
      } else {
        setHint("");
      }
    } catch {
      // retry next tick
    } finally {
      busyRef.current = false;
    }
  }, [lookup]);

  useEffect(() => {
    const id = setInterval(captureAndScan, 600);
    return () => clearInterval(id);
  }, [captureAndScan]);

  function resume() {
    setVehicle(null);
    setManualMode(false);
    setManualPlate("");
    setHint("");
    readsRef.current = [];
    frozenRef.current = false;
  }

  return (
    <main className="flex-1 flex flex-col relative bg-slate min-h-dvh">
      {/* Top bar */}
      <header className="absolute top-0 inset-x-0 z-10 p-3">
        <div className="flex items-center justify-between bg-white/95 backdrop-blur rounded-full px-2 py-2 text-[13px] shadow-[0_2px_16px_rgba(20,20,19,0.12)]">
          <a
            href="/"
            className="flex items-center gap-0.5 font-[620] text-slate-2 rounded-full px-3 py-1.5 active:bg-ivory-2 transition-colors"
          >
            <ChevronLeft size={15} strokeWidth={2} /> Roadblock
          </a>
          <span className="flex items-center gap-2 pr-2.5 text-cloud">
            <span className="flex items-center gap-1 rounded-full bg-blue-bg text-blue px-2.5 py-1 text-[11px] font-[620]">
              <ShieldAlert size={11} strokeWidth={2} /> PDRM · JPJ
            </span>
            {checkCount} checks
          </span>
        </div>
      </header>

      {/* Camera */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {cameraError && !vehicle && !manualMode && (
        <div className="absolute inset-0 flex items-center justify-center p-8 bg-ivory">
          <div className="bg-white rounded-[16px] border border-border p-6 text-center text-slate-3 text-[15px]">
            {cameraError}
          </div>
        </div>
      )}

      {/* Reticle */}
      {!vehicle && !manualMode && !cameraError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-72 h-28 border-2 rounded-[16px] animate-reticle [box-shadow:0_0_0_9999px_rgba(20,20,19,0.32)]" />
          {!hint && (
            <p className="absolute mt-48 text-white/75 text-[13.5px]">
              Point at a plate — road tax, insurance &amp; summons in one look
            </p>
          )}
          {hint && (
            <div className="absolute mt-48 flex items-center gap-2 bg-white/95 px-4 py-2 rounded-full shadow-md animate-fade-in">
              <span className="font-mono font-bold tracking-[0.15em] text-[16px] text-slate">
                {hint}
              </span>
              <span className="text-cloud text-[12px]">reading…</span>
            </div>
          )}
        </div>
      )}

      {/* Manual entry */}
      {!vehicle && (
        <div className="absolute bottom-8 inset-x-0 flex justify-center px-5">
          {!manualMode ? (
            <button
              onClick={() => setManualMode(true)}
              className="flex items-center gap-2 bg-white/95 backdrop-blur text-slate-2 font-[620] text-[14px] rounded-full px-5 py-3 shadow-[0_2px_16px_rgba(20,20,19,0.15)] active:scale-[0.97] transition-transform"
            >
              <Keyboard size={16} strokeWidth={1.8} /> Type plate instead
            </button>
          ) : (
            <div className="flex gap-2 w-full max-w-sm animate-fade-in">
              <input
                autoFocus
                value={manualPlate}
                onChange={(e) => setManualPlate(e.target.value.toUpperCase())}
                placeholder="JXX 1234"
                className="flex-1 bg-white rounded-full px-5 py-3.5 font-mono text-[17px] text-center tracking-[0.15em] shadow-lg placeholder:text-cloud-3 focus:outline-none"
              />
              <button
                onClick={() => manualPlate && lookup(manualPlate.replace(/\s/g, ""))}
                className="bg-blue text-white font-[620] rounded-full px-6 active:scale-[0.97] transition-transform"
                style={{ backgroundColor: "#3b6fc0" }}
              >
                Check
              </button>
            </div>
          )}
        </div>
      )}

      {/* Result sheet */}
      {vehicle && (
        <div className="absolute bottom-0 inset-x-0 z-20 bg-white rounded-t-[24px] shadow-[0_-8px_40px_rgba(20,20,19,0.25)] p-5 pb-8 space-y-4 animate-sheet-up">
          <div className="w-9 h-1 rounded-full bg-ivory-3 mx-auto -mt-1" />

          {vehicle.stolen && (
            <div className="flex items-center justify-center gap-2 bg-red text-white rounded-[12px] py-3.5 font-[700] text-[15px] animate-fade-in" style={{ backgroundColor: "#b42525" }}>
              <ShieldAlert size={18} strokeWidth={2.2} />
              REPORTED STOLEN — REQUEST BACKUP
            </div>
          )}

          <div className="text-center">
            <div className="font-mono text-[32px] font-bold tracking-[0.12em] text-slate leading-none">
              {vehicle.plate}
            </div>
            {vehicle.found ? (
              <div className="flex items-center justify-center gap-1.5 text-[13.5px] text-slate-3 mt-2">
                <Car size={14} strokeWidth={1.8} />
                {vehicle.make_model} · {vehicle.color}
              </div>
            ) : (
              <div className="text-[13.5px] text-slate-3 mt-2">
                No record in registry (demo database)
              </div>
            )}
          </div>

          {vehicle.found && (
            <div className="rounded-[12px] bg-ivory divide-y divide-border">
              {vehicle.road_tax && <ExpiryPill label="Road tax (LKM)" e={vehicle.road_tax} />}
              {vehicle.insurance && <ExpiryPill label="Insurance" e={vehicle.insurance} />}
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-cloud text-[13.5px]">Outstanding summons</span>
                <span
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-[620] ${
                    vehicle.summons_count
                      ? "bg-amber-bg text-amber"
                      : "bg-green-bg text-green"
                  }`}
                >
                  {vehicle.summons_count ? (
                    <>
                      <FileWarning size={13} strokeWidth={2} />
                      {vehicle.summons_count} unpaid
                    </>
                  ) : (
                    <>
                      <Check size={13} strokeWidth={2.2} /> None
                    </>
                  )}
                </span>
              </div>
            </div>
          )}

          <button
            onClick={resume}
            className="w-full flex items-center justify-center gap-1.5 bg-ivory-2 active:bg-ivory-3 text-slate-2 rounded-full py-4 font-[620] text-[15px] transition-all active:scale-[0.98]"
          >
            <RotateCcw size={16} strokeWidth={1.8} /> Next vehicle
          </button>
        </div>
      )}
    </main>
  );
}
