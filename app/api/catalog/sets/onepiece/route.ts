import { NextResponse } from "next/server";

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

export async function GET() {
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

    return NextResponse.json({
      count: results.length,
      results,
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
