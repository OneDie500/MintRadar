import { NextRequest, NextResponse } from "next/server";

type UnknownRecord = Record<string, unknown>;

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "MintRadar/0.1",
};

function textValue(
  record: UnknownRecord,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function numberValue(
  record: UnknownRecord,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = record[key];

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return value;
    }

    if (
      typeof value === "string" &&
      value.trim() &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const languageFilter = request.nextUrl.searchParams.get("language")?.toUpperCase();
  if (languageFilter === "JP") {
    return loadJapaneseSetIndex();
  }

  try {
    // Fetch the set list AND the complete set-card catalog.
    // The set-list response often does not include a usable
    // card count, so MintRadar calculates it from the cards.
    const [setsResponse, cardsResponse] =
      await Promise.all([
        fetch(
          "https://www.optcgapi.com/api/allSets/",
          {
            cache: "no-store",
            headers: HEADERS,
          }
        ),
        fetch(
          "https://www.optcgapi.com/api/allSetCards/",
          {
            cache: "no-store",
            headers: HEADERS,
          }
        ),
      ]);

    if (!setsResponse.ok) {
      throw new Error(
        `OPTCG sets failed (${setsResponse.status})`
      );
    }

    if (!cardsResponse.ok) {
      throw new Error(
        `OPTCG cards failed (${cardsResponse.status})`
      );
    }

    const setsPayload =
      await setsResponse.json();

    const cardsPayload =
      await cardsResponse.json();

    const rawSets: UnknownRecord[] =
      extractArray(setsPayload);

    const rawCards: UnknownRecord[] =
      extractArray(cardsPayload);

    // Count every printing returned by allSetCards.
    // We normalize OP-01 and OP01-001 to the same
    // key ("OP01") before tallying.
    const cardCounts =
      new Map<string, number>();

    rawCards.forEach((card) => {
      const rawCardSetId =
        textValue(card, [
          "card_set_id",
          "cardSetId",
          "card_id",
          "cardId",
        ]) || "";

      const setKey =
        onePieceSetKey(rawCardSetId);

      if (!setKey) {
        return;
      }

      cardCounts.set(
        setKey,
        (cardCounts.get(setKey) || 0) + 1
      );
    });

    const unique = new Map<
      string,
      {
        id: string;
        name: string;
        category: "One Piece";
        code: string | null;
        cardCount: number | null;
        releasedAt: string | null;
        setType: string | null;
        language: "EN" | "JP";
      }
    >();

    rawSets.forEach((rawSet) => {
      const id =
        textValue(rawSet, [
          "set_id",
          "setId",
          "id",
          "code",
          "set_code",
          "setCode",
        ]) || null;

      const name =
        textValue(rawSet, [
          "set_name",
          "setName",
          "name",
          "title",
        ]) || null;

      if (!id || !name) {
        return;
      }

      const code =
        textValue(rawSet, [
          "set_id",
          "setId",
          "code",
          "set_code",
          "setCode",
        ]) || id;

      const providerCardCount =
        numberValue(rawSet, [
          "card_count",
          "cardCount",
          "total_cards",
          "totalCards",
          "cards",
        ]);

      const calculatedCardCount =
        cardCounts.get(
          onePieceSetKey(code || id)
        ) ?? null;

      const releasedAt =
        textValue(rawSet, [
          "release_date",
          "releaseDate",
          "released_at",
          "releasedAt",
        ]);

      unique.set(id, {
        id,
        name,
        category: "One Piece",
        code,
        cardCount:
          calculatedCardCount ??
          providerCardCount,
        releasedAt,
        setType: null,
        language: "EN",
      });
    });

    const results =
      Array.from(unique.values()).sort(
        (a, b) => {
          const codeCompare = String(
            a.code || ""
          ).localeCompare(
            String(b.code || ""),
            undefined,
            { numeric: true }
          );

          if (codeCompare !== 0) {
            return codeCompare;
          }

          return a.name.localeCompare(
            b.name
          );
        }
      );

    if (languageFilter === "EN") {
      return NextResponse.json({ count: results.length, results });
    }

    // A Japanese provider outage must never remove working English sets.
    let japanese: JapaneseSetOption[] = [];
    try {
      japanese = await discoverJapaneseSets();
    } catch (error) {
      console.warn("Japanese One Piece set discovery unavailable:", error);
    }

    return NextResponse.json({
      count: results.length + japanese.length,
      results: [...results, ...japanese],
    });
  } catch (error) {
    console.error(
      "One Piece set catalog error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "One Piece set catalog is unavailable.",
        results: [],
      },
      { status: 500 }
    );
  }
}

function extractArray(
  payload: unknown
): UnknownRecord[] {
  if (Array.isArray(payload)) {
    return payload as UnknownRecord[];
  }

  if (
    payload &&
    typeof payload === "object"
  ) {
    const record =
      payload as UnknownRecord;

    for (const key of [
      "results",
      "data",
      "sets",
      "cards",
    ]) {
      const value = record[key];

      if (Array.isArray(value)) {
        return value as UnknownRecord[];
      }
    }
  }

  return [];
}

function onePieceSetKey(
  value: string
): string {
  const compact = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  // Examples:
  // OP-01    -> OP01
  // OP01-001 -> OP01
  // EB-01    -> EB01
  // EB01-015 -> EB01
  // PRB-01   -> PRB01
  // PRB01-001 -> PRB01
  const match =
    compact.match(/^([A-Z]+)(\d{2})/);

  return match
    ? `${match[1]}${match[2]}`
    : compact;
}

// =========================================================
// JAPANESE ONE PIECE / VERIFIED PUNK RECORDS PACK DISCOVERY
// =========================================================
// The upstream Japanese packs.json is currently empty. The published numeric
// card-pack files are usable, but pack numbers are not trusted as set IDs.
// We only publish a set when its actual card IDs confirm its identity.
// Each candidate is cached by Next.js for one hour.
// IMPORTANT: This is a catalog discovery layer, not an image license.

type JapaneseSetOption = {
  id: string;
  name: string;
  category: "One Piece";
  code: string;
  cardCount: number;
  releasedAt: null;
  setType: null;
  language: "JP";
};

type JapanesePackCard = {
  id?: string;
  pack_id?: string;
  name?: string;
};

// Pack families currently published by Punk Records. Never assume the numeric
// ID identifies a set without inspecting the cards inside it.
const JAPANESE_PACK_IDS: string[] = [
  ...Array.from({ length: 36 }, (_, i) => String(550001 + i)),
  ...Array.from({ length: 17 }, (_, i) => String(550101 + i)),
  ...Array.from({ length: 4 }, (_, i) => String(550201 + i)),
  ...Array.from({ length: 2 }, (_, i) => String(550301 + i)),
  "550701", "550801", "550901",
];

const JP_SET_ID = /^(ST|OP|EB|PRB)\d{2}$/;

async function discoverJapaneseSets(): Promise<JapaneseSetOption[]> {
  // Batch requests to avoid overwhelming the dataset host.
  const discovered = new Map<string, JapaneseSetOption>();
  for (let offset = 0; offset < JAPANESE_PACK_IDS.length; offset += 10) {
    const batch = JAPANESE_PACK_IDS.slice(offset, offset + 10);
    const found = await Promise.all(batch.map(async (packId) => {
      try {
        const response = await fetch(
          `https://raw.githubusercontent.com/buhbbl/punk-records/main/japanese/data/${packId}.json`,
          { next: { revalidate: 3600 }, headers: HEADERS }
        );
        if (!response.ok) return null;
        const raw: unknown = await response.json();
        if (!Array.isArray(raw)) return null;
        const cards = raw as JapanesePackCard[];
        const counts = new Map<string, number>();
        for (const card of cards) {
          const match = String(card.id || "").toUpperCase().match(/^([A-Z]+\d{2})-\d{3}/);
          if (!match || !JP_SET_ID.test(match[1])) continue;
          counts.set(match[1], (counts.get(match[1]) || 0) + 1);
        }
        // A pack with multiple card-number families can be a promotional or
        // reprint collection; do not mislabel it as a normal expansion.
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        if (sorted.length !== 1 || sorted[0][1] < 5) return null;
        const [code, cardCount] = sorted[0];
        return { id: code, name: code, category: "One Piece" as const,
          code, cardCount, releasedAt: null, setType: null,
          language: "JP" as const };
      } catch {
        return null;
      }
    }));
    for (const set of found) {
      if (!set) continue;
      // Multiple packs may contain the same set. Use the largest verified
      // card count rather than silently summing duplicate printings.
      const previous = discovered.get(set.id);
      if (!previous || set.cardCount > previous.cardCount) {
        discovered.set(set.id, set);
      }
    }
  }
  return [...discovered.values()].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true })
  );
}

async function loadJapaneseSetIndex() {
  try {
    const results = await discoverJapaneseSets();
    return NextResponse.json({ count: results.length, results });
  } catch (error) {
    console.error("Japanese One Piece set discovery failed:", error);
    return NextResponse.json({
      error: "Japanese One Piece set discovery is unavailable.",
      count: 0,
      results: [],
    }, { status: 502 });
  }
}
