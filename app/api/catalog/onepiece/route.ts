import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OPTCGCard = {
  id?: number | string;
  card_id?: string;
  card_name?: string;
  card_set_id?: string;
  card_set_name?: string;
  set_name?: string;
  set_id?: string;
  card_rarity?: string;
  card_image?: string;
  card_image_id?: string;
  card_type?: string;
  card_color?: string;
  card_text?: string;
  sub_types?: string | string[];
  card_attribute?: string;
  attribute?: string;
  market_price?: number | string | null;
};

const CATALOG_URL = "https://optcgapi.com/api/allSetCards/";
const PAGE_SIZE = 20;

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown): string {
  return normalize(value).replace(/\s+/g, "");
}

function words(value: unknown): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

function cardNumber(card: OPTCGCard): string {
  return String(card.card_set_id || card.card_id || "");
}

function setName(card: OPTCGCard): string {
  return String(card.card_set_name || card.set_name || "");
}

function getVariant(name: string, imageId: string | null): string | null {
  const value = normalize(name);

  if (value.includes("pirate foil")) return "Pirate Foil";
  if (value.includes("reprint")) return "Reprint";
  if (value.includes("manga")) return "Manga";
  if (value.includes("alternate art") || value.includes("parallel")) {
    return "Alternate Art";
  }
  if (/\bsp\b/.test(value) || value.includes("special version")) return "SP";
  if (value.includes("gold")) return "Gold";
  if (imageId && /_p\d+(?:_|$)/i.test(imageId)) return "Alternate Art";
  return null;
}

function createExternalId(card: OPTCGCard, index: number): string {
  if (card.id !== undefined && card.id !== null && card.id !== "") {
    return `optcg-${card.id}`;
  }

  const raw = [
    card.card_set_id,
    card.card_image_id,
    card.card_name,
    card.card_rarity,
  ]
    .filter(Boolean)
    .join("-");

  const slug = normalize(raw).replace(/\s+/g, "-");
  return slug ? `optcg-${slug}` : `optcg-card-${index}`;
}

function normalizedCard(card: OPTCGCard, index: number) {
  const name = card.card_name || "Unknown One Piece Card";
  return {
    external_id: createExternalId(card, index),
    data_source: "optcgapi",
    name,
    set_name: setName(card) || null,
    set_id: card.set_id || null,
    card_number: cardNumber(card) || null,
    image_url: card.card_image || null,
    category: "One Piece",
    rarity: card.card_rarity || null,
    edition: null,
    finish: getVariant(name, card.card_image_id || null),
    illustrator: null,
  };
}

/**
 * A query can contain a card name, a set name, a card number, and/or a
 * variant. Every meaningful query word must match the SAME card record.
 * This prevents "Crocodile The Azure Sea's Seven" from falling back to
 * unrelated Crocodile cards in other sets.
 */
function scoreCard(card: OPTCGCard, query: string): number {
  const q = normalize(query);
  if (!q) return 0;

  const name = normalize(card.card_name);
  const set = normalize(setName(card));
  const number = normalize(cardNumber(card));
  const variant = normalize(getVariant(card.card_name || "", card.card_image_id || null));
  const subtype = normalize(
    Array.isArray(card.sub_types) ? card.sub_types.join(" ") : card.sub_types
  );
  const fields = [
    name,
    set,
    number,
    variant,
    normalize(card.card_rarity),
    normalize(card.card_type),
    normalize(card.card_color),
    normalize(card.card_text),
    subtype,
    normalize(card.card_attribute),
    normalize(card.attribute),
  ].filter(Boolean);

  const qCompact = compact(q);
  const numberCompact = compact(number);
  const nameCompact = compact(name);
  const setCompact = compact(set);
  const variantCompact = compact(variant);

  if (numberCompact && qCompact === numberCompact) return 1200;
  if (name && q === name) return 1100;
  if (set && q === set) return 1050;
  if (variant && q === variant) return 1000;

  // Support combined queries in either order, with or without punctuation.
  // Each token must belong to the same record; no name-only fallback.
  const queryWords = words(q);
  const fieldWords = fields.map(words);
  const allWordsMatch = queryWords.every((word) =>
    fieldWords.some((field) =>
      field.some((candidate) => candidate === word || candidate.startsWith(word))
    )
  );

  // Card numbers such as OP14-120 are often typed with or without hyphens.
  // If the query contains a code-like token, it must match the actual number.
  const queryCodeMatches = query.match(/\b(?:op|eb|st|p)\s*\d{1,3}\s*\d{2,3}\b/gi) || [];
  if (
    queryCodeMatches.length > 0 &&
    !queryCodeMatches.every((code) => numberCompact.includes(compact(code)))
  ) {
    return 0;
  }

  // Full phrase matches allow partial names or set names, but not generic
  // matches that ignore the rest of a specific query.
  const phraseMatch = fields.some((field) => field.includes(q));
  const compactPhraseMatch = fields.some((field) => compact(field).includes(qCompact));
  if (!allWordsMatch && !phraseMatch && !compactPhraseMatch) return 0;

  const nameMatches = queryWords.filter((word) =>
    words(name).some((candidate) => candidate === word || candidate.startsWith(word))
  ).length;
  const setMatches = queryWords.filter((word) =>
    words(set).some((candidate) => candidate === word || candidate.startsWith(word))
  ).length;
  const numberMatches = queryWords.filter((word) =>
    words(number).some((candidate) => candidate === word || candidate.startsWith(word))
  ).length;
  const variantMatches = queryWords.filter((word) =>
    words(variant).some((candidate) => candidate === word || candidate.startsWith(word))
  ).length;

  let score = 250 + nameMatches * 35 + setMatches * 25 + numberMatches * 45 + variantMatches * 30;
  if (phraseMatch) score += 150;
  if (compactPhraseMatch) score += 100;
  if (nameCompact && qCompact.includes(nameCompact)) score += 80;
  if (setCompact && qCompact.includes(setCompact)) score += 70;
  if (numberCompact && qCompact.includes(numberCompact)) score += 110;
  if (variantCompact && qCompact.includes(variantCompact)) score += 45;
  return score;
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() || "";
    const requestedPage = Number(request.nextUrl.searchParams.get("page") || "1");
    const page = Number.isFinite(requestedPage) && requestedPage > 0
      ? Math.floor(requestedPage)
      : 1;

    if (!query) {
      return NextResponse.json(
        { error: "Search query is required.", results: [] },
        { status: 400 }
      );
    }

    const response = await fetch(CATALOG_URL, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "MintRadar/0.1",
      },
    });

    if (!response.ok) {
      console.error("OPTCG API error:", response.status);
      return NextResponse.json(
        { error: "One Piece catalog search failed.", results: [] },
        { status: response.status }
      );
    }

    const data = await response.json();
    const cards: OPTCGCard[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.results)
          ? data.results
          : [];

    const matches = cards
      .map((card, index) => ({ card, index, score: scoreCard(card, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const results = matches.slice(start, end).map(({ card, index }) =>
      normalizedCard(card, index)
    );

    return NextResponse.json({
      query,
      page,
      pageSize: PAGE_SIZE,
      count: results.length,
      total: matches.length,
      hasMore: end < matches.length,
      results,
    });
  } catch (error) {
    console.error("MintRadar One Piece catalog error:", error);
    return NextResponse.json(
      {
        error: "Something went wrong while searching the One Piece catalog.",
        results: [],
      },
      { status: 500 }
    );
  }
}
