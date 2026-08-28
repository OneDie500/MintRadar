import { NextResponse } from "next/server";

type LorcastSet = {
  id?: string;
  code?: string;
  name?: string;
};

type LorcastResponse = {
  results?: LorcastSet[];
};

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "MintRadar/0.1",
};

export async function GET() {
  try {
    const response = await fetch(
      "https://api.lorcast.com/v0/sets",
      {
        cache: "no-store",
        headers: HEADERS,
      }
    );

    if (!response.ok) {
      throw new Error(
        `Lorcast sets failed (${response.status})`
      );
    }

    const data: LorcastResponse =
      await response.json();

    const sets = (data.results || []).filter(
      (set) => set.id && set.name
    );

    const results = [];

    // Lorcast's set-list response does not give MintRadar
    // a usable card count, so count the cards from each
    // set's dedicated card endpoint.
    //
    // Lorcast asks clients to leave roughly 50–100 ms
    // between requests, so we intentionally do this
    // sequentially with a short delay.
    for (let index = 0; index < sets.length; index += 1) {
      const set = sets[index];

      let cards = await fetchSetCards(
        set.id as string
      );

      // Some Lorcast set-card routes are happier with
      // the short set code than the internal ID.
      if (
        cards.length === 0 &&
        set.code &&
        set.code !== set.id
      ) {
        await delay(75);
        cards = await fetchSetCards(set.code);
      }

      results.push({
        id: set.id as string,
        name: set.name as string,
        category: "Lorcana",
        code: set.code || null,
        cardCount: cards.length,
      });

      if (index < sets.length - 1) {
        await delay(75);
      }
    }

    results.sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return NextResponse.json({
      count: results.length,
      results,
    });
  } catch (error) {
    console.error(
      "Lorcana set catalog error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Lorcana set catalog is unavailable.",
        results: [],
      },
      { status: 500 }
    );
  }
}

async function fetchSetCards(
  identifier: string
): Promise<unknown[]> {
  const response = await fetch(
    `https://api.lorcast.com/v0/sets/${encodeURIComponent(
      identifier
    )}/cards`,
    {
      cache: "no-store",
      headers: HEADERS,
    }
  );

  if (!response.ok) {
    return [];
  }

  const data = await response.json();

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data?.results)) {
    return data.results;
  }

  return [];
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) =>
    setTimeout(resolve, milliseconds)
  );
}
