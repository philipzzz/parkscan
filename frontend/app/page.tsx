import type { Metadata } from "next";
import "./landing.css";

export const metadata: Metadata = {
  title: "ParkScan — AI-assisted parking enforcement for Malaysian councils",
  description:
    "Scan a plate, know the payment status in seconds. Human-in-the-loop AI enforcement for local councils. No new hardware — any phone works.",
};

const FEATURES = [
  {
    title: "Multi-frame consensus",
    body: "A plate is only accepted when consecutive frames agree — one blurry frame never becomes a fine.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
        <rect x="7" y="9" width="10" height="6" rx="1" />
      </svg>
    ),
  },
  {
    title: "Malaysian plate validation",
    body: "Every read is checked against JPJ plate format. Common OCR confusions (O↔0, B↔8) are auto-corrected.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 13c0 5-3.5 7.5-8 8.5-4.5-1-8-3.5-8-8.5V6l8-3 8 3z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "Human-in-the-loop",
    body: "Low-confidence reads turn grey and ask the officer. The AI recommends; a person decides.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    ),
  },
  {
    title: "Privacy by design",
    body: "Frames without plates are discarded instantly. Photos of paid vehicles are never stored. Only evidence persists.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    title: "Evidence-grade records",
    body: "Every compound carries photo, GPS, timestamp, officer ID and AI confidence — a full audit trail for appeals.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    ),
  },
  {
    title: "Any phone, zero install",
    body: "Officers open a link and add it to their home screen. Updates ship server-side — no app store, no MDM.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="3" />
        <path d="M11 18h2" />
      </svg>
    ),
  },
];

export default function Landing() {
  return (
    <div className="landing">
      <nav>
        <div className="wrap nav-inner">
          <a className="brand" href="/">
            <span className="brand-mark">P</span> ParkScan
          </a>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#cctv">CCTV live</a>
            <a href="#councils">For councils</a>
            <a className="btn btn-clay" href="/officer">
              Live demo
            </a>
          </div>
        </div>
      </nav>

      <header className="wrap hero">
        <div>
          <span className="eyebrow">
            <span className="dot"></span> Built for Malaysian local councils
          </span>
          <h1>
            Scan a plate.
            <br />
            Know in <em>one second</em>.
          </h1>
          <p className="lead">
            ParkScan turns any officer&apos;s phone into an AI parking-enforcement
            tool. Point the camera at a plate — payment status appears instantly.
            Every compound is prepared by AI and confirmed by a human.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-clay" href="/officer">
              Officer app →
            </a>
            <a className="btn btn-ghost" href="/park">
              Citizen app →
            </a>
            <a className="btn btn-ghost" href="/cctv">
              CCTV console →
            </a>
          </div>
          <p className="hero-note">
            Progressive Web App · no app store, no new hardware · works on the
            phones officers already carry
          </p>
        </div>

        <div className="phone-col">
          <div className="phone" aria-hidden="true">
            <div className="screen">
              <div className="cam">
                <div className="statusbar">
                  <span>← MBJB-A1</span>
                  <span className="gpspill">● GPS</span>
                </div>
                <div className="reticle"></div>
                <div className="plate-in-cam">WVX 2345</div>
              </div>
              <div className="sheet">
                <div className="handle"></div>
                <div className="plate">WVX 2345</div>
                <div className="pill">✓ Paid until 3:45 PM</div>
                <div className="meta">OCR confidence 99% · 0.6 s</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="wrap">
        <div className="stats">
          <div className="stat">
            <div className="num">
              <span>30×</span>
            </div>
            <div className="lbl">
              faster than typing plates by hand — 1 s per vehicle instead of 30 s
            </div>
          </div>
          <div className="stat">
            <div className="num">
              <span>100%</span>
            </div>
            <div className="lbl">
              of compounds reviewed and confirmed by an officer — AI never fines
              anyone on its own
            </div>
          </div>
          <div className="stat">
            <div className="num">0</div>
            <div className="lbl">
              new devices to procure — runs as a PWA on any phone with a camera
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="wrap">
        <div className="section-head">
          <div className="kicker">How it works</div>
          <h2>Four steps, under ten seconds</h2>
          <p>
            The officer stays in control at every step. The AI does the reading,
            checking and paperwork.
          </p>
        </div>
        <div className="steps">
          <div className="step">
            <div className="n">1</div>
            <h3>Scan</h3>
            <p>
              Point the camera. On-server ALPR reads the plate in 25 ms with
              per-character confidence.
            </p>
          </div>
          <div className="step">
            <div className="n">2</div>
            <h3>Check</h3>
            <p>
              Payment status comes back instantly from the council&apos;s parking
              system.
            </p>
            <div className="status-chips">
              <span className="chip g">Paid</span>
              <span className="chip a">Grace</span>
              <span className="chip r">Unpaid</span>
              <span className="chip u">Confirm</span>
            </div>
          </div>
          <div className="step">
            <div className="n">3</div>
            <h3>Review</h3>
            <p>
              For unpaid vehicles, AI pre-fills the compound: photo, GPS, time,
              zone, confidence score.
            </p>
          </div>
          <div className="step">
            <div className="n">4</div>
            <h3>Confirm</h3>
            <p>
              The officer checks the evidence and issues — or cancels. Every
              decision is logged.
            </p>
          </div>
        </div>
      </section>

      <section id="features" className="wrap">
        <div className="section-head">
          <div className="kicker">Why it&apos;s trustworthy</div>
          <h2>Engineered for the street, not the lab</h2>
          <p>
            Real enforcement means dirty plates, harsh sun and no patience for
            false alarms.
          </p>
        </div>
        <div className="features">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature">
              <div className="ic">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap">
        <div className="section-head">
          <div className="kicker">One platform</div>
          <h2>The plate is the primary key</h2>
          <p>
            One camera-first platform — enforcement and payment today, roadside
            checks next, all talking to the same records.
          </p>
        </div>
        <div className="steps steps-3">
          <a className="step" href="/officer" style={{ textDecoration: "none", color: "inherit" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/officer-street.webp"
              alt="Enforcement officer scanning a parked car's plate with a phone"
              className="step-photo"
            />
            <div className="n">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20.5c0-3.6 3.1-6 7-6s7 2.4 7 6" />
              </svg>
            </div>
            <h3>Officer — enforce</h3>
            <p>
              Scan plates on patrol, see payment status live, issue compounds
              with full evidence in two taps.
            </p>
          </a>
          <a className="step" href="/park" style={{ textDecoration: "none", color: "inherit" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/citizen-pay.webp"
              alt="Driver paying for street parking from a phone beside their car"
              className="step-photo"
            />
            <div className="n">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
                <circle cx="7" cy="17" r="2" />
                <path d="M9 17h6" />
                <circle cx="17" cy="17" r="2" />
              </svg>
            </div>
            <h3>Citizen — pay</h3>
            <p>
              Snap your own plate, GPS picks the zone, pay in seconds. Photo
              receipts and history for every session.
            </p>
          </a>
          <div className="step" style={{ opacity: 0.75 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/roadblock-check.webp"
              alt="JPJ officer at a highway roadblock checking a stopped car"
              className="step-photo"
            />
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div className="n">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="9" width="18" height="4" rx="1" />
                  <path d="M6 20v-7M18 20v-7M9 9l-3.5 4M15 9l-3.5 4M21 9.5 17.5 13" />
                </svg>
              </div>
              <span className="chip u">Roadmap</span>
            </div>
            <h3>Roadblock — check</h3>
            <p>
              Planned expansion: at a roadblock, one look reads the plate and
              returns road tax, insurance and outstanding summons instantly.
            </p>
          </div>
        </div>
      </section>

      <section id="cctv" className="wrap">
        <div className="section-head">
          <div className="kicker">CCTV live</div>
          <h2>The cameras the council already owns become enforcement officers too</h2>
          <p>
            Beyond handheld scanning, ParkScan connects directly to fixed CCTV
            feeds and watches whole parking zones continuously — same AI, same
            human sign-off.
          </p>
        </div>
        <div className="cctv-grid">
          <div>
            <ul className="checklist">
              <li>
                <span className="tick">✓</span> Connect any RTSP camera with a
                single URL — existing council CCTV works as-is, no new hardware
              </li>
              <li>
                <span className="tick">✓</span> Every vehicle in frame is tracked
                continuously, colour-coded by live payment status
              </li>
              <li>
                <span className="tick">✓</span> A vehicle unpaid past the grace
                period is flagged automatically as a violation candidate
              </li>
              <li>
                <span className="tick">✓</span> An officer reviews the evidence in
                the console and confirms — the camera never fines anyone on its own
              </li>
              <li>
                <span className="tick">✓</span> Recorded footage can be uploaded
                and replayed for audits and appeals
              </li>
            </ul>
            <div className="cctv-ctas">
              <a className="btn btn-clay" href="/cctv">
                Open the live CCTV console
              </a>
              <a className="btn btn-ghost" href="/officer">
                Try the phone demo
              </a>
            </div>
          </div>
          <div className="monitor">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/img/cctv-console.webp"
              alt="CCTV live console — vehicles in frame colour-coded by payment status, with a human review queue"
              className="monitor-shot"
            />
          </div>
        </div>
      </section>

      <section id="councils" className="trust">
        <div className="wrap trust-grid" style={{ paddingTop: 72, paddingBottom: 72 }}>
          <div>
            <blockquote>
              &ldquo;One officer covers <em>30× more vehicles</em> per shift — and
              every summons still has a human signature on it.&rdquo;
            </blockquote>
            <div className="who">The pitch, in one sentence</div>
          </div>
          <ul className="checklist">
            <li>
              <span className="tick">✓</span> Runs on a commodity server — 25 ms
              per scan on CPU, no GPU procurement
            </li>
            <li>
              <span className="tick">✓</span> Integrates with the council&apos;s
              existing parking-payment database
            </li>
            <li>
              <span className="tick">✓</span> Duplicate protection — a vehicle
              already compounded shows as such to every officer
            </li>
            <li>
              <span className="tick">✓</span> Grace-period logic notifies drivers
              before fining them
            </li>
            <li>
              <span className="tick">✓</span> Live CCTV enforcement — any RTSP
              camera today; cloud-connected cameras (EZVIZ Open Platform) for
              multi-site rollout without VPN
            </li>
            <li>
              <span className="tick">✓</span> Roadmap: BM · English · 中文 ·
              தமிழ் interface, council analytics dashboard
            </li>
          </ul>
        </div>
      </section>

      <section className="cta-band wrap">
        <div className="kicker">
          MAICNEXUS Hackathon · AI for Public Services &amp; Smart Cities
        </div>
        <h2>See it read a real plate</h2>
        <p>
          Open the demo on your phone and point it at any car — or at a plate on
          your screen.
          <br />
          <span className="domain">parkscan.my</span>
        </p>
        <div className="hero-ctas" style={{ justifyContent: "center" }}>
          <a className="btn btn-clay" href="/officer">
            Officer app
          </a>
          <a className="btn btn-ghost" href="/park">
            Citizen app
          </a>
          <a className="btn btn-ghost" href="/cctv">
            CCTV console
          </a>
        </div>
      </section>

      <footer>
        <div className="wrap foot">
          <span>© 2026 ParkScan · Built at MAICNEXUS Hackathon</span>
          <span>
            <a href="/officer">Officer app</a> · <a href="/park">Citizen app</a> ·{" "}
            <a href="/cctv">CCTV live</a> · <a href="#how">How it works</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
