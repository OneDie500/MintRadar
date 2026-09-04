import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import AccountNav from "./components/AccountNav";
import MessagesNav from "./components/MessagesNav";
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
          <MessagesNav />

          <Link
            href="/cart"
            className="rounded-xl border border-zinc-700 bg-black/90 px-3 py-2.5 text-xs font-black text-zinc-200 shadow-lg backdrop-blur transition hover:border-emerald-400 hover:text-emerald-300 sm:px-4 sm:text-sm"
          >
            Cart
          </Link>

          <Link
            href="/wishlist"
            className="rounded-xl border border-zinc-700 bg-black/90 px-3 py-2.5 text-xs font-black text-zinc-200 shadow-lg backdrop-blur transition hover:border-emerald-400 hover:text-emerald-300 sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">♡</span>
            <span className="hidden sm:inline">♡ Wishlist</span>
          </Link>

          <AccountNav />
        </div>

        {children}
      </body>
    </html>
  );
}
