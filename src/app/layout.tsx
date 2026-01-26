import type { Metadata } from "next";
import { Geist, Geist_Mono, Open_Sans, Sora } from "next/font/google";
import "./globals.css";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import BottomNavigationBar from "@/components/BottomNavigationBar";
import SessionRefresher from "@/components/SessionRefresher";

const sans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
});
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800"],
});
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SDash",
  description: "A modern portal for SRM students",
  icons: {
    icon: [
      { url: "/web-app-manifest-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/web-app-manifest-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/web-app-manifest-192x192.png",
    apple: "/web-app-manifest-512x512.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${sans.variable} ${sora.variable} antialiased`}
      >
        <AnalyticsProvider>
          <SessionRefresher />
          <div className="min-h-screen relative z-10">{children}</div>
          <BottomNavigationBar />
        </AnalyticsProvider>
      </body>
    </html>
  );
}
