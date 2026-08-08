import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ParkScan Patrol — Roadblock",
  description: "Instant vehicle checks at roadblocks: road tax, insurance, summons",
  manifest: "/manifest-police.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PS Patrol",
  },
};

export default function PoliceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
