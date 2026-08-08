import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ParkScan CCTV — Unattended enforcement",
  description:
    "Fixed-camera monitoring: every plate in frame checked continuously, violations reviewed by a human",
};

export default function CctvLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
