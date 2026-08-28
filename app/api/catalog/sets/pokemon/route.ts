import { NextResponse } from "next/server";

type TCGdexSet = {
  id?: string;
  name?: string;
  cardCount?: {
    total?: number;
    official?: number;
  };
};

export async function GET() {
  try {
    const params = new URLSearchParams();
    params.set("pagination:page", "1");
    params.set("pagination:itemsPerPage", "500");

    const response = await fetch(
      `https://api.tcgdex.net/v2/en/sets?${params.toString()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(
        `TCGdex sets failed (${response.status})`
      );
    }

    const data = await response.json();
    const rawSets = Array.isArray(data) ? data : [];

    const results = rawSets
      .filter((set: TCGdexSet) => set.id && set.name)
      .map((set: TCGdexSet) => ({
        id: set.id,
        name: set.name,
        category: "Pokemon",
        code: set.id,
        cardCount:
          set.cardCount?.total ??
          set.cardCount?.official ??
          null,
      }))
      .sort((a, b) =>
        String(a.name).localeCompare(String(b.name))
      );

    return NextResponse.json({
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("Pokémon set catalog error:", error);

    return NextResponse.json(
      {
        error: "Pokémon set catalog is unavailable.",
        results: [],
      },
      { status: 500 }
    );
  }
}
