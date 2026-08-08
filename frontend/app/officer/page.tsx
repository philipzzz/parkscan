"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, UserRound, ChevronDown, ScanLine, FileText, Smartphone } from "lucide-react";

type Zone = { id: string; council: string; name: string; rate_per_hour: number };
type Officer = { id: string; name: string };

const selectCls =
  "w-full appearance-none bg-white border border-ivory-3 rounded-[12px] px-4 py-3.5 pr-10 text-[15px] text-slate focus:outline-none focus:border-clay focus:ring-2 focus:ring-clay/15 transition-shadow";

export default function SetupPage() {
  const router = useRouter();
  const [zones, setZones] = useState<Zone[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [officerId, setOfficerId] = useState("");
  const [error, setError] = useState("");
  const loading = zones.length === 0 && !error;

  useEffect(() => {
    Promise.all([
      fetch("/api/backend/zones").then((r) => r.json()),
      fetch("/api/backend/officers").then((r) => r.json()),
    ])
      .then(([z, o]) => {
        setZones(z);
        setOfficers(o);
        setZoneId(z[0]?.id ?? "");
        setOfficerId(o[0]?.id ?? "");
      })
      .catch(() => setError("Backend not reachable — is FastAPI running on :8000?"));
  }, []);

  const zone = zones.find((z) => z.id === zoneId);

  function startPatrol() {
    localStorage.setItem(
      "patrol",
      JSON.stringify({
        zoneId,
        officerId,
        zoneName: zone?.name,
        council: zone?.council,
        officerName: officers.find((o) => o.id === officerId)?.name,
      })
    );
    router.push("/officer/scan");
  }

  return (
    <main className="flex-1 flex flex-col justify-center px-6 py-10 max-w-md w-full mx-auto stagger">
      <div className="mb-8">
        <div className="w-12 h-12 rounded-[14px] bg-clay text-white flex items-center justify-center font-mono font-bold text-xl mb-5">
          P
        </div>
        <h1 className="font-serif text-[34px] leading-[1.1] tracking-tight">
          Ready to patrol
        </h1>
        <p className="text-[15px] text-slate-3 mt-2">
          Scan plates, check payments — you stay in control of every compound.
        </p>
      </div>

      {error && (
        <div className="bg-red-bg text-red rounded-[12px] p-4 text-sm mb-5">
          {error}
        </div>
      )}

      <div className="bg-white rounded-[16px] border border-border p-5 space-y-5">
        {loading ? (
          <div className="space-y-4 py-2">
            <div className="h-12 rounded-[12px] bg-ivory-2 animate-pulse" />
            <div className="h-12 rounded-[12px] bg-ivory-2 animate-pulse" />
            <div className="h-13 rounded-full bg-ivory-2 animate-pulse" />
          </div>
        ) : (
          <>
            <label className="block">
              <span className="flex items-center gap-1.5 text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud mb-2">
                <MapPin size={13} strokeWidth={1.8} /> Council · Zone
              </span>
              <div className="relative">
                <select
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                  className={selectCls}
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
              <span className="flex items-center gap-1.5 text-[12px] font-[620] uppercase tracking-[0.08em] text-cloud mb-2">
                <UserRound size={13} strokeWidth={1.8} /> Officer
              </span>
              <div className="relative">
                <select
                  value={officerId}
                  onChange={(e) => setOfficerId(e.target.value)}
                  className={selectCls}
                >
                  {officers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.id} — {o.name}
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

            {zone && (
              <div className="flex items-center gap-2 text-[13px] text-cloud">
                <span className="rounded-full bg-ivory-2 px-2.5 py-1 text-[11px] font-[620] text-slate-3">
                  {zone.id}
                </span>
                RM {zone.rate_per_hour.toFixed(2)} / hour
              </div>
            )}

            <button
              onClick={startPatrol}
              disabled={!zoneId || !officerId}
              className="w-full flex items-center justify-center gap-2 bg-clay hover:bg-clay-dk disabled:opacity-40 text-white font-[620] rounded-full py-4 text-[16px] transition-all active:scale-[0.98]"
            >
              <ScanLine size={18} strokeWidth={1.8} />
              Start patrol
            </button>
          </>
        )}
      </div>

      <div className="flex justify-center gap-6 mt-7 text-[13px]">
        <a
          href="/officer/records"
          className="flex items-center gap-1.5 text-slate-3 hover:text-slate transition-colors"
        >
          <FileText size={14} strokeWidth={1.8} /> Records
        </a>
        <a
          href="/park"
          className="flex items-center gap-1.5 text-slate-3 hover:text-slate transition-colors"
        >
          <Smartphone size={14} strokeWidth={1.8} /> Citizen demo
        </a>
      </div>
    </main>
  );
}
