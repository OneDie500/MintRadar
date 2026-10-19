"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Card = {
  external_id: string; data_source: string; name?: string | null; canonical_name?: string | null;
  set_name?: string | null; set_id?: string | null; card_number?: string | null;
  image_url?: string | null; category?: string | null; language?: string | null;
  variant?: string | null; rarity?: string | null; edition?: string | null;
  finish?: string | null; year?: string | null; manufacturer?: string | null;
  release_name?: string | null; parallel_name?: string | null; sport?: string | null;
  print_run?: number | null; rookie?: boolean | null;
};
const ROUTES: Record<string, string> = {
  Pokemon: "/api/catalog/search", Sports: "/api/catalog/sports",
  "One Piece": "/api/catalog/onepiece", "Magic: The Gathering": "/api/catalog/mtg",
  "Yu-Gi-Oh!": "/api/catalog/yugioh", Lorcana: "/api/catalog/lorcana",
};
const PAGE_SIZE = 50;
const normalize = (v: string) => v.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function relevant(card: Card, q: string) {
  const tokens = normalize(q).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const words = normalize([card.name, card.canonical_name, card.set_name, card.set_id, card.card_number, card.rarity, card.edition, card.finish, card.year, card.manufacturer, card.release_name, card.parallel_name, card.sport, card.external_id].filter(Boolean).join(" ")).split(/\s+/);
  return tokens.every(t => words.some(w => w === t || w.startsWith(t)));
}
function identity(c: Card) { return `${c.data_source}:${c.language || ""}:${c.external_id}:${c.set_id || ""}`; }
function cardHref(card: Card) {
  const params = new URLSearchParams();
  const names: Record<string,string> = {set_name:"setName",card_number:"cardNumber",image_url:"imageUrl",external_id:"externalId",data_source:"dataSource",canonical_name:"canonicalName",set_id:"setId"};
  for (const [k,v] of Object.entries(card)) if (typeof v === "string" && v) params.set(names[k] || k,v);
  return `/catalog-card?${params.toString()}`;
}
// TCGdex stores a base image path, not always a directly renderable file.
// Only append a format to known TCGdex asset paths; never rewrite other hosts.
function displayArtworkUrl(value?: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.hostname !== "assets.tcgdex.net" || url.protocol !== "https:") return value;
    if (/\.(?:png|webp|jpe?g)$/i.test(url.pathname)) return value;
    return `${value.replace(/\/+$/, "")}/high.webp`;
  } catch {
    return value;
  }
}
function Artwork({card}: {card: Card}) {
  // Resolve only the exact printing. Never substitute another language or set.
  const [src, setSrc] = useState(displayArtworkUrl(card.image_url));
  const [failed, setFailed] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(false);
  const key = identity(card);

  useEffect(() => {
    setSrc(displayArtworkUrl(card.image_url));
    setFailed(false);
    setResolving(false);
    setResolved(false);
  }, [key, card.image_url]);

  useEffect(() => {
    if (resolved || resolving || (src && !failed) || card.category !== "Pokemon" || !card.name) return;
    const controller = new AbortController();
    setResolved(true);
    setResolving(true);
    // Never allow fuzzy cross-set artwork for regional printings.
    if (card.language && card.language !== "EN" && (!card.set_id || !card.card_number)) return;
    const p = new URLSearchParams({ name: card.name, language: card.language || "EN" });
    if (card.set_name) p.set("setName", card.set_name);
    if (card.set_id) p.set("setId", card.set_id);
    if (card.card_number) p.set("cardNumber", card.card_number);
    if (card.variant) p.set("variant", card.variant);
    fetch(`/api/catalog/pokemon-image-fallback?${p.toString()}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (controller.signal.aborted) return;
        const next = data?.ok && typeof data.imageUrl === "string" ? data.imageUrl : "";
        // Don't retry the same broken URL endlessly.
        if (next && displayArtworkUrl(next) !== src) { setSrc(displayArtworkUrl(next)); setFailed(false); }
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setResolving(false); });
    return () => controller.abort();
  }, [src, failed, resolved, resolving, card]);

  return <div className="aspect-[3/4] bg-black rounded-xl flex items-center justify-center overflow-hidden">
    {src && !failed
      ? <img src={src} alt={card.canonical_name || card.name || "Card"} loading="lazy" className="w-full h-full object-contain" onError={() => setFailed(true)} />
      : <div className="px-3 text-center text-zinc-500 text-xs">
          {resolving ? "Finding artwork…" : "Artwork unavailable for this printing"}
        </div>}
  </div>;
}
function Browser() {
  const params = useSearchParams();
  const initialQ = params.get("q") || "";
  const [input,setInput] = useState(initialQ);
  const [query,setQuery] = useState(initialQ);
  const [category,setCategory] = useState(params.get("category") || "All");
  const [language,setLanguage] = useState("All");
  const [setFilter,setSetFilter] = useState("All");
  const [cards,setCards] = useState<Card[]>([]);
  const [page,setPage] = useState(1);
  const [batch,setBatch] = useState(1);
  const [hasMore,setHasMore] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [selectedMessage,setSelectedMessage] = useState("");
  const vendorMode = params.get("mode") === "vendor";
  useEffect(()=>{setCards([]);setPage(1);setBatch(1);setLanguage("All");setSetFilter("All");setHasMore(false);},[query,category]);
  useEffect(()=>{
    if(query.trim().length<2) {setCards([]);setHasMore(false);return;}
    const controller = new AbortController();
    async function load() {
      setLoading(true);setError("");
      try {
        const routes = category === "All" ? Object.entries(ROUTES) : Object.entries(ROUTES).filter(([name])=>name===category);
        // Existing provider endpoints generally return 20 cards. Fetch three consecutive
        // provider pages per batch, allowing a 50-card UI page without changing those APIs.
        const outcomes = await Promise.allSettled(routes.map(async ([name,url])=>{
          const pages = await Promise.all([0,1,2].map(async offset=>{
            const providerPage = (batch-1)*3+offset+1;
            const r = await fetch(`${url}?q=${encodeURIComponent(query.trim())}&page=${providerPage}`,{signal:controller.signal});
            if(!r.ok) throw new Error(`${name} catalog unavailable`);
            return r.json();
          }));
          return {results:pages.flatMap(d=>Array.isArray(d.results)?d.results as Card[]:[]),hasMore:Boolean(pages[2]?.hasMore)};
        }));
        if(controller.signal.aborted)return;
        const successes=outcomes.filter((o):o is PromiseFulfilledResult<{results:Card[];hasMore:boolean}>=>o.status==="fulfilled");
        if(!successes.length) throw new Error("Catalog search is temporarily unavailable.");
        setCards(current=>{
          const merged=new Map((batch===1?[]:current).map(c=>[identity(c),c] as const));
          for(const outcome of successes)for(const c of outcome.value.results)if(c.external_id&&c.data_source&&relevant(c,query))merged.set(identity(c),c);
          return [...merged.values()];
        });
        setHasMore(successes.some(o=>o.value.hasMore));
        if(outcomes.some(o=>o.status==="rejected"))setError("Some catalogs could not be searched. Results may be incomplete.");
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Search failed");}
      finally{if(!controller.signal.aborted)setLoading(false);}
    }
    void load();return()=>controller.abort();
  },[query,category,batch]);
  const languages=useMemo(()=>[...new Set(cards.map(c=>c.language).filter((v):v is string=>Boolean(v)))].sort(),[cards]);
  const sets=useMemo(()=>[...new Set(cards.map(c=>c.set_name).filter((v):v is string=>Boolean(v)))].sort(),[cards]);
  const filtered=cards.filter(c=>(language==="All"||c.language===language)&&(setFilter==="All"||c.set_name===setFilter));
  const totalLoadedPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const visible=filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  function go(next:number){if(next<1||loading)return;if(next<=totalLoadedPages){setPage(next);window.scrollTo({top:0,behavior:"smooth"});return;}if(hasMore){setBatch(b=>b+1);setPage(next);window.scrollTo({top:0,behavior:"smooth"});}}
  function choose(c:Card){localStorage.setItem("mintradar:vendor-catalog-selection",JSON.stringify({card:c,category:c.category||category}));setSelectedMessage(`${c.canonical_name||c.name} selected. Return to your Add Inventory tab to finish the listing.`);}
  return <main className="min-h-screen bg-black text-white px-5 py-8"><div className="max-w-7xl mx-auto">
    <Link href={vendorMode?"/vendor/add":"/"} className="text-zinc-400 hover:text-emerald-400">← {vendorMode?"Vendor Add Inventory":"MintRadar Home"}</Link>
    <p className="text-emerald-400 uppercase tracking-widest text-xs font-bold mt-8">MintRadar Universal Catalog</p>
    <h1 className="text-4xl font-black mt-2">Explore Every Printing</h1>
    <p className="text-zinc-500 mt-3">One search across all connected catalogs. Filters are optional.</p>
    <form className="flex gap-3 mt-7" onSubmit={e=>{e.preventDefault();setQuery(input.trim());}}><input className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3" value={input} onChange={e=>setInput(e.target.value)} placeholder="Pikachu, Luffy, Mewtwo, card number..."/><button className="bg-emerald-400 text-black rounded-xl px-5 font-black">Search</button></form>
    <div className="flex flex-wrap gap-3 mt-5">
      <select aria-label="Catalog" className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2" value={category} onChange={e=>setCategory(e.target.value)}><option value="All">All catalogs</option>{Object.keys(ROUTES).map(v=><option key={v} value={v}>{v}</option>)}</select>
      <select aria-label="Language" className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2" value={language} onChange={e=>{setLanguage(e.target.value);setPage(1);}}><option value="All">All languages</option>{languages.map(v=><option key={v}>{v}</option>)}</select>
      <select aria-label="Set" className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 max-w-64" value={setFilter} onChange={e=>{setSetFilter(e.target.value);setPage(1);}}><option value="All">All sets</option>{sets.map(v=><option key={v}>{v}</option>)}</select>
    </div>
    {selectedMessage&&<p role="status" className="mt-5 text-emerald-400">{selectedMessage}</p>}
    {error&&<p role="alert" className="mt-5 text-amber-400">{error}</p>}
    <p className="mt-7 text-zinc-400">{loading?"Loading printings...":`Showing ${visible.length} of ${filtered.length} loaded matches · Page ${page}`}</p>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-5">{visible.map(c=><div key={identity(c)} className="rounded-2xl bg-zinc-950 border border-zinc-800 p-3 flex flex-col">
      <Artwork card={c}/><h2 className="font-bold mt-3">{c.canonical_name||c.name}</h2>
      {c.canonical_name&&c.canonical_name!==c.name&&<p className="text-zinc-500 text-xs">{c.name}</p>}
      <p className="text-zinc-400 text-xs mt-1">{c.set_name||"Unknown set"} {c.card_number?`#${c.card_number}`:""}</p>
      <p className="text-zinc-600 text-xs mt-1">{c.category} {c.language?`· ${c.language}`:""} · {c.external_id}</p>
      <div className="mt-auto pt-4">{vendorMode?<><button type="button" onClick={()=>choose(c)} className="w-full rounded-lg bg-emerald-400 text-black font-bold py-2">Add to Inventory</button><Link href={cardHref(c)} target="_blank" rel="noopener noreferrer" className="block text-center text-zinc-400 hover:text-white text-xs mt-2">View Card</Link></>:<Link className="block text-center rounded-lg border border-emerald-400 text-emerald-400 font-bold py-2" href={cardHref(c)}>View Card</Link>}</div>
    </div>)}</div>
    {(filtered.length>PAGE_SIZE||hasMore)&&<nav aria-label="Catalog pages" className="flex flex-wrap justify-center items-center gap-2 my-10"><button disabled={page===1||loading} onClick={()=>go(page-1)} className="border border-zinc-700 rounded-lg px-3 py-2 disabled:opacity-40">Previous</button>{Array.from({length:totalLoadedPages},(_,i)=>i+1).map(n=><button key={n} onClick={()=>go(n)} aria-current={n===page?"page":undefined} className={`rounded-lg px-4 py-2 border ${n===page?"bg-emerald-400 text-black border-emerald-400":"border-zinc-700"}`}>{n}</button>)}{hasMore&&<button disabled={loading} onClick={()=>go(totalLoadedPages+1)} className="border border-zinc-700 rounded-lg px-4 py-2">{totalLoadedPages+1}…</button>}<button disabled={loading||(!hasMore&&page>=totalLoadedPages)} onClick={()=>go(page+1)} className="border border-zinc-700 rounded-lg px-3 py-2 disabled:opacity-40">Next</button></nav>}
    {!loading&&!visible.length&&query.trim().length>=2&&!error&&<p className="text-zinc-500 mt-8">No matches in loaded results.</p>}
    <p className="text-zinc-600 text-xs mt-5">Page numbers expand as more catalog results are retrieved. Filters apply to loaded matches.</p>
  </div></main>;
}
export default function CatalogPage(){return <Suspense fallback={<main className="min-h-screen bg-black text-white p-8">Loading catalog...</main>}><Browser/></Suspense>;}
