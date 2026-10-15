import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only Japanese artwork lookup. Install at:
// app/api/catalog/onepiece-jp-image/route.ts
// Does not write to inventory, the catalog, or the English fallback.
const OFFICIAL_ORIGIN = "https://www.onepiece-cardgame.com";
const CARD_ID = /^(?:[A-Z]{2}\d{2}-\d{3}|P-\d{3})$/;

type Candidate = { imageUrl: string; artworkId: string; parallel: boolean };

// Narrow, visually verified printing identities. These are NOT a general p1 rule.
// Keep unknown multi-parallel printings ambiguous until release metadata identifies them.
const VERIFIED_PRINTINGS: ReadonlyArray<{
  cardNumber: string;
  setName: string;
  artworkId: string;
}> = [
  { cardNumber: "OP05-007", setName: "prb01", artworkId: "OP05-007_p1" },
  { cardNumber: "OP15-118", setName: "adventureonkamisisland", artworkId: "OP15-118_p1" },
];

function normalizedSet(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function officialCardImage(value: string, cardNumber: string): Candidate | null {
  try {
    const url = new URL(decodeEntities(value), OFFICIAL_ORIGIN);
    if (url.protocol !== "https:" || url.hostname !== "www.onepiece-cardgame.com") return null;
    if (!url.pathname.startsWith("/images/cardlist/card/")) return null;
    const filename = decodeURIComponent(url.pathname.split("/").pop() || "");
    const pattern = new RegExp(`^(${cardNumber})(?:_(p[1-9][0-9]*))?\\.(?:png|jpe?g|webp)$`, "i");
    const match = filename.match(pattern);
    if (!match) return null;
    return {
      imageUrl: url.href,
      artworkId: `${cardNumber}${match[2] ? `_${match[2].toLowerCase()}` : ""}`,
      parallel: Boolean(match[2]),
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const cardNumber = (params.get("cardNumber") || "").trim().toUpperCase();
  const variant = [params.get("name"), params.get("variant"), params.get("finish")].filter(Boolean).join(" ");
  const onePieceDayLuffy = cardNumber === "P-041" && /one\s*piece\s*day/i.test(variant);
  const requestedParallel = onePieceDayLuffy || /^(1|true|yes)$/i.test(params.get("parallel") || "") ||
    /parallel|alternate[ -]?art|alt[ -]?art|パラレル|_p\d+\b/i.test(variant);
  const debug = /^(1|true|yes)$/i.test(params.get("debug") || "");
  const setName = params.get("setName") || "";
  // Optional exact artwork ID for future catalog records that know their printing.
  const explicitArtworkId = (params.get("artworkId") || "").trim();

  if (!CARD_ID.test(cardNumber)) {
    return NextResponse.json({ ok: false, imageUrl: null, reason: "invalid-card-number", examples: ["EB04-036", "P-041"] }, { status: 400 });
  }

  const officialUrl = new URL("/cardlist/", OFFICIAL_ORIGIN);
  officialUrl.searchParams.set("freewords", cardNumber);
  officialUrl.searchParams.set("search", "true");

  try {
    const response = await fetch(officialUrl.href, {
      headers: { Accept: "text/html", "User-Agent": "MintRadar/0.1 (Japanese artwork lookup)" },
      signal: AbortSignal.timeout(12000),
      next: { revalidate: 3600 },
    });
    if (!response.ok) {
      return NextResponse.json({ ok: false, imageUrl: null, reason: "official-site-unavailable", upstreamStatus: response.status });
    }

    const html = await response.text();
    // Read only image paths from Bandai's card artwork directory. Never choose
    // generic site icons or nearby unrelated images from a search-result page.
    const imagePattern = /(?:https?:\/\/www\.onepiece-cardgame\.com)?\/images\/cardlist\/card\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)(?:\?[^\s"'<>]*)?/gi;
    const byArtworkId = new Map<string, Candidate[]>();
    for (const match of html.matchAll(imagePattern)) {
      const candidate = officialCardImage(match[0], cardNumber);
      if (!candidate) continue;
      const group = byArtworkId.get(candidate.artworkId) || [];
      if (!group.some((entry) => entry.imageUrl === candidate.imageUrl)) group.push(candidate);
      byArtworkId.set(candidate.artworkId, group);
    }

    const allCandidates = [...byArtworkId.values()].flat();
    const eligible = allCandidates.filter((entry) => entry.parallel === requestedParallel);
    // Multiple alternate-art printings can exist. Never silently choose p1
    // when p2/p3 are also listed, or choose between conflicting URLs.
    let selected: Candidate | null = eligible.length === 1 ? eligible[0] : null;
    let selectionRule = "exact-card-number-and-parallel-variant; unique-image-required";

    if (!selected && eligible.length > 1 && onePieceDayLuffy) {
      const matches = eligible.filter((item) => item.artworkId === "P-041_p3");
      if (matches.length === 1) {
        selected = matches[0];
        selectionRule = "visually-verified-one-piece-day-printing";
      }
    }

    if (!selected && eligible.length > 1 && explicitArtworkId) {
      const matches = eligible.filter((item) =>
        item.artworkId.toLowerCase() === explicitArtworkId.toLowerCase()
      );
      if (matches.length === 1) {
        selected = matches[0];
        selectionRule = "explicit-artwork-id";
      }
    }

    if (!selected && eligible.length > 1 && requestedParallel && setName) {
      const setKey = normalizedSet(setName);
      const verified = VERIFIED_PRINTINGS.find((item) =>
        item.cardNumber === cardNumber && setKey.includes(item.setName)
      );
      if (verified) {
        const matches = eligible.filter((item) => item.artworkId === verified.artworkId);
        if (matches.length === 1) {
          selected = matches[0];
          selectionRule = "visually-verified-printing";
        }
      }
    }

    const reason = selected ? null : eligible.length > 1 ? "ambiguous-artwork" : "exact-artwork-not-found";

    return NextResponse.json({
      ok: Boolean(selected),
      imageUrl: selected?.imageUrl || null,
      provider: "bandai-official-jp-cardlist",
      imageLanguage: selected ? "JP" : null,
      cardNumber,
      requestedParallel,
      artworkId: selected?.artworkId || null,
      selectionRule,
      ...(reason ? { reason } : {}),
      ...(debug ? {
        diagnostic: true,
        officialUrl: officialUrl.href,
        candidates: allCandidates,
        matchingCandidates: eligible,
        requestedSet: setName,
      } : {}),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false, imageUrl: null, reason: "official-site-request-failed",
      ...(debug ? { detail: error instanceof Error ? error.message : "unknown" } : {}),
    });
  }
}
