import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  set?: {
    id?: string;
    name?: string;
  };
  images?: {
    small?: string;
    large?: string;
  };
};

type PokemonTcgResponse = {
  data?: PokemonTcgCard[];
};

function normalize(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function scoreCard(
  card: PokemonTcgCard,
  {
    name,
    setName,
    cardNumber,
  }: {
    name: string;
    setName?: string | null;
    cardNumber?: string | null;
  }
) {
  const wantedName = normalize(name);
  const wantedSet = normalize(setName);
  const wantedNumber = normalize(cardNumber);

  const cardName = normalize(card.name);
  const cardSet = normalize(card.set?.name);
  const cardNumberValue = normalize(card.number);

  let score = 0;

  if (cardName === wantedName) {
    score += 1000;
  } else if (
    cardName.includes(wantedName) ||
    wantedName.includes(cardName)
  ) {
    score += 250;
  } else {
    return -1;
  }

  if (wantedSet) {
    if (cardSet === wantedSet) {
      score += 500;
    } else if (
      cardSet.includes(wantedSet) ||
      wantedSet.includes(cardSet)
    ) {
      score += 150;
    }
  }

  if (wantedNumber) {
    if (cardNumberValue === wantedNumber) {
      score += 400;
    } else {
      score -= 100;
    }
  }

  if (card.images?.large) {
    score += 25;
  } else if (card.images?.small) {
    score += 10;
  }

  return score;
}

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.POKEMON_TCG_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          error: "Pokémon image fallback is not configured.",
        },
        { status: 503 }
      );
    }

    const name =
      request.nextUrl.searchParams.get("name")?.trim() || "";

    const setName =
      request.nextUrl.searchParams.get("setName")?.trim() || null;

    const cardNumber =
      request.nextUrl.searchParams.get("cardNumber")?.trim() || null;

    if (!name) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          error: "Card name is required.",
        },
        { status: 400 }
      );
    }

    const query = `name:"${name.replace(/"/g, '\\"')}"`;

    const url = new URL(
      "https://api.pokemontcg.io/v2/cards"
    );

    url.searchParams.set("q", query);
    url.searchParams.set("page", "1");
    url.searchParams.set("pageSize", "50");
    url.searchParams.set(
      "select",
      "id,name,number,set,images"
    );

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 7000);

    let response: Response;

    try {
      response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          provider: "pokemon-tcg-api",
          upstreamStatus: response.status,
        },
        { status: 502 }
      );
    }

    const payload =
      (await response.json()) as PokemonTcgResponse;

    const ranked = (payload.data || [])
      .map((card) => ({
        card,
        score: scoreCard(card, {
          name,
          setName,
          cardNumber,
        }),
      }))
      .filter(
        ({ card, score }) =>
          score >= 1000 &&
          Boolean(card.images?.large || card.images?.small)
      )
      .sort((a, b) => b.score - a.score);

    const best = ranked[0]?.card;

    if (!best) {
      return NextResponse.json({
        ok: false,
        imageUrl: null,
        provider: "pokemon-tcg-api",
        reason: "no-confident-match",
      });
    }

    return NextResponse.json({
      ok: true,
      imageUrl:
        best.images?.large ||
        best.images?.small ||
        null,
      provider: "pokemon-tcg-api",
      match: {
        id: best.id || null,
        name: best.name || null,
        number: best.number || null,
        setId: best.set?.id || null,
        setName: best.set?.name || null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error";

    return NextResponse.json(
      {
        ok: false,
        imageUrl: null,
        provider: "pokemon-tcg-api",
        error: message,
      },
      { status: 502 }
    );
  }
}
