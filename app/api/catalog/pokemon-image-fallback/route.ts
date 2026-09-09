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

type FetchAttemptResult =
  | {
      ok: true;
      response: Response;
    }
  | {
      ok: false;
      status?: number;
      error?: string;
    };

type KnownImageOverride = {
  name: string;
  setName?: string;
  cardNumber?: string;
  imageUrl: string;
};

const KNOWN_IMAGE_OVERRIDES: KnownImageOverride[] = [
  {
    name: "Ancient Mew",
    setName: "Miscellaneous Promos",
    cardNumber: "001",
    imageUrl: "/card-overrides/pokemon/ancient-mew-001.jpg",
  },
];

function normalize(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findKnownImageOverride({
  name,
  setName,
  cardNumber,
}: {
  name: string;
  setName?: string | null;
  cardNumber?: string | null;
}) {
  const wantedName = normalize(name);
  const wantedSet = normalize(setName);
  const wantedNumber = normalize(cardNumber);

  return KNOWN_IMAGE_OVERRIDES.find((override) => {
    const overrideName = normalize(override.name);
    const overrideSet = normalize(override.setName);
    const overrideNumber = normalize(override.cardNumber);

    if (overrideName !== wantedName) {
      return false;
    }

    if (
      overrideSet &&
      wantedSet &&
      overrideSet !== wantedSet
    ) {
      return false;
    }

    if (
      overrideNumber &&
      wantedNumber &&
      overrideNumber !== wantedNumber
    ) {
      return false;
    }

    return true;
  });
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

function wait(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function isRetryableStatus(status: number) {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function fetchPokemonCards(
  url: string,
  apiKey: string
): Promise<FetchAttemptResult> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 7000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
      };
    }

    return {
      ok: true,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown upstream request error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  try {
    const name =
      request.nextUrl.searchParams
        .get("name")
        ?.trim() || "";

    const setName =
      request.nextUrl.searchParams
        .get("setName")
        ?.trim() || null;

    const cardNumber =
      request.nextUrl.searchParams
        .get("cardNumber")
        ?.trim() || null;

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

    // -----------------------------------------
    // KNOWN MINT RADAR OVERRIDES
    // -----------------------------------------

    const knownOverride =
      findKnownImageOverride({
        name,
        setName,
        cardNumber,
      });

    if (knownOverride) {
      return NextResponse.json({
        ok: true,
        imageUrl: knownOverride.imageUrl,
        provider: "mintradar-override",
        match: {
          name: knownOverride.name,
          setName:
            knownOverride.setName || null,
          cardNumber:
            knownOverride.cardNumber || null,
        },
      });
    }

    // -----------------------------------------
    // POKEMON TCG API FALLBACK
    // -----------------------------------------

    const apiKey =
      process.env.POKEMON_TCG_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          error:
            "Pokémon image fallback is not configured.",
        },
        { status: 503 }
      );
    }

    const query =
      `name:"${name.replace(
        /"/g,
        '\\"'
      )}"`;

    const url = new URL(
      "https://api.pokemontcg.io/v2/cards"
    );

    url.searchParams.set(
      "q",
      query
    );

    url.searchParams.set(
      "page",
      "1"
    );

    url.searchParams.set(
      "pageSize",
      "50"
    );

    url.searchParams.set(
      "select",
      "id,name,number,set,images"
    );

    const requestUrl =
      url.toString();

    let result =
      await fetchPokemonCards(
        requestUrl,
        apiKey
      );

    if (
      !result.ok &&
      result.status &&
      isRetryableStatus(
        result.status
      )
    ) {
      await wait(600);

      result =
        await fetchPokemonCards(
          requestUrl,
          apiKey
        );
    }

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          provider:
            "pokemon-tcg-api",
          upstreamStatus:
            result.status || null,
          error:
            result.error || null,
          reason:
            "upstream-unavailable",
        },
        { status: 502 }
      );
    }

    const payload =
      (await result.response.json()) as PokemonTcgResponse;

    const ranked =
      (payload.data || [])
        .map((card) => ({
          card,
          score:
            scoreCard(
              card,
              {
                name,
                setName,
                cardNumber,
              }
            ),
        }))
        .filter(
          ({
            card,
            score,
          }) =>
            score >= 1000 &&
            Boolean(
              card.images?.large ||
              card.images?.small
            )
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    const best =
      ranked[0]?.card;

    if (!best) {
      return NextResponse.json({
        ok: false,
        imageUrl: null,
        provider:
          "pokemon-tcg-api",
        reason:
          "no-confident-match",
      });
    }

    return NextResponse.json({
      ok: true,
      imageUrl:
        best.images?.large ||
        best.images?.small ||
        null,
      provider:
        "pokemon-tcg-api",
      match: {
        id:
          best.id || null,
        name:
          best.name || null,
        number:
          best.number || null,
        setId:
          best.set?.id || null,
        setName:
          best.set?.name || null,
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
        provider:
          "pokemon-tcg-api",
        error:
          message,
      },
      { status: 502 }
    );
  }
}