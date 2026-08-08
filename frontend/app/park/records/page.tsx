"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, History, MapPin, Search, Timer } from "lucide-react";

type Payment = {
  id: number;
  plate: string;
  zone_id: string;
  paid_until: string;
  amount: number;
  lat: number | null;
  lng: number | null;
  photo_path: string | null;
  created_at: string | null;
};

type Zone = { id: string; council: string; name: string };

const fmtDT = (d: string) =>
  new Date(d).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function CitizenRecordsPage() {
  const [plate, setPlate] = useState("");
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [zones, setZones] = useState<Record<string, Zone>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: string) => {
    if (!p) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/backend/payments/${p.replace(/\s/g, "")}`);
      setPayments(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/backend/zones")
      .then((r) => r.json())
      .then((z: Zone[]) =>
        setZones(Object.fromEntries(z.map((zone) => [zone.id, zone])))
      );
    const saved = localStorage.getItem("myPlate");
    if (saved) {
      setPlate(saved);
      load(saved);
    }
  }, [load]);

  const active = payments?.filter(
    (p) => new Date(p.paid_until).getTime() > Date.now()
  );

  return (
    <main className="flex-1 max-w-md w-full mx-auto px-5 pb-12">
      <header className="flex items-end justify-between pt-8 mb-6">
        <div>
          <h1 className="font-serif text-[30px] leading-[1.1] tracking-tight">
            My parking
          </h1>
          <p className="text-[13.5px] text-slate-3 mt-1.5">
            Sessions, receipts and photo records
          </p>
        </div>
        <a
          href="/park"
          className="flex items-center gap-0.5 text-[13px] font-[620] text-slate-2 bg-white border border-ivory-3 rounded-full pl-2.5 pr-4 py-2 active:bg-ivory-2 transition-colors"
        >
          <ChevronLeft size={14} strokeWidth={2} /> Pay
        </a>
      </header>

      <div className="flex gap-2 mb-6">
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value.toUpperCase())}
          placeholder="JXX 1234"
          className="flex-1 bg-white border border-ivory-3 rounded-full px-5 py-3 font-mono text-[16px] text-center tracking-[0.15em] placeholder:text-cloud-3 focus:outline-none focus:border-green focus:ring-2 focus:ring-green/15"
        />
        <button
          onClick={() => load(plate)}
          disabled={!plate || loading}
          className="flex items-center gap-1.5 text-white font-[620] rounded-full px-5 text-[14px] active:scale-[0.97] transition-transform disabled:opacity-40"
          style={{ backgroundColor: "#2d7a3a" }}
        >
          <Search size={15} strokeWidth={2} /> {loading ? "…" : "Find"}
        </button>
      </div>

      {payments === null && !loading && (
        <div className="bg-white rounded-[16px] border border-border p-10 text-center animate-fade-in">
          <History size={28} strokeWidth={1.5} className="mx-auto text-cloud-2 mb-3" />
          <p className="text-[14px] text-cloud">
            Enter your plate to see your parking history.
          </p>
        </div>
      )}

      {payments?.length === 0 && (
        <div className="bg-white rounded-[16px] border border-border p-10 text-center animate-fade-in">
          <History size={28} strokeWidth={1.5} className="mx-auto text-cloud-2 mb-3" />
          <p className="text-[14px] text-cloud">No sessions found for {plate}.</p>
        </div>
      )}

      <div className="space-y-3 stagger">
        {payments?.map((p) => {
          const zone = zones[p.zone_id];
          const isActive = new Date(p.paid_until).getTime() > Date.now();
          return (
            <div
              key={p.id}
              className="bg-white rounded-[16px] border border-border overflow-hidden"
            >
              {p.photo_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.photo_path}
                  alt={`Parking record ${p.plate}`}
                  className="w-full h-28 object-cover"
                />
              )}
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-cloud">
                    #P-{p.id.toString().padStart(5, "0")} ·{" "}
                    {p.created_at ? fmtDT(p.created_at) : "—"}
                  </span>
                  <span
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-[620] ${
                      isActive ? "bg-green-bg text-green" : "bg-ivory-2 text-cloud"
                    }`}
                  >
                    <Timer size={11} strokeWidth={2} />
                    {isActive
                      ? `Active until ${new Date(p.paid_until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Ended"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13.5px]">
                  <span className="text-slate-2 font-[550]">
                    {zone ? `${zone.council} · ${zone.name}` : p.zone_id}
                  </span>
                  <span className="font-[620]">RM {p.amount.toFixed(2)}</span>
                </div>
                {p.lat != null && p.lng != null && (
                  <a
                    href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[12.5px] font-[620] text-clay-dk"
                  >
                    <MapPin size={12} strokeWidth={2} /> Where I parked
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {active && active.length > 0 && (
        <p className="text-center text-[12px] text-cloud mt-5">
          {active.length} active session{active.length > 1 ? "s" : ""}
        </p>
      )}
    </main>
  );
}
