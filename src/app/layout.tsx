import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import SessionRefresher from "@/components/SessionRefresher";
import { AppProviders } from "@/components/AppProviders";
import PWARegister from "@/components/PWARegister";
import PWAOnlyGate from "@/components/PWAOnlyGate";

// Circular Std Medium — single TTF; map common weights so Tailwind utilities resolve
const circularStd = localFont({
  src: [
    { path: "../../public/circular-std-medium-500.ttf", weight: "400", style: "normal" },
    { path: "../../public/circular-std-medium-500.ttf", weight: "500", style: "normal" },
    { path: "../../public/circular-std-medium-500.ttf", weight: "600", style: "normal" },
    { path: "../../public/circular-std-medium-500.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-circular-std",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SDash",
  description: "A modern portal for SRM students",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SDash",
  },
  icons: {
    icon: [{ url: "/sdashTransparentLogo.png", type: "image/png", sizes: "256x256" }],
    shortcut: "/sdashTransparentLogo.png",
    apple: "/sdashTransparentLogo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${circularStd.variable} ${geistMono.variable} antialiased`}>
        <AppProviders>
          <AnalyticsProvider>
            <PWARegister />
            <SessionRefresher />
            <PWAOnlyGate>
              <div className="min-h-screen relative z-10">{children}</div>
            </PWAOnlyGate>
          </AnalyticsProvider>
        </AppProviders>
      </body>
    </html>
  );
}
