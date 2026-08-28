import { NextResponse } from "next/server";

type ScryfallSet = {
  id?: string;
  code?: string;
  name?: string;
  released_at?: string;
  set_type?: string;
  card_count?: number;
  digital?: boolean;
};

type ScryfallList = {
  data?: ScryfallSet[];
};

export async function GET() {
  try {
    const response = await fetch(
      "https://api.scryfall.com/sets",
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "MintRadar/0.1",
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Scryfall sets failed (${response.status})`
      );
    }

    const payload: ScryfallList = await response.json();

    const results = (payload.data || [])
      .filter(
        (set) =>
          set.id &&
          set.code &&
          set.name &&
          !set.digital
      )
      .map((set) => ({
        // Use the set code in the URL because Scryfall's
        // card search can filter directly with set:<code>.
        id: set.code as string,
        name: set.name as string,
        category: "Magic: The Gathering" as const,
        code: String(set.code).toUpperCase(),
        cardCount:
          typeof set.card_count === "number"
            ? set.card_count
            : null,
        releasedAt: set.released_at || null,
        setType: set.set_type || null,
      }))
      .sort((a, b) => {
        const dateA = a.releasedAt || "";
        const dateB = b.releasedAt || "";

        if (dateA !== dateB) {
          return dateB.localeCompare(dateA);
        }

        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("MTG set catalog error:", error);

    return NextResponse.json(
      {
        error: "Magic set catalog is unavailable.",
        results: [],
      },
      { status: 500 }
    );
  }
}
