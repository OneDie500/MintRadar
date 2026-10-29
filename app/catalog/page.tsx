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
function normalizeLanguage(value?: string | null): string {
  const raw = (value || "EN").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (["jp", "ja", "jpn", "japanese"].includes(raw)) return "JP";
  if (["cn-tw", "zh-tw", "tw", "traditional-chinese"].includes(raw)) return "CN-TW";
  if (["cn", "zh-cn", "chs", "simplified-chinese", "chinese"].includes(raw)) return "CN";
  if (["en", "eng", "english"].includes(raw)) return "EN";
  return raw.toUpperCase();
}
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
  // The result grid keys this component by printing + URL, so each printing
  // gets its own image and recovery lifecycle.
  const originalUrl = displayArtworkUrl(card.image_url);
  const [src, setSrc] = useState(originalUrl);
  const [stage, setStage] = useState<"original" | "png" | "retry" | "fallback" | "unavailable">(
    originalUrl ? "original" : "fallback"
  );
  const [resolving, setResolving] = useState(!originalUrl);
  const [fallbackRequested, setFallbackRequested] = useState(!originalUrl);
  const [retryCount, setRetryCount] = useState(0);
  const [fallbackComplete, setFallbackComplete] = useState(false);

  const name = card.name || card.canonical_name || "";
  const language = normalizeLanguage(card.language);
  const setId = card.set_id || "";
  const setName = card.set_name || "";
  const cardNumber = card.card_number || "";
  const variant = card.variant || "";
  const isPokemon = (card.category || "").toLowerCase().replace(/[^a-z]/g, "") === "pokemon";

  // Do not trigger a network storm on the first image error. Try the SAME
  // printing again after a short delay, then ask the existing resolver.
  useEffect(() => {
    if (stage !== "retry") return;
    const timeout = setTimeout(() => {
      const separator = originalUrl.includes("?") ? "&" : "?";
      setSrc(`${originalUrl}${separator}mr_image_retry=${retryCount}`);
      setResolving(false);
    }, 700 * retryCount);
    return () => clearTimeout(timeout);
  }, [stage, originalUrl, retryCount]);

  useEffect(() => {
    if (!fallbackRequested || stage !== "fallback" || fallbackComplete) return;
    if (!isPokemon || !name || (language !== "EN" && (!setId || !cardNumber))) {
      setResolving(false);
      setStage("unavailable");
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ name, language });
    if (setId) params.set("setId", setId);
    if (cardNumber) params.set("cardNumber", cardNumber);
    if (variant) params.set("variant", variant);
    if (language === "EN" && setName) params.set("setName", setName);

    setResolving(true);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    void (async () => {
      try {
        const response = await fetch(
          `/api/catalog/pokemon-image-fallback?${params.toString()}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`Artwork resolver HTTP ${response.status}`);
        const payload = await response.json();
        if (controller.signal.aborted) return;
        const candidate = payload?.ok && typeof payload.imageUrl === "string"
          ? displayArtworkUrl(payload.imageUrl)
          : "";
        // The original has already failed twice. Returning that same URL
        // is not a successful recovery, and must not create an endless loop.
        setFallbackComplete(true);
        if (candidate && (!originalUrl || candidate !== originalUrl)) {
          setSrc(candidate);
          setStage("fallback");
          setResolving(false);
        } else {
          setSrc("");
          setStage("unavailable");
          setResolving(false);
        }
      } catch {
        if (controller.signal.aborted && !timedOut) return;
        setFallbackComplete(true);
        setSrc("");
        setStage("unavailable");
        setResolving(false);
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [fallbackRequested, fallbackComplete, stage, originalUrl, isPokemon, name, language, setId, setName, cardNumber, variant]);

  const handleImageError = () => {
    if (stage === "original" && src.startsWith("https://assets.tcgdex.net/") && src.endsWith("/high.webp")) {
      setSrc(`${src.slice(0, -"high.webp".length)}high.png`);
      setStage("png");
      return;
    }
    if (!fallbackRequested && originalUrl && retryCount < 2) {
      setRetryCount(count => count + 1);
      setSrc("");
      setStage("retry");
      setResolving(true);
      return;
    }
    if (!fallbackRequested) {
      setSrc("");
      setStage("fallback");
      setFallbackRequested(true);
      setResolving(true);
      return;
    }
    setSrc("");
    setStage("unavailable");
    setResolving(false);
  };

  const tryAgain = () => {
    setFallbackRequested(false);
    setFallbackComplete(false);
    setRetryCount(0);
    setSrc(originalUrl);
    setStage(originalUrl ? "original" : "fallback");
    setResolving(!originalUrl);
    if (!originalUrl) setFallbackRequested(true);
  };

  return <div className="aspect-[3/4] bg-black rounded-xl flex items-center justify-center overflow-hidden">
    {src && stage !== "unavailable"
      ? <img
          src={src}
          alt={card.canonical_name || card.name || "Card"}
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain"
          onError={handleImageError}
        />
      : <div className="px-3 text-center text-zinc-500 text-xs">
          {resolving ? "Finding artwork…" : <>
            <p>Artwork unavailable for this printing</p>
            <button type="button" onClick={tryAgain} className="mt-2 text-emerald-400 underline underline-offset-2">Retry artwork</button>
          </>}
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
  const [serverTotal,setServerTotal] = useState<number | null>(null);
  const [serverPages,setServerPages] = useState<number | null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");
  const [selectedMessage,setSelectedMessage] = useState("");
  const vendorMode = params.get("mode") === "vendor";
  useEffect(()=>{setCards([]);setPage(1);setBatch(1);setSetFilter("All");setHasMore(false);setServerTotal(null);setServerPages(null);},[query,category,language]);
  useEffect(()=>{
    if(query.trim().length<2) {setCards([]);setHasMore(false);return;}
    const controller = new AbortController();
    async function load() {
      setLoading(true);setError("");
      try {
        const routes = category === "All" ? Object.entries(ROUTES) : Object.entries(ROUTES).filter(([name])=>name===category);
        // For Pokémon with a selected language, let Supabase filter before
        // pagination. The API supports pageSize=50 and reports the real total.
        // Other providers retain their existing three-page batch behavior.
        const pokemonScoped = category === "Pokemon" && language !== "All";
        const outcomes = await Promise.allSettled(routes.map(async ([name,url])=>{
          if (name === "Pokemon" && pokemonScoped) {
            const search = new URLSearchParams({q:query.trim(),language,page:String(batch),pageSize:String(PAGE_SIZE)});
            const r = await fetch(`${url}?${search.toString()}`,{signal:controller.signal});
            if(!r.ok) throw new Error(`${name} catalog unavailable`);
            const d = await r.json();
            return {results:Array.isArray(d.results)?d.results as Card[]:[],hasMore:Boolean(d.hasMore),total:typeof d.total==="number"?d.total:null,totalPages:typeof d.totalPages==="number"?d.totalPages:null};
          }
          const pages = await Promise.all([0,1,2].map(async offset=>{
            const providerPage = (batch-1)*3+offset+1;
            const r = await fetch(`${url}?q=${encodeURIComponent(query.trim())}&page=${providerPage}`,{signal:controller.signal});
            if(!r.ok) throw new Error(`${name} catalog unavailable`);
            return r.json();
          }));
          return {results:pages.flatMap(d=>Array.isArray(d.results)?d.results as Card[]:[]),hasMore:Boolean(pages[2]?.hasMore),total:null,totalPages:null};
        }));
        if(controller.signal.aborted)return;
        const successes=outcomes.filter((o):o is PromiseFulfilledResult<{results:Card[];hasMore:boolean;total:number|null;totalPages:number|null}>=>o.status==="fulfilled");
        if(!successes.length) throw new Error("Catalog search is temporarily unavailable.");
        setCards(current=>{
          const merged=new Map((batch===1||pokemonScoped?[]:current).map(c=>[identity(c),c] as const));
          for(const outcome of successes)for(const c of outcome.value.results)if(c.external_id&&c.data_source&&(pokemonScoped||relevant(c,query)))merged.set(identity(c),c);
          return [...merged.values()];
        });
        setHasMore(successes.some(o=>o.value.hasMore));
        setServerTotal(pokemonScoped?successes[0]?.value.total??null:null);
        setServerPages(pokemonScoped?successes[0]?.value.totalPages??null:null);
        if(outcomes.some(o=>o.status==="rejected"))setError("Some catalogs could not be searched. Results may be incomplete.");
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Search failed");}
      finally{if(!controller.signal.aborted)setLoading(false);}
    }
    void load();return()=>controller.abort();
  },[query,category,language,batch]);
  const languages=useMemo(()=>[...new Set(["EN", "JP", "CN", "CN-TW", ...cards.map(c=>normalizeLanguage(c.language)).filter(Boolean)])].sort((a,b)=>["EN","JP","CN","CN-TW"].indexOf(a)-["EN","JP","CN","CN-TW"].indexOf(b)),[cards]);
  const sets=useMemo(()=>[...new Set(cards.map(c=>c.set_name).filter((v):v is string=>Boolean(v)))].sort(),[cards]);
  const filtered=cards.filter(c=>(language==="All"||normalizeLanguage(c.language)===language)&&(setFilter==="All"||c.set_name===setFilter));
  const totalLoadedPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const pageCount=category==="Pokemon"&&language!=="All"&&setFilter==="All"&&serverPages!==null?serverPages:totalLoadedPages;
  const serverPaging=category==="Pokemon"&&language!=="All"&&setFilter==="All";
  const visible=serverPaging?filtered.slice(0,PAGE_SIZE):filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  function go(next:number){
    if(next<1||loading)return;
    if(category==="Pokemon"&&language!=="All"&&setFilter==="All"){
      if(serverPages!==null&&next>serverPages)return;
      setPage(next);setBatch(next);window.scrollTo({top:0,behavior:"smooth"});return;
    }
    if(next<=totalLoadedPages){setPage(next);window.scrollTo({top:0,behavior:"smooth"});return;}
    if(hasMore){setBatch(b=>b+1);setPage(next);window.scrollTo({top:0,behavior:"smooth"});}
  }
  function choose(c:Card){localStorage.setItem("mintradar:vendor-catalog-selection",JSON.stringify({card:c,category:c.category||category}));setSelectedMessage(`${c.canonical_name||c.name} selected. Return to your Add Inventory tab to finish the listing.`);}
  return <main className="min-h-screen bg-black text-white px-5 py-8"><div className="max-w-7xl mx-auto">
    <Link href={vendorMode?"/vendor/add":"/"} className="text-zinc-400 hover:text-emerald-400">← {vendorMode?"Vendor Add Inventory":"MintRadar Home"}</Link>
    <p className="text-emerald-400 uppercase tracking-widest text-xs font-bold mt-8">MintRadar Universal Catalog</p>
    <h1 className="text-4xl font-black mt-2">Explore Every Printing</h1>
    <p className="text-zinc-500 mt-3">One search across all connected catalogs. Filters are optional.</p>
    <form className="flex gap-3 mt-7" onSubmit={e=>{e.preventDefault();setQuery(input.trim());}}><input className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3" value={input} onChange={e=>setInput(e.target.value)} placeholder="Pikachu, Luffy, Mewtwo, card number..."/><button className="bg-emerald-400 text-black rounded-xl px-5 font-black">Search</button></form>
    <div className="flex flex-wrap gap-3 mt-5">
      <select aria-label="Catalog" className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2" value={category} onChange={e=>setCategory(e.target.value)}><option value="All">All catalogs</option>{Object.keys(ROUTES).map(v=><option key={v} value={v}>{v}</option>)}</select>
      <select aria-label="Language" className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2" value={language} onChange={e=>{setLanguage(e.target.value);setPage(1);setBatch(1);}}><option value="All">All languages</option>{languages.map(v=><option key={v} value={v}>{v === "EN" ? "EN — English" : v === "JP" ? "JP — Japanese" : v === "CN" ? "CN — Simplified Chinese" : v === "CN-TW" ? "CN-TW — Traditional Chinese" : v}</option>)}</select>
      <select aria-label="Set" className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 max-w-64" value={setFilter} onChange={e=>{setSetFilter(e.target.value);setPage(1);}}><option value="All">All sets</option>{sets.map(v=><option key={v}>{v}</option>)}</select>
    </div>
    {selectedMessage&&<p role="status" className="mt-5 text-emerald-400">{selectedMessage}</p>}
    {error&&<p role="alert" className="mt-5 text-amber-400">{error}</p>}
    <p className="mt-7 text-zinc-400">{loading?"Loading printings...":`Showing ${visible.length} of ${serverPaging&&serverTotal!==null?serverTotal:filtered.length} ${serverPaging?"matching":"loaded"} cards · Page ${page}${serverPaging&&serverPages!==null?` of ${serverPages}`:""}`}</p>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-5">{visible.map(c=><div key={identity(c)} className="rounded-2xl bg-zinc-950 border border-zinc-800 p-3 flex flex-col">
      <Artwork key={`${identity(c)}:${c.image_url || ""}`} card={c}/><h2 className="font-bold mt-3">{c.canonical_name||c.name}</h2>
      {c.canonical_name&&c.canonical_name!==c.name&&<p className="text-zinc-500 text-xs">{c.name}</p>}
      <p className="text-zinc-400 text-xs mt-1">{c.set_name||"Unknown set"} {c.card_number?`#${c.card_number}`:""}</p>
      <p className="text-zinc-600 text-xs mt-1">{c.category} {c.language?`· ${c.language}`:""} · {c.external_id}</p>
      <div className="mt-auto pt-4">{vendorMode?<><button type="button" onClick={()=>choose(c)} className="w-full rounded-lg bg-emerald-400 text-black font-bold py-2">Add to Inventory</button><Link href={cardHref(c)} target="_blank" rel="noopener noreferrer" className="block text-center text-zinc-400 hover:text-white text-xs mt-2">View Card</Link></>:<Link className="block text-center rounded-lg border border-emerald-400 text-emerald-400 font-bold py-2" href={cardHref(c)}>View Card</Link>}</div>
    </div>)}</div>
    {(pageCount>1||hasMore)&&<nav aria-label="Catalog pages" className="flex flex-wrap justify-center items-center gap-2 my-10"><button disabled={page===1||loading} onClick={()=>go(page-1)} className="border border-zinc-700 rounded-lg px-3 py-2 disabled:opacity-40">Previous</button>{Array.from({length:pageCount},(_,i)=>i+1).map(n=><button key={n} onClick={()=>go(n)} aria-current={n===page?"page":undefined} className={`rounded-lg px-4 py-2 border ${n===page?"bg-emerald-400 text-black border-emerald-400":"border-zinc-700"}`}>{n}</button>)}{hasMore&&!serverPaging&&<button disabled={loading} onClick={()=>go(totalLoadedPages+1)} className="border border-zinc-700 rounded-lg px-4 py-2">{totalLoadedPages+1}…</button>}<button disabled={loading||(page>=pageCount&&!hasMore)} onClick={()=>go(page+1)} className="border border-zinc-700 rounded-lg px-3 py-2 disabled:opacity-40">Next</button></nav>}
    {!loading&&!visible.length&&query.trim().length>=2&&!error&&<p className="text-zinc-500 mt-8">No matches in loaded results.</p>}
    <p className="text-zinc-600 text-xs mt-5">Pokémon language-specific searches use database pagination. Other catalog filters apply to loaded matches.</p>
  </div></main>;
}
export default function CatalogPage(){return <Suspense fallback={<main className="min-h-screen bg-black text-white p-8">Loading catalog...</main>}><Browser/></Suspense>;}
