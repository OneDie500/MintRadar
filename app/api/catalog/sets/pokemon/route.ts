import { NextResponse } from "next/server";

type TCGdexSet = {
  id?: string;
  name?: string;
  cardCount?: {
    total?: number;
    official?: number;
  };
};

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "MintRadar/0.1",
};

async function fetchTcgdexSets() {
  const url = "https://api.tcgdex.net/v2/en/sets";
  const attempts = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, {
        headers: HEADERS,
        next: {
          revalidate: 3600,
        },
      });
    } catch (error) {
      lastError = error;

      console.warn(
        `TCGdex sets attempt ${attempt}/${attempts} failed:`,
        error
      );

      if (attempt < attempts) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, 750)
        );
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("TCGdex sets request failed after retry.");
}

export async function GET() {
  try {
    const response = await fetchTcgdexSets();

    if (!response.ok) {
      throw new Error(
        `TCGdex sets failed (${response.status})`
      );
    }

    const data = await response.json();
    const rawSets: TCGdexSet[] = Array.isArray(data)
      ? data
      : [];

    const results = rawSets
      .filter(
        (set) =>
          typeof set.id === "string" &&
          typeof set.name === "string"
      )
      .map((set) => ({
        id: set.id!,
        name: set.name!,
        category: "Pokemon" as const,
        code: set.id!,
        cardCount:
          set.cardCount?.total ??
          set.cardCount?.official ??
          null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("Pokémon set catalog error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Pokémon set catalog is unavailable.",
        results: [],
      },
      { status: 500 }
    );
  }
}
