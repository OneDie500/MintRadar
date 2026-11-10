import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PriceRow = {
  printing?: string;
  market_price?: number | null;
  low_price?: number | null;
  market_price_as_of?: string | null;
  last_updated_at?: string | null;
};
type ApiCard = { id?: number; image_url?: string | null };
const cache = new Map<string, { until: number; value: Record<string, unknown> }>();
const TTL = 12 * 60 * 60 * 1000;

function respond(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}
function cleanPrint(value: string): "foil" | "normal" | null {
  const v = value.toLowerCase().trim();
  if (!v) return null;
  if (/reverse|etched|cosmos|master ball|pok[eé] ball|parallel/.test(v)) return null;
  if (/non.?holo|non.?foil|normal|regular|standard/.test(v)) return "normal";
  if (/holo|foil/.test(v)) return "foil";
  return null;
}
async function apiGet(path: string, key: string): Promise<unknown> {
  const response = await fetch(`https://api.tcgapi.dev/v1/${path}`, {
    headers: { "X-API-Key": key },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`TCG API returned ${response.status}`);
  const payload = await response.json();
  return payload && typeof payload === "object" && "data" in payload ? payload.data : null;
}

export async function GET(request: NextRequest) {
  // Free TCG API plan is for development evaluation; never expose its data in production.
  if (process.env.NODE_ENV !== "development") {
    return respond({ ok: false, reason: "Market preview disabled outside local development." }, 403);
  }
  const key = process.env.TCG_API_KEY;
  if (!key) return respond({ ok: false, reason: "TCG_API_KEY is missing." }, 503);
  // Explicit opt-in discovery: one request, no automatic writes or price display.
  if (request.nextUrl.searchParams.get("mode") === "discover") {
    const name = (request.nextUrl.searchParams.get("name") || "").trim().slice(0, 100);
    const setName = (request.nextUrl.searchParams.get("setName") || "").trim();
    const number = (request.nextUrl.searchParams.get("cardNumber") || "").trim();
    const language = (request.nextUrl.searchParams.get("language") || "").trim().toUpperCase();
    const category = (request.nextUrl.searchParams.get("category") || "").trim().toLowerCase();
    if (name.length < 2) return respond({ ok: false, reason: "Card name required." }, 400);
    if (language && language !== "EN") return respond({ ok: false, reason: "Non-English identities require a separate language-specific review." });
    if (category && category !== "pokemon") return respond({ ok: false, reason: "This first discovery test supports Pokemon only." });
    const cacheKey = `discover:${name}:${setName}:${number}:${language}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.until > Date.now()) return respond(cached.value);
    try {
      const qs = new URLSearchParams({ q: name, game: "pokemon", type: "Cards", per_page: "50", page: "1" });
      const data = await apiGet(`search?${qs.toString()}`, key);
      type Candidate = { id?: number; name?: string; number?: string | number | null; set_name?: string | null; game_slug?: string | null; game_name?: string | null; tcgplayer_id?: number | null; tcgplayer_url?: string | null; image_url?: string | null; printing?: string | null };
      const items = Array.isArray(data) ? data as Candidate[] : [];
      const normalize = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
      const normalizedName = normalize(name);
      const normalizedSet = normalize(setName);
      const normalizedNumber = number.replace(/^0+/, "").toLowerCase();
      const candidates = items.filter(c => Number.isSafeInteger(c.id) && normalize(c.name || "") === normalizedName)
        .map(c => {
          const sameSet = Boolean(normalizedSet) && normalize(c.set_name || "") === normalizedSet;
          const sameNumber = Boolean(normalizedNumber) && String(c.number ?? "").replace(/^0+/, "").toLowerCase() === normalizedNumber;
          const confidence = sameSet && sameNumber ? 1 : sameSet || sameNumber ? 0.65 : 0.25;
          return {
            id: c.id, name: c.name || "", set_name: c.set_name || "", number: String(c.number ?? ""),
            printing: c.printing || null, image_url: c.image_url || null,
            tcgplayer_id: c.tcgplayer_id || null,
            product_url: c.tcgplayer_url && /^https:\/\//.test(c.tcgplayer_url) ? c.tcgplayer_url : null,
            same_set: sameSet, same_number: sameNumber, confidence,
            review_required: true,
          };
        }).sort((a,b) => b.confidence - a.confidence).slice(0, 15);
      const result: Record<string, unknown> = { ok: true, candidates, incomplete: items.length >= 50,
        reason: candidates.length ? "Candidates are unverified. Confirm the exact promotional release and artwork before saving any provider mapping." : "No exact-name candidates on the first search page. No mapping was created." };
      cache.set(cacheKey, { until: Date.now() + TTL, value: result });
      return respond(result);
    } catch (err) {
      console.error("[MintRadar identity discovery]", err instanceof Error ? err.message : err);
      return respond({ ok: false, reason: "TCG API search failed or daily limit reached." }, 502);
    }
  }
  const externalId = request.nextUrl.searchParams.get("externalId") || "";
  const match = /^(tcgapi|tcgplayer)-(\d{1,12})$/i.exec(externalId);
  if (!match) {
    // Never treat a TCGdex ID as a TCG API ID or invent a provider mapping.
    // This endpoint intentionally does not save or auto-approve search results.
    return respond({
      ok: false,
      reason: "No verified TCG API or TCGplayer mapping saved for this card. Exact provider matching is required before showing a market price.",
      identity: {
        name: request.nextUrl.searchParams.get("name") || null,
        set_name: request.nextUrl.searchParams.get("setName") || null,
        card_number: request.nextUrl.searchParams.get("cardNumber") || null,
        language: request.nextUrl.searchParams.get("language") || null,
      },
    });
  }
  const finish = request.nextUrl.searchParams.get("finish") || "";
  const variant = request.nextUrl.searchParams.get("variant") || "";
  const requestedPrint = cleanPrint(finish) || cleanPrint(variant);
  const cacheKey = [externalId, requestedPrint || ""].join(":");
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) return respond(cached.value);

  try {
    const id = match[2];
    let cardId = id;
    let imageUrl: string | null = null;
    if (match[1].toLowerCase() === "tcgplayer") {
      const card = (await apiGet(`cards/tcgplayer/${id}`, key)) as ApiCard | null;
      if (!card || !Number.isSafeInteger(card.id)) return respond({ ok: false, reason: "TCGplayer ID did not resolve to an exact card." });
      cardId = String(card.id);
      imageUrl = typeof card.image_url === "string" ? card.image_url : null;
    }
    const raw = await apiGet(`cards/${cardId}/prices`, key);
    const prices: PriceRow[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw as PriceRow] : [];
    const valid = prices.filter((p) => typeof p.market_price === "number" && Number.isFinite(p.market_price) && p.market_price >= 0);
    let selected: PriceRow | undefined;
    if (requestedPrint) selected = valid.find((p) => cleanPrint(p.printing || "") === requestedPrint);
    else if (valid.length === 1) selected = valid[0];
    // Never guess when several printings exist and the catalog lacks a specific printing.
    const result: Record<string, unknown> = selected
      ? { ok: true, market_price: selected.market_price, low_price: selected.low_price ?? null, printing: selected.printing ?? null, market_price_as_of: selected.market_price_as_of ?? null, last_updated_at: selected.last_updated_at ?? null, image_url: imageUrl }
      : { ok: false, reason: valid.length > 1 ? "Multiple printings available; exact Normal/Foil match required." : "No market price available for the matching printing." };
    cache.set(cacheKey, { until: Date.now() + TTL, value: result });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return respond(result);
  } catch (err) {
    console.error("[MintRadar market preview]", err instanceof Error ? err.message : err);
    return respond({ ok: false, reason: "Pricing lookup failed or API limit reached." }, 502);
  }
}
