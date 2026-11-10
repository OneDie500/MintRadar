import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CatalogCard = {
  id: string;
  name: string | null;
  set_name: string | null;
  card_number: string | null;
  language: string | null;
  category: string | null;
  finish: string | null;
  variant: string | null;
  edition: string | null;
};

type ApiCard = {
  id?: number;
  name?: string | null;
  set_name?: string | null;
  number?: string | number | null;
  printing?: string | null;
  tcgplayer_id?: number | null;
  set?: { name?: string | null } | null;
};

const headers = { "Cache-Control": "private, no-store" };
function reply(reason: string, status = 400, diagnostics?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, reason, ...(diagnostics ? { diagnostics } : {}) }, { status, headers });
}
function name(s: string | null | undefined) {
  return (s || "").normalize("NFKC").toLowerCase().replace(/[‘’`´]/g, "'").replace(/\s+/g, " ").trim();
}
function setName(s: string | null | undefined) {
  return (s || "").normalize("NFKC").toLowerCase()
    .replace(/^\s*(?:sv\d+[a-z]?|swsh\d+[a-z]?|sm|xy|bw|dp|pl|hgss)\s*[:\-–]\s*/i, "")
    .replace(/^\s*(?:scarlet\s*&\s*violet|sword\s*&\s*shield|sun\s*&\s*moon)\s*[:\-–]\s*/i, "")
    .replace(/\s*&\s*/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
function number(s: string | number | null | undefined) {
  const first = String(s ?? "").normalize("NFKC").trim().split("/")[0].replace(/\s+/g, "").toUpperCase();
  const m = /^([A-Z]*)(\d+)([A-Z]*)$/.exec(first);
  return m ? `${m[1]}${Number(m[2])}${m[3]}` : first;
}
function print(s: string | null | undefined) {
  const v = (s || "").normalize("NFKC").toLowerCase().trim();
  if (!v) return "unknown";
  if (/master[\s-]*ball/.test(v)) return "master-ball";
  if (/pok[eé][\s-]*ball/.test(v)) return "poke-ball";
  if (/cosmos/.test(v)) return "cosmos";
  if (/etched/.test(v)) return "etched";
  if (/stamped/.test(v)) return "stamped";
  if (/parallel/.test(v)) return "parallel";
  if (/reverse/.test(v)) return "reverse";
  if (/non[\s-]?holo|non[\s-]?foil|normal|regular|standard/.test(v)) return "normal";
  if (/holo|foil/.test(v)) return "holo";
  return "unknown";
}
function catalogPrinting(card: CatalogCard) {
  const kinds = [card.finish, card.variant, card.edition]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(print)
    .filter(kind => kind !== "unknown");
  const unique = [...new Set(kinds)];
  return unique.length === 1 ? unique[0] : "unknown";
}
function identityMatches(card: CatalogCard, candidate: ApiCard) {
  const providerSet = candidate.set_name || candidate.set?.name;
  return Boolean(
    name(card.name) && name(card.name) === name(candidate.name) &&
    setName(card.set_name) && setName(card.set_name) === setName(providerSet) &&
    number(card.card_number) && number(card.card_number) === number(candidate.number)
  );
}
async function apiGet(path: string, apiKey: string): Promise<unknown> {
  const response = await fetch(`https://api.tcgapi.dev/v1/${path}`, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`TCG API HTTP ${response.status}`);
  const json: unknown = await response.json();
  if (!json || typeof json !== "object" || !("data" in json)) throw new Error("TCG API data missing");
  return (json as { data: unknown }).data;
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") return reply("Development-only endpoint.", 403);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.TCG_API_KEY;
  const allowlist = new Set((process.env.MINT_RADAR_CATALOG_APPROVER_IDS || "").split(",").map(s => s.trim()).filter(Boolean));
  if (!url || !anon || !service || !apiKey || !allowlist.size) return reply("Server approval configuration incomplete.", 503);

  const token = /^Bearer (.+)$/i.exec(req.headers.get("authorization") || "")?.[1];
  if (!token) return reply("Sign in required.", 401);
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await auth.auth.getUser(token);
  if (userError || !userData.user) return reply("Invalid session.", 401);
  if (!allowlist.has(userData.user.id)) return reply("Not authorized to approve catalog mappings.", 403);

  let body: unknown;
  try { body = await req.json(); } catch { return reply("Invalid JSON."); }
  if (!body || typeof body !== "object") return reply("Invalid request.");
  const input = body as Record<string, unknown>;
  if (typeof input.cardId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.cardId)
      || typeof input.tcgapiId !== "number" || !Number.isSafeInteger(input.tcgapiId) || input.tcgapiId <= 0) {
    return reply("Invalid card or provider ID.");
  }

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: cardData, error: cardError } = await db.from("cards")
    .select("id,name,set_name,card_number,language,category,finish,variant,edition")
    .eq("id", input.cardId).maybeSingle();
  if (cardError || !cardData) return reply("Catalog card not found.", 404);
  const card = cardData as CatalogCard;
  if (card.language?.toUpperCase() !== "EN" || card.category?.toLowerCase() !== "pokemon") {
    return reply("Only English Pokémon cards are supported in V5.");
  }
  const { data: existing, error: existingError } = await db.from("card_provider_links")
    .select("id,provider_product_id,match_status").eq("card_id", card.id).eq("provider", "tcgapi").maybeSingle();
  if (existingError) return reply("Could not inspect existing mappings.", 500);
  if (existing) return reply("A TCG API mapping already exists. V5 never overwrites mappings.", 409);

  let detail: ApiCard;
  let searchItems: ApiCard[];
  try {
    const qs = new URLSearchParams({ q: card.name || "", game: "pokemon", type: "Cards", per_page: "50", page: "1" });
    const [rawDetail, rawSearch] = await Promise.all([
      apiGet(`cards/${input.tcgapiId}`, apiKey),
      apiGet(`search?${qs.toString()}`, apiKey),
    ]);
    if (!rawDetail || typeof rawDetail !== "object" || Array.isArray(rawDetail)) return reply("Provider card detail has an unexpected shape.", 502);
    if (!Array.isArray(rawSearch)) return reply("Provider discovery returned an unexpected shape.", 502);
    detail = rawDetail as ApiCard;
    searchItems = rawSearch as ApiCard[];
  } catch (err) {
    console.error("[MintRadar V5 approval verification]", err instanceof Error ? err.message : err);
    return reply("TCG API verification failed or search limit reached. Nothing saved.", 502);
  }

  if (detail.id !== input.tcgapiId) return reply("Provider detail ID did not resolve exactly.", 422);
  if (!identityMatches(card, detail)) return reply("Individual-card identity verification failed. Nothing saved.", 422);

  // Search and detail must independently resolve to the same exact card ID and identity.
  const matching = searchItems.filter(c => c && c.id === input.tcgapiId && identityMatches(card, c));
  if (matching.length !== 1) {
    return reply("Could not find one exact matching discovery record. Nothing saved.", 422, {
      requestedProviderId: input.tcgapiId,
      exactDiscoveryMatches: matching.length,
      searchPageFull: searchItems.length >= 50,
    });
  }
  // A full first page means the discovery result may be incomplete.
  // Require manual investigation instead of approving from a truncated search.
  if (searchItems.length >= 50) {
    return reply("Discovery results may be incomplete (50 results). Nothing saved.", 422);
  }

  const discovery = matching[0];
  const catalogKind = catalogPrinting(card);
  const discoveryKind = print(discovery.printing);
  const detailKind = print(detail.printing);
  if (catalogKind === "unknown" || discoveryKind === "unknown" || catalogKind !== discoveryKind ||
      detailKind === "unknown" || detailKind !== discoveryKind) {
    return reply("Printing is missing or mismatched. No mapping saved.", 422, {
      catalogFinish: card.finish,
      catalogVariant: card.variant,
      catalogEdition: card.edition,
      discoveryPrinting: discovery.printing ?? null,
      detailPrinting: detail.printing ?? null,
      catalogKind, discoveryKind, detailKind,
    });
  }

  // Product IDs must agree across both independent API responses.
  if (!Number.isSafeInteger(detail.tcgplayer_id) || !detail.tcgplayer_id || detail.tcgplayer_id <= 0 ||
      !Number.isSafeInteger(discovery.tcgplayer_id) || !discovery.tcgplayer_id || discovery.tcgplayer_id <= 0 ||
      detail.tcgplayer_id !== discovery.tcgplayer_id) {
    return reply("TCGplayer product IDs are missing or disagree. No mapping saved.", 422, {
      detailTcgplayerId: detail.tcgplayer_id ?? null,
      discoveryTcgplayerId: discovery.tcgplayer_id ?? null,
    });
  }

  const apiSet = detail.set_name || detail.set?.name || "";
  const { error: writeError } = await db.from("card_provider_links").insert({
    card_id: card.id,
    provider: "tcgapi",
    provider_product_id: String(detail.id),
    product_url: `https://www.tcgplayer.com/product/${detail.tcgplayer_id}`,
    match_status: "verified",
    match_confidence: 1,
    matched_name: detail.name,
    matched_set_name: apiSet,
    matched_card_number: String(detail.number ?? ""),
  });
  if (writeError) return reply(writeError.code === "23505" ? "Mapping already exists; no overwrite." : "Database insert failed.", writeError.code === "23505" ? 409 : 500);
  return NextResponse.json({ ok: true, cardId: card.id, tcgapiId: detail.id, tcgplayerId: detail.tcgplayer_id, verifiedPrinting: discovery.printing }, { headers });
}
