"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  ChevronLeft,
  CircleCheck,
  History,
  Keyboard,
  MapPin,
  Plus,
  RotateCcw,
  Timer,
} from "lucide-react";

type Zone = { id: string; council: string; name: string; rate_per_hour: number };

type Session = {
  id: number;
  plate: string;
  zoneId: string;
  startedAt: string;
  paidUntil: string;
  amount: number;
  photo: string | null;
};

const fmtTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function PayPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const busyRef = useRef(false);
  const readsRef = useRef<string[]>([]);

  const [step, setStep] = useState<"camera" | "confirm" | "paid">("camera");
  const [cameraError, setCameraError] = useState("");
  const [hint, setHint] = useState("");
  const [plate, setPlate] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [zoneAuto, setZoneAuto] = useState<number | null>(null); // distance_m when auto-detected
  const [minutes, setMinutes] = useState(60);
  const [session, setSession] = useState<Session | null>(null);
  const [remaining, setRemaining] = useState("");
  const [paying, setPaying] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  // Live clock (client-only to avoid hydration mismatch)
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Zones list + GPS watch (whole page lifetime)
  useEffect(() => {
    fetch("/api/backend/zones")
      .then((r) => r.json())
      .then((z) => {
        setZones(z);
        setZoneId((prev) => prev || (z[0]?.id ?? ""));
      });

    const watchId = navigator.geolocation?.watchPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => {
      if (watchId != null) navigator.geolocation?.clearWatch(watchId);
    };
  }, []);

  // Auto-pick nearest zone once GPS is available
  useEffect(() => {
    if (!gps || zoneAuto !== null) return;
    fetch(`/api/backend/zones/nearest?lat=${gps.lat}&lng=${gps.lng}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.found) {
          setZoneId(d.zone.id);
          setZoneAuto(d.distance_m);
        }
      })
      .catch(() => {});
  }, [gps, zoneAuto]);

  // Camera runs only during the camera step
  useEffect(() => {
    if (step !== "camera") return;
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
        setCameraError("Camera unavailable — you can type the plate instead.")
      );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [step]);

  const captureAndIdentify = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    if (busyRef.current) return;
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
          setPlate(data.plate);
          setPhoto(data.photo);
          setHint("");
          setStep("confirm");
          navigator.vibrate?.(80);
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
  }, []);

  useEffect(() => {
    if (step !== "camera") return;
    const id = setInterval(captureAndIdentify, 700);
    return () => clearInterval(id);
  }, [step, captureAndIdentify]);

  // Countdown for the active session
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const ms = new Date(session.paidUntil).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining("Expired");
        return;
      }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(h > 0 ? `${h}h ${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  const zone = zones.find((z) => z.id === zoneId);
  const amount = zone ? ((minutes / 60) * zone.rate_per_hour).toFixed(2) : "0.00";

  async function pay(extendMinutes?: number) {
    setPaying(true);
    try {
      const r = await fetch("/api/backend/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: session?.plate ?? plate,
          zone_id: session?.zoneId ?? zoneId,
          minutes: extendMinutes ?? minutes,
          lat: gps?.lat,
          lng: gps?.lng,
          photo: session?.photo ?? photo,
        }),
      });
      const data = await r.json();
      setSession((prev) => ({
        id: data.id,
        plate: data.plate,
        zoneId: data.zone_id,
        startedAt: prev?.startedAt ?? new Date().toISOString(),
        paidUntil: data.paid_until,
        amount: (prev?.amount ?? 0) + data.amount,
        photo: prev?.photo ?? photo,
      }));
      setStep("paid");
      localStorage.setItem("myPlate", data.plate);
      navigator.vibrate?.(100);
    } finally {
      setPaying(false);
    }
  }

  function retake() {
    setPlate("");
    setPhoto(null);
    setHint("");
    readsRef.current = [];
    setStep("camera");
  }

  /* ---------- camera step ---------- */
  if (step === "camera") {
    return (
      <main className="flex-1 flex flex-col relative bg-slate min-h-dvh">
        <header className="absolute top-0 inset-x-0 z-10 p-3">
          <div className="flex items-center justify-between bg-white/95 backdrop-blur rounded-full px-2 py-2 text-[13px] shadow-[0_2px_16px_rgba(20,20,19,0.12)]">
            <a
              href="/"
              className="flex items-center gap-0.5 font-[620] text-slate-2 rounded-full px-3 py-1.5 active:bg-ivory-2 transition-colors"
            >
              <ChevronLeft size={15} strokeWidth={2} /> Pay parking
            </a>
            <span
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 mr-1 text-[11px] font-[620] ${
                gps ? "bg-green-bg text-green" : "bg-ivory-2 text-cloud-2"
              }`}
            >
              <MapPin size={11} strokeWidth={2} />
              {zoneAuto !== null && zone ? zone.id : "GPS"}
            </span>
          </div>
        </header>

        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {!cameraError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-72 h-28 border-2 rounded-[16px] animate-reticle [box-shadow:0_0_0_9999px_rgba(20,20,19,0.32)]" />
            {!hint && (
              <p className="absolute mt-48 text-white/75 text-[13.5px]">
                Point at your plate to start parking
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

        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center p-8 bg-ivory">
            <div className="bg-white rounded-[16px] border border-border p-6 text-center text-slate-3 text-[15px]">
              {cameraError}
            </div>
          </div>
        )}

        <button
          onClick={() => setStep("confirm")}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/95 backdrop-blur text-slate-2 font-[620] text-[14px] rounded-full px-5 py-3 shadow-[0_2px_16px_rgba(20,20,19,0.15)] active:scale-[0.97] transition-transform"
        >
          <Keyboard size={16} strokeWidth={1.8} /> Type plate instead
        </button>
      </main>
    );
  }

  /* ---------- confirm step ---------- */
  if (step === "confirm") {
    return (
      <main className="flex-1 flex flex-col justify-center px-6 py-10 max-w-md w-full mx-auto stagger">
        <h1 className="font-serif text-[30px] leading-[1.1] tracking-tight mb-1">
          Start parking
        </h1>
        <p className="text-[14px] text-slate-3 mb-4">
          {photo
            ? "Plate captured — photo saved as your parking record."
            : "Enter your plate to start a session."}
        </p>

        <div className="flex items-center gap-2 mb-5 text-[12px]">
          {now && (
            <span className="flex items-center gap-1.5 bg-white border border-border rounded-full px-3 py-1.5 text-slate-3">
              <Timer size={12} strokeWidth={2} />
              {now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}{" "}
              · {fmtTime(now)}
            </span>
          )}
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 ${
              gps
                ? "bg-green-bg text-green"
                : "bg-white border border-border text-cloud-2"
            }`}
          >
            <MapPin size={12} strokeWidth={2} />
            {gps ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : "Locating…"}
          </span>
        </div>

        <div className="bg-white rounded-[16px] border border-border p-5 space-y-5">
          {photo && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo}
                alt="Your car"
                className="w-24 h-16 object-cover rounded-[10px] border border-border"
              />
              <button
                onClick={retake}
                className="flex items-center gap-1.5 text-[13px] font-[620] text-slate-3 bg-ivory-2 rounded-full px-3.5 py-2 active:scale-[0.97] transition-transform"
              >
                <RotateCcw size={13} strokeWidth={1.8} /> Retake
              </button>
            </div>
          )}

          <label className="block">
            <span className="block text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud mb-2">
              Plate number
            </span>
            <input
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="JXX 1234"
              className="w-full bg-ivory border border-ivory-3 rounded-[12px] px-4 py-3.5 font-mono text-[20px] text-center tracking-[0.15em] placeholder:text-cloud-3 focus:outline-none focus:border-green focus:ring-2 focus:ring-green/15"
            />
          </label>

          <label className="block">
            <span className="flex items-center justify-between text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud mb-2">
              <span>Zone</span>
              {zoneAuto !== null && (
                <span className="flex items-center gap-1 text-green normal-case tracking-normal">
                  <MapPin size={11} strokeWidth={2} /> auto · {zoneAuto} m
                </span>
              )}
            </span>
            <div className="relative">
              <select
                value={zoneId}
                onChange={(e) => {
                  setZoneId(e.target.value);
                  setZoneAuto(null);
                }}
                className="w-full appearance-none bg-white border border-ivory-3 rounded-[12px] px-4 py-3.5 pr-10 text-[15px] focus:outline-none focus:border-green focus:ring-2 focus:ring-green/15"
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.council} — {z.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                strokeWidth={1.8}
                className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-cloud-2"
              />
            </div>
          </label>

          <label className="block">
            <span className="flex justify-between text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud mb-2">
              <span>Duration</span>
              <span className="text-slate-2">{minutes} min</span>
            </span>
            <input
              type="range"
              min={15}
              max={240}
              step={15}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-full accent-[#2d7a3a]"
            />
          </label>

          <button
            onClick={() => pay()}
            disabled={!plate || paying}
            className="w-full text-white font-[620] rounded-full py-4 text-[16px] transition-all active:scale-[0.98] disabled:opacity-40"
            style={{ backgroundColor: "#2d7a3a" }}
          >
            {paying ? "Paying…" : `Pay RM ${amount}`}
          </button>
        </div>

        <button
          onClick={retake}
          className="flex items-center justify-center gap-1.5 text-[13px] text-slate-3 hover:text-slate mt-6"
        >
          <Camera size={14} strokeWidth={1.8} /> Scan plate again
        </button>
      </main>
    );
  }

  /* ---------- paid step ---------- */
  return (
    <main className="flex-1 flex flex-col justify-center px-6 py-10 max-w-md w-full mx-auto">
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-bg text-green flex items-center justify-center animate-pop-in mb-4">
          <CircleCheck size={30} strokeWidth={2.2} />
        </div>
        <h1 className="font-serif text-[28px] tracking-tight animate-fade-in">
          Parking active
        </h1>
      </div>

      <div className="bg-white rounded-[16px] border border-border overflow-hidden animate-fade-in">
        {session?.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.photo}
            alt="Parking record"
            className="w-full h-36 object-cover"
          />
        )}
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-[22px] tracking-[0.12em]">
              {session?.plate}
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-green-bg text-green px-3.5 py-1.5 text-[13px] font-[620]">
              <Timer size={14} strokeWidth={2} /> {remaining}
            </span>
          </div>
          <div className="rounded-[12px] bg-ivory divide-y divide-border text-[13.5px]">
            {(() => {
              const z = zones.find((zz) => zz.id === session?.zoneId);
              const rows: [string, React.ReactNode][] = [
                ["Receipt", `#P-${session?.id.toString().padStart(5, "0")}`],
                ["Zone", z ? `${z.id} · ${z.name}` : session?.zoneId ?? "—"],
                ["Council", z?.council ?? "—"],
                ["Started", session ? fmtTime(session.startedAt) : "—"],
                ["Expires", session ? fmtTime(session.paidUntil) : "—"],
                ["Total paid", `RM ${session?.amount.toFixed(2)}`],
                [
                  "Location",
                  gps ? (
                    <a
                      href={`https://www.google.com/maps?q=${gps.lat},${gps.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-clay-dk font-[620]"
                    >
                      <MapPin size={12} strokeWidth={2} />
                      {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
                    </a>
                  ) : (
                    "—"
                  ),
                ],
              ];
              if (now) rows.push(["Time now", fmtTime(now)]);
              return rows.map(([k, v]) => (
                <div key={k} className="flex justify-between items-center gap-4 px-3.5 py-2.5">
                  <span className="text-cloud">{k}</span>
                  <span className="text-right font-[550] text-slate-2">{v}</span>
                </div>
              ));
            })()}
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => pay(30)}
              disabled={paying}
              className="flex-1 flex items-center justify-center gap-1.5 bg-ivory-2 active:bg-ivory-3 text-slate-2 rounded-full py-3.5 font-[620] text-[14px] transition-all active:scale-[0.98] disabled:opacity-40"
            >
              <Plus size={15} strokeWidth={2} /> Extend 30 min
            </button>
            <a
              href="/park"
              className="flex-1 flex items-center justify-center bg-white border border-ivory-3 active:bg-ivory-2 text-slate-2 rounded-full py-3.5 font-[620] text-[14px] transition-all"
            >
              Done
            </a>
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-6 mt-6 text-[13px]">
        <button
          onClick={retake}
          className="flex items-center gap-1.5 text-slate-3 hover:text-slate"
        >
          <Camera size={14} strokeWidth={1.8} /> Park another car
        </button>
        <a
          href="/park/records"
          className="flex items-center gap-1.5 text-slate-3 hover:text-slate"
        >
          <History size={14} strokeWidth={1.8} /> My records
        </a>
      </div>
    </main>
  );
}
