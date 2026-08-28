import { Suspense } from "react";
import SetsClient from "./SetsClient";

function SetsPageFallback() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-5">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-8 py-6 text-center">
          <p className="text-sm font-bold text-zinc-500">
            Loading MintRadar Set Explorer...
          </p>
        </div>
      </div>
    </main>
  );
}

export default function BrowseSetsPage() {
  return (
    <Suspense fallback={<SetsPageFallback />}>
      <SetsClient />
    </Suspense>
  );
}
