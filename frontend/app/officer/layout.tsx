import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ParkScan Officer",
  description: "AI-assisted parking enforcement for council officers",
  manifest: "/manifest-officer.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PS Officer",
  },
};

export default function OfficerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
