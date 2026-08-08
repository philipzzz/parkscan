"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, MapPin, FolderOpen } from "lucide-react";

type Compound = {
  id: number;
  plate: string;
  zone_id: string;
  officer_id: string;
  lat: number | null;
  lng: number | null;
  photo_path: string | null;
  ocr_confidence: number | null;
  status: string;
  created_at: string;
};

type Zone = { id: string; council: string; name: string };

export default function RecordsPage() {
  const [compounds, setCompounds] = useState<Compound[] | null>(null);
  const [zones, setZones] = useState<Record<string, Zone>>({});
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/backend/compounds").then((r) => r.json()),
      fetch("/api/backend/zones").then((r) => r.json()),
    ]).then(([c, z]) => {
      setCompounds(c);
      setZones(Object.fromEntries(z.map((zone: Zone) => [zone.id, zone])));
    });
  }, []);

  const today = new Date().toDateString();
  const todayCount =
    compounds?.filter((c) => new Date(c.created_at).toDateString() === today)
      .length ?? 0;

  return (
    <main className="flex-1 max-w-md w-full mx-auto px-5 pb-12">
      <header className="flex items-end justify-between pt-8 mb-6">
        <div>
          <h1 className="font-serif text-[30px] leading-[1.1] tracking-tight">
            Records
          </h1>
          <p className="text-[13.5px] text-slate-3 mt-1.5">
            Issued compounds · full audit trail
          </p>
        </div>
        <a
          href="/officer"
          className="flex items-center gap-0.5 text-[13px] font-[620] text-slate-2 bg-white border border-ivory-3 rounded-full pl-2.5 pr-4 py-2 active:bg-ivory-2 transition-colors"
        >
          <ChevronLeft size={14} strokeWidth={2} /> Home
        </a>
      </header>

      {compounds && compounds.length > 0 && (
        <div className="flex gap-3 mb-5 stagger">
          <div className="flex-1 bg-white rounded-[16px] border border-border p-4">
            <div className="font-serif text-[30px] leading-none">
              {compounds.length}
            </div>
            <div className="text-[12px] text-cloud mt-1.5">Total compounds</div>
          </div>
          <div className="flex-1 bg-white rounded-[16px] border border-border p-4">
            <div className="font-serif text-[30px] leading-none text-clay-dk">
              {todayCount}
            </div>
            <div className="text-[12px] text-cloud mt-1.5">Today</div>
          </div>
        </div>
      )}

      {compounds === null && (
        <div className="space-y-3">
          <div className="h-20 rounded-[16px] bg-ivory-2 animate-pulse" />
          <div className="h-20 rounded-[16px] bg-ivory-2 animate-pulse" />
        </div>
      )}

      {compounds?.length === 0 && (
        <div className="bg-white rounded-[16px] border border-border p-10 text-center animate-fade-in">
          <FolderOpen
            size={28}
            strokeWidth={1.5}
            className="mx-auto text-cloud-2 mb-3"
          />
          <p className="text-[14px] text-cloud">No compounds issued yet.</p>
        </div>
      )}

      <div className="space-y-3 stagger">
        {compounds?.map((c) => {
          const zone = zones[c.zone_id];
          const open = expanded === c.id;
          return (
            <button
              key={c.id}
              onClick={() => setExpanded(open ? null : c.id)}
              className="w-full text-left bg-white rounded-[16px] border border-border p-4 space-y-3 active:scale-[0.995] transition-transform"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-mono font-bold text-[17px] tracking-[0.12em]">
                    {c.plate}
                  </div>
                  <div className="text-[12px] text-cloud mt-0.5">
                    {new Date(c.created_at).toLocaleString()} ·{" "}
                    {zone ? zone.name : c.zone_id}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-red-bg text-red px-3 py-1 text-[11.5px] font-[620]">
                  #{c.id} · RM 100
                </span>
              </div>

              {open && (
                <div className="space-y-3 pt-1 animate-fade-in">
                  {c.photo_path && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.photo_path}
                      alt={`Evidence for ${c.plate}`}
                      className="rounded-[12px] border border-border w-full"
                    />
                  )}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13.5px]">
                    <div>
                      <div className="text-[11px] text-cloud-2 uppercase tracking-wide">
                        Officer
                      </div>
                      <div className="font-[550] text-slate-2">{c.officer_id}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-cloud-2 uppercase tracking-wide">
                        Council
                      </div>
                      <div className="font-[550] text-slate-2">
                        {zone?.council ?? "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-cloud-2 uppercase tracking-wide">
                        GPS
                      </div>
                      <div className="font-[550] text-slate-2">
                        {c.lat != null && c.lng != null
                          ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
                          : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-cloud-2 uppercase tracking-wide">
                        OCR confidence
                      </div>
                      <div className="font-[550] text-slate-2">
                        {c.ocr_confidence != null
                          ? `${(c.ocr_confidence * 100).toFixed(0)}%`
                          : "manual entry"}
                      </div>
                    </div>
                  </div>
                  {c.lat != null && c.lng != null && (
                    <a
                      href={`https://www.google.com/maps?q=${c.lat},${c.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center justify-center gap-1.5 text-[13.5px] font-[620] text-clay-dk bg-clay/10 rounded-full py-3 active:scale-[0.98] transition-transform"
                    >
                      <MapPin size={14} strokeWidth={1.8} />
                      Open location in Maps
                    </a>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </main>
  );
}
