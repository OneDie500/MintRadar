"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type Card = { id: string; name: string | null; set_name: string | null; card_number: string | null; language: string | null; category: string | null; finish: string | null; variant: string | null; edition: string | null; external_id: string | null };
type Candidate = { id: number; name: string; set_name: string; number: string; printing: string | null; tcgplayer_id: number | null; image_url?: string | null; product_url?: string | null; same_set?: boolean; same_number?: boolean; confidence?: number; review_required?: boolean };
type Evaluated = Candidate & { nameMatch: boolean; setMatch: boolean; numberMatch: boolean; printMatch: "match" | "mismatch" | "unknown"; score: number; decision: string };
type Result = { card: Card; candidates: Evaluated[]; status: string; reason: string; queryName: string; incomplete: boolean };
type ApprovalState = { busy?: boolean; message: string; ok?: boolean };

function normalizeName(s: string | null | undefined): string {
  return (s || "").normalize("NFKC").toLowerCase().replace(/[‘’`´]/g, "'").replace(/\s+/g, " ").trim();
}
function normalizeSet(s: string | null | undefined): string {
  return (s || "").normalize("NFKC").toLowerCase()
    .replace(/^\s*(?:sv\d+[a-z]?|swsh\d+[a-z]?|sm|xy|bw|dp|pl|hgss)\s*[:\-–]\s*/i, "")
    .replace(/^\s*(?:scarlet\s*&\s*violet|sword\s*&\s*shield|sun\s*&\s*moon)\s*[:\-–]\s*/i, "")
    .replace(/\s*&\s*/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
function normalizeNumber(s: string | null | undefined): string {
  const first = (s || "").normalize("NFKC").trim().split("/")[0].replace(/\s+/g, "").toUpperCase();
  const match = /^([A-Z]*)(\d+)([A-Z]*)$/.exec(first);
  if (!match) return first;
  return `${match[1]}${String(Number(match[2]))}${match[3]}`;
}
function printKind(s: string | null | undefined): "normal" | "holo" | "reverse" | "etched" | "cosmos" | "master-ball" | "poke-ball" | "parallel" | "stamped" | "unknown" {
  const v = (s || "").toLowerCase();
  if (!v.trim()) return "unknown";
  if (/reverse/.test(v)) return "reverse";
  if (/master[\s-]*ball/.test(v)) return "master-ball";
  if (/pok[eé][\s-]*ball/.test(v)) return "poke-ball";
  if (/cosmos/.test(v)) return "cosmos";
  if (/etched/.test(v)) return "etched";
  if (/stamped/.test(v)) return "stamped";
  if (/parallel/.test(v)) return "parallel";
  if (/non[\s-]?holo|non[\s-]?foil|normal|regular|standard/.test(v)) return "normal";
  if (/holo|foil/.test(v)) return "holo";
  return "unknown";
}
function evaluate(card: Card, candidate: Candidate): Evaluated {
  const nameMatch = normalizeName(card.name) === normalizeName(candidate.name);
  const setMatch = !!normalizeSet(card.set_name) && normalizeSet(card.set_name) === normalizeSet(candidate.set_name);
  const numberMatch = !!normalizeNumber(card.card_number) && normalizeNumber(card.card_number) === normalizeNumber(candidate.number);
  const catalogPrintings = [...new Set([card.finish, card.variant, card.edition]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(printKind).filter(kind => kind !== "unknown"))];
  const wanted = catalogPrintings.length === 1 ? catalogPrintings[0] : "unknown";
  const offered = printKind(candidate.printing);
  const printMatch = wanted === "unknown" || offered === "unknown" ? "unknown" : wanted === offered ? "match" : "mismatch";
  const score = (nameMatch ? 35 : 0) + (setMatch ? 35 : 0) + (numberMatch ? 25 : 0) + (printMatch === "match" ? 5 : 0);
  const decision = !nameMatch || !setMatch || !numberMatch ? "Identity not confirmed" : printMatch === "mismatch" ? "Identity match · printing mismatch" : printMatch === "unknown" ? "Identity match · printing review" : "Strong candidate · manual approval required";
  return { ...candidate, nameMatch, setMatch, numberMatch, printMatch, score, decision };
}
function candidateSummary(candidates: Evaluated[]): string {
  if (!candidates.length) return "No candidates returned. Search or naming review needed.";
  const exact = candidates.filter(c => c.nameMatch && c.setMatch && c.numberMatch);
  if (!exact.length) return "No exact identity match found among returned candidates.";
  if (exact.length > 1) return "Multiple identity matches found; review variants before selecting one.";
  return exact[0].printMatch === "mismatch" ? "Exact identity candidate found, but printing differs." : exact[0].printMatch === "unknown" ? "Exact identity candidate found; printing needs review." : "Strong identity and printing candidate found; manual approval still required.";
}

export default function MarketMatchDryRunPage() {
  const [limit, setLimit] = useState(5);
  const [rows, setRows] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [approvals, setApprovals] = useState<Record<string, ApprovalState>>({});

  async function run() {
    if (busy) return;
    setBusy(true); setRows([]); setApprovals({}); setError(""); setProgress("Loading eligible catalog cards...");
    try {
      const { data, error: cardsError } = await supabase.from("cards")
        .select("id,name,set_name,card_number,language,category,finish,variant,edition,external_id")
        .eq("language", "EN").ilike("category", "pokemon")
        .not("name", "is", null).order("name", { ascending: true }).limit(100);
      if (cardsError) throw new Error(cardsError.message);
      const cards = (data || []) as Card[];
      if (!cards.length) throw new Error("No eligible English Pokémon cards returned. Check RLS and filters.");
      const { data: links, error: linksError } = await supabase.from("card_provider_links")
        .select("card_id,provider,match_status").in("card_id", cards.map(c => c.id))
        .in("provider", ["tcgapi", "tcgplayer"]);
      if (linksError) throw new Error(linksError.message);
      const mapped = new Set((links || []).filter(l => l.provider === "tcgapi" || l.match_status === "verified" || l.match_status === "manual").map(l => l.card_id));
      const selected = cards.filter(c => !mapped.has(c.id) && c.name && c.set_name && c.card_number).slice(0, limit);
      if (!selected.length) throw new Error("No unmapped cards found among the first 100 alphabetically. No changes made.");
      const output: Result[] = [];
      for (const [index, card] of selected.entries()) {
        setProgress(`Checking ${index + 1} of ${selected.length}: ${card.name}`);
        const queryName = card.name || "";
        try {
          const params = new URLSearchParams({ mode: "discover", name: queryName, setName: card.set_name || "", cardNumber: card.card_number || "", language: card.language || "", category: card.category || "" });
          const response = await fetch(`/api/tcg-market-preview?${params}`, { cache: "no-store" });
          let payload = await response.json();
          // An alternate discovery query is a suggestion only, never an identity approval.
          if (payload.ok && !payload.incomplete && !(payload.candidates || []).length && /_{3,}.*pikachu/i.test(queryName)) {
            const fallbackParams = new URLSearchParams(params);
            fallbackParams.set("name", "Pikachu");
            const fallbackResponse = await fetch(`/api/tcg-market-preview?${fallbackParams}`, { cache: "no-store" });
            if (fallbackResponse.ok) {
              const fallbackPayload = await fallbackResponse.json();
              if (fallbackPayload.ok) payload = fallbackPayload;
            }
          }
          if (!response.ok || !payload.ok) {
            output.push({ card, queryName, candidates: [], status: "Needs review", reason: payload.reason || `HTTP ${response.status}`, incomplete: Boolean(payload.incomplete) });
          } else {
            const candidates = ((payload.candidates || []) as Candidate[]).map(c => evaluate(card, c)).sort((a, b) => b.score - a.score);
            const exact = candidates.filter(c => c.nameMatch && c.setMatch && c.numberMatch && c.printMatch === "match");
            output.push({ card, queryName, candidates, status: payload.incomplete ? "Incomplete discovery (review only)" : exact.length === 1 ? "Strong identity candidate (review required)" : "Manual review", reason: payload.incomplete ? `${candidateSummary(candidates)} Search results are incomplete; approval disabled.` : candidateSummary(candidates), incomplete: Boolean(payload.incomplete) });
          }
        } catch (e) {
          output.push({ card, queryName, candidates: [], status: "Lookup error", reason: e instanceof Error ? e.message : "Unknown error", incomplete: false });
        }
        setRows([...output]);
      }
      setProgress(`Complete: ${output.length} checked. No mappings saved by discovery.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unknown error"); setProgress(""); }
    finally { setBusy(false); }
  }

  async function approve(card: Card, candidate: Evaluated, incomplete: boolean) {
    const key = `${card.id}:${candidate.id}`;
    if (incomplete || !candidate.nameMatch || !candidate.setMatch || !candidate.numberMatch || candidate.printMatch !== "match" || !Number.isSafeInteger(candidate.tcgplayer_id) || !candidate.tcgplayer_id || candidate.tcgplayer_id <= 0) {
      setApprovals(prev => ({ ...prev, [key]: { message: "Approval blocked: exact identity and printing are required." } }));
      return;
    }
    if (!window.confirm(`Approve ${card.name} (${card.set_name} #${card.card_number}) as TCG API ${candidate.id}? This saves one mapping.`)) return;
    setApprovals(prev => ({ ...prev, [key]: { busy: true, message: "Verifying on server..." } }));
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) throw new Error("Sign in to MintRadar before approving.");
      const response = await fetch("/api/tcg-matching/approve", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ cardId: card.id, tcgapiId: candidate.id }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.reason || `HTTP ${response.status}`);
      setApprovals(prev => ({ ...prev, [key]: { ok: true, message: "Verified mapping saved!" } }));
    } catch (err) {
      setApprovals(prev => ({ ...prev, [key]: { message: err instanceof Error ? err.message : "Approval failed" } }));
    }
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ generated_at: new Date().toISOString(), mode: "manual-approval-v5", normalization: "client-side", results: rows }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "mintradar-tcgapi-review-v5.json"; anchor.click(); URL.revokeObjectURL(url);
  }

  if (process.env.NODE_ENV !== "development") return <main className="min-h-screen bg-black p-8 text-white">Development-only tool.</main>;
  return <main className="min-h-screen bg-black px-5 py-10 text-white"><div className="mx-auto max-w-5xl space-y-6">
    <div><p className="text-xs font-black uppercase tracking-widest text-emerald-400">MintRadar · Catalog Matching</p><h1 className="mt-2 text-3xl font-black">TCG API Matching · V5</h1><p className="mt-3 text-sm text-zinc-400">Read-only discovery plus individual server-verified approval for exact identity and printing matches. No bulk approvals. Requires an authorized catalog admin.</p></div>
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"><label className="text-sm font-bold" htmlFor="batch-limit">Cards to test (maximum 5)</label><select id="batch-limit" className="ml-3 rounded-lg bg-zinc-900 p-2" value={limit} onChange={e => setLimit(Number(e.target.value))} disabled={busy}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}</select><div className="mt-4 flex flex-wrap gap-3"><button className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black disabled:opacity-50" disabled={busy} onClick={run}>{busy ? "Checking..." : "Run read-only matching"}</button><button className="rounded-xl border border-zinc-700 px-5 py-3 font-bold disabled:opacity-40" disabled={!rows.length || busy} onClick={exportJson}>Export JSON results</button></div><p className="mt-3 text-xs text-zinc-500">Up to {limit} initial discovery requests plus optional Pikachu fallback requests. Only the first 100 eligible catalog cards are considered. Incomplete searches and ambiguous exact matches cannot be approved. Normalization is applied locally to returned candidates; it does not change the API search or discover missing candidates.</p>{progress && <p className="mt-3 text-emerald-300">{progress}</p>}{error && <p className="mt-3 text-red-300">{error}</p>}</div>
    {rows.map(result => <section key={result.card.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-black">{result.card.name}</h2><span className="text-xs text-amber-300">{result.status}</span></div><p className="mt-1 text-sm text-zinc-400">{result.card.set_name} · #{result.card.card_number} · {[result.card.finish, result.card.variant, result.card.edition].filter(Boolean).join(" / ") || "Printing unspecified"} · {result.card.external_id}</p><p className="mt-2 text-xs text-zinc-500">{result.reason}</p>{result.candidates.length ? <div className="mt-4 space-y-2">{result.candidates.slice(0,5).map(candidate => <div key={candidate.id} className="rounded-xl border border-zinc-800 p-3 text-sm"><strong>{candidate.name}</strong> · {candidate.set_name} · #{candidate.number}<p className="mt-1 text-xs text-zinc-400">TCG API {candidate.id} · TCGplayer {candidate.tcgplayer_id ?? "unknown"} · {candidate.printing || "unknown printing"}</p><p className="mt-1 text-xs text-zinc-400">Name {candidate.nameMatch ? "✓" : "✕"} · Set {candidate.setMatch ? "✓" : "✕"} · Number {candidate.numberMatch ? "✓" : "✕"} · Printing {candidate.printMatch} · Identity score {candidate.score}/100</p><p className="mt-1 text-xs text-amber-300">{candidate.decision}</p>{candidate.nameMatch && candidate.setMatch && candidate.numberMatch && candidate.printMatch === "match" && !result.incomplete && Number.isSafeInteger(candidate.tcgplayer_id) && (candidate.tcgplayer_id ?? 0) > 0 && result.candidates.filter(c => c.nameMatch && c.setMatch && c.numberMatch).length === 1 && <div className="mt-3"><button disabled={busy || approvals[`${result.card.id}:${candidate.id}`]?.busy || approvals[`${result.card.id}:${candidate.id}`]?.ok} onClick={() => approve(result.card, candidate, result.incomplete)} className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-40">{approvals[`${result.card.id}:${candidate.id}`]?.busy ? "Verifying..." : approvals[`${result.card.id}:${candidate.id}`]?.ok ? "Approved" : "Approve exact match"}</button></div>}{approvals[`${result.card.id}:${candidate.id}`]?.message && <p className="mt-2 text-xs text-emerald-200">{approvals[`${result.card.id}:${candidate.id}`].message}</p>}</div>)}</div> : <p className="mt-3 text-sm text-zinc-500">No candidates returned.</p>}</section>)}
  </div></main>;
}
