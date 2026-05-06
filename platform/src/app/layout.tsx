import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f1419",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  title: "Elevated Job Operations",
  description: "Jobs, commissions, and reporting",
  icons: {
    icon: "/elevated-logo.png",
    shortcut: "/elevated-logo.png",
    apple: "/elevated-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
