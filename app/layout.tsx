import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MintRadar",
  description:
    "Search collectible cards, vendors, inventory, and live pricing with MintRadar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-black text-white">
        <div className="fixed right-3 top-3 z-[100] flex items-center gap-2 sm:right-6 sm:top-6">
          <Link
            href="/customer/login"
            className="rounded-xl border border-zinc-700 bg-black/90 px-3 py-2.5 text-xs font-black text-zinc-200 shadow-lg backdrop-blur transition hover:border-zinc-500 hover:bg-zinc-900 sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">Customer</span>
            <span className="hidden sm:inline">
              Customer Login / Sign Up
            </span>
          </Link>

          <Link
            href="/vendor/login"
            className="rounded-xl border border-emerald-400/30 bg-black/90 px-3 py-2.5 text-xs font-black text-emerald-300 shadow-lg backdrop-blur transition hover:border-emerald-400 hover:bg-emerald-400 hover:text-black sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">Vendor</span>
            <span className="hidden sm:inline">
              Vendor Login / Sign Up
            </span>
          </Link>
        </div>

        {children}
      </body>
    </html>
  );
}
