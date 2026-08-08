import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ParkScan — Pay parking",
  description: "Snap your plate, pay for parking in seconds",
  manifest: "/manifest-citizen.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ParkScan",
  },
};

export default function ParkLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
