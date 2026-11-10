import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Candidate = {
  id?: number;
  name?: string;
  number?: string | number | null;
  set_name?: string | null;
  tcgplayer_id?: number | null;
  tcgplayer_url?: string | null;
  image_url?: string | null;
  printing?: string | null;
};

type DiscoveryResult = Record<string, unknown>;
const cache = new Map<string, { until: number; value: DiscoveryResult }>();
const TTL = 12 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

function respond(data: DiscoveryResult, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

function normalizeNumber(value: string) {
  return value.trim().replace(/^0+/, "").toLowerCase();
}

async function apiGet(path: string, key: string): Promise<unknown> {
  const response = await fetch(`https://api.tcgapi.dev/v1/${path}`, {
    headers: { "X-API-Key": key },
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`TCG API returned ${response.status}`);
  }

  const payload: unknown = await response.json();
  return payload && typeof payload === "object" && "data" in payload
    ? (payload as { data: unknown }).data
    : null;
}

export async function GET(request: NextRequest) {
  // Development evaluation only. Do not expose TCG API results in production.
  if (process.env.NODE_ENV !== "development") {
    return respond(
      { ok: false, reason: "TCG API preview is disabled outside local development." },
      403
    );
  }

  const params = request.nextUrl.searchParams;
  const mode = params.get("mode");

  // Pricing must never be authorized by a browser-supplied provider ID.
  // Use /api/catalog/verified-market?card_id=<catalog UUID> instead.
  if (mode !== "discover") {
    return respond({
      ok: false,
      reason:
        "Direct provider-ID pricing is disabled. Use the verified-market endpoint with a catalog card ID.",
    });
  }

  const key = process.env.TCG_API_KEY;
  if (!key) {
    return respond({ ok: false, reason: "TCG_API_KEY is missing." }, 503);
  }

  const name = (params.get("name") || "").trim().slice(0, 100);
  const setName = (params.get("setName") || "").trim().slice(0, 160);
  const number = (params.get("cardNumber") || "").trim().slice(0, 60);
  const language = (params.get("language") || "").trim().toUpperCase();
  const category = (params.get("category") || "").trim().toLowerCase();

  if (name.length < 2) {
    return respond({ ok: false, reason: "Card name required." }, 400);
  }
  if (language && language !== "EN") {
    return respond({
      ok: false,
      reason: "Non-English identities require a separate language-specific review.",
    });
  }
  if (category && category !== "pokemon") {
    return respond({
      ok: false,
      reason: "This discovery test supports Pokémon only.",
    });
  }

  const cacheKey = JSON.stringify([
    normalize(name),
    normalize(setName),
    normalizeNumber(number),
    language,
    category,
  ]);
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) {
    return respond(cached.value);
  }

  try {
    const qs = new URLSearchParams({
      q: name,
      game: "pokemon",
      type: "Cards",
      per_page: "50",
      page: "1",
    });
    const raw = await apiGet(`search?${qs.toString()}`, key);
    const items: Candidate[] = Array.isArray(raw) ? (raw as Candidate[]) : [];
    const normalizedName = normalize(name);
    const normalizedSet = normalize(setName);
    const normalizedNumber = normalizeNumber(number);

    const candidates = items
      .filter(
        (candidate) =>
          typeof candidate.id === "number" &&
          Number.isSafeInteger(candidate.id) &&
          candidate.id > 0 &&
          normalize(candidate.name || "") === normalizedName
      )
      .map((candidate) => {
        const sameSet =
          Boolean(normalizedSet) &&
          normalize(candidate.set_name || "") === normalizedSet;
        const sameNumber =
          Boolean(normalizedNumber) &&
          normalizeNumber(String(candidate.number ?? "")) === normalizedNumber;
        const confidence = sameSet && sameNumber ? 1 : sameSet || sameNumber ? 0.65 : 0.25;

        return {
          id: candidate.id,
          name: candidate.name || "",
          set_name: candidate.set_name || "",
          number: String(candidate.number ?? ""),
          printing: candidate.printing || null,
          image_url: candidate.image_url || null,
          tcgplayer_id: candidate.tcgplayer_id || null,
          product_url:
            typeof candidate.tcgplayer_url === "string" &&
            /^https:\/\//i.test(candidate.tcgplayer_url)
              ? candidate.tcgplayer_url
              : null,
          same_set: sameSet,
          same_number: sameNumber,
          confidence,
          review_required: true,
        };
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 15);

    const result: DiscoveryResult = {
      ok: true,
      candidates,
      incomplete: items.length >= 50,
      reason: candidates.length
        ? "Candidates are unverified. Confirm exact set, number, printing, artwork, and promotional release before saving a provider mapping."
        : "No exact-name candidates on the first search page. No mapping was created.",
    };

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(cacheKey, { until: Date.now() + TTL, value: result });
    return respond(result);
  } catch (error) {
    console.error(
      "[MintRadar identity discovery]",
      error instanceof Error ? error.message : error
    );
    return respond(
      { ok: false, reason: "TCG API search failed or daily limit reached." },
      502
    );
  }
}
