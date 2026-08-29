import {
  NextRequest,
  NextResponse,
} from "next/server";

type NormalizedCard = {
  external_id: string;
  data_source: string;
  name: string | null;
  set_name: string | null;
  set_id: string | null;
  card_number: string | null;
  image_url: string | null;
  category: string;
  rarity: string | null;
  edition: string | null;
  finish: string | null;
  illustrator: string | null;
};

type RouteContext = {
  params: Promise<{
    category: string;
    setId: string;
  }>;
};

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "MintRadar/0.1",
};

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { category, setId } =
      await context.params;

    const cleanCategory =
      category.toLowerCase();

    const decodedSetId =
      decodeURIComponent(setId);

    const requestedName =
      request.nextUrl.searchParams
        .get("name")
        ?.trim() || null;

    let payload:
      | {
          set: {
            id: string;
            name: string;
            category: string;
            code?: string | null;
            cardCount?: number | null;
            releasedAt?: string | null;
            setType?: string | null;
            symbolUrl?: string | null;
          };
          results: NormalizedCard[];
        }
      | null = null;

    if (cleanCategory === "pokemon") {
      payload = await loadPokemonSet(
        decodedSetId
      );
    } else if (
      cleanCategory === "lorcana"
    ) {
      payload = await loadLorcanaSet(
        decodedSetId,
        requestedName
      );
    } else if (
      cleanCategory === "onepiece"
    ) {
      payload = await loadOnePieceSet(
        decodedSetId,
        requestedName
      );
    } else if (
      cleanCategory === "mtg"
    ) {
      payload = await loadMtgSet(
        decodedSetId
      );
    } else {
      return NextResponse.json(
        {
          error:
            "Unsupported set category.",
          results: [],
        },
        {
          status: 400,
        }
      );
    }

    return NextResponse.json({
      ...payload,
      count:
        payload.results.length,
    });
  } catch (error) {
    console.error(
      "MintRadar set checklist error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Set checklist failed.",
        results: [],
      },
      {
        status: 500,
      }
    );
  }
}

// =============================================
// POKÉMON / TCGDEX
// =============================================

type TCGdexCardBrief = {
  id?: string;
  localId?: string;
  name?: string;
  image?: string;
};

type TCGdexSetDetail = {
  id?: string;
  name?: string;
  logo?: string;
  symbol?: string;
  cardCount?: {
    total?: number;
    official?: number;
  };
  cards?: TCGdexCardBrief[];
};

async function loadPokemonSet(
  setId: string
) {
  const url = `https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(
    setId
  )}`;

  const response = await fetchTcgdexWithRetry(url);

  if (!response.ok) {
    throw new Error(
      `TCGdex set request failed (${response.status}).`
    );
  }

  const set:
    TCGdexSetDetail =
      await response.json();

  const cards =
    Array.isArray(set.cards)
      ? set.cards
      : [];

  const results:
    NormalizedCard[] =
      cards
        .filter(
          (card) =>
            Boolean(card.id)
        )
        .map((card) => ({
          external_id:
            card.id || "",
          data_source:
            "tcgdex",
          name:
            card.name ||
            null,
          set_name:
            set.name ||
            null,
          set_id:
            set.id ||
            setId,
          card_number:
            card.localId ||
            null,
          image_url:
            card.image
              ? `${card.image}/high.webp`
              : null,
          category:
            "Pokemon",
          rarity: null,
          edition: null,
          finish: null,
          illustrator: null,
        }));

  return {
    set: {
      id:
        set.id ||
        setId,
      name:
        set.name ||
        setId,
      category:
        "Pokemon",
      cardCount:
        set.cardCount?.total ??
        results.length,
      symbolUrl:
        set.symbol
          ? `${set.symbol}.webp`
          : null,
    },
    results,
  };
}

// =============================================
// LORCANA / LORCAST
// =============================================

type LorcastCard = {
  id?: string;
  name?: string;
  version?: string;
  rarity?: string;
  collector_number?: string;
  illustrators?: string[];
  set?: {
    id?: string;
    code?: string;
    name?: string;
  };
  image_uris?: {
    digital?: {
      small?: string;
      normal?: string;
      large?: string;
    };
  };
};

type LorcastSet = {
  id?: string;
  code?: string;
  name?: string;
};

async function loadLorcanaSet(
  setId: string,
  requestedName: string | null
) {
  const cardsResponse =
    await fetch(
      `https://api.lorcast.com/v0/sets/${encodeURIComponent(
        setId
      )}/cards`,
      {
        cache: "no-store",
        headers: HEADERS,
      }
    );

  let cards: LorcastCard[] = [];

  if (cardsResponse.ok) {
    const data =
      await cardsResponse.json();

    cards =
      Array.isArray(data)
        ? data
        : Array.isArray(
            data?.results
          )
        ? data.results
        : [];
  }

  // Some Lorcast routes prefer the set code rather than
  // the internal ID. If the direct request came back empty,
  // resolve the matching set and retry using its code.
  let resolvedSet:
    LorcastSet | null =
      null;

  if (
    cards.length === 0 ||
    !requestedName
  ) {
    const setsResponse =
      await fetch(
        "https://api.lorcast.com/v0/sets",
        {
          cache: "no-store",
          headers: HEADERS,
        }
      );

    if (setsResponse.ok) {
      const setsData =
        await setsResponse.json();

      const sets:
        LorcastSet[] =
          Array.isArray(
            setsData?.results
          )
            ? setsData.results
            : Array.isArray(
                setsData
              )
            ? setsData
            : [];

      const normalizedId =
        normalizeText(setId);

      const normalizedName =
        normalizeText(
          requestedName || ""
        );

      resolvedSet =
        sets.find((set) =>
          [
            set.id,
            set.code,
          ]
            .filter(Boolean)
            .some(
              (value) =>
                normalizeText(
                  String(value)
                ) ===
                normalizedId
            )
        ) ||
        sets.find(
          (set) =>
            normalizedName &&
            normalizeText(
              set.name || ""
            ) ===
              normalizedName
        ) ||
        null;
    }
  }

  if (
    cards.length === 0 &&
    resolvedSet?.code &&
    normalizeText(
      resolvedSet.code
    ) !==
      normalizeText(setId)
  ) {
    const retryResponse =
      await fetch(
        `https://api.lorcast.com/v0/sets/${encodeURIComponent(
          resolvedSet.code
        )}/cards`,
        {
          cache: "no-store",
          headers: HEADERS,
        }
      );

    if (retryResponse.ok) {
      const retryData =
        await retryResponse.json();

      cards =
        Array.isArray(
          retryData
        )
          ? retryData
          : Array.isArray(
              retryData?.results
            )
          ? retryData.results
          : [];
    }
  }

  const results:
    NormalizedCard[] =
      cards.map((card) => {
        const digital =
          card.image_uris
            ?.digital;

        return {
          external_id:
            card.id || "",
          data_source:
            "lorcast",
          name:
            card.version
              ? `${card.name} - ${card.version}`
              : card.name ||
                null,
          set_name:
            card.set?.name ||
            resolvedSet?.name ||
            requestedName ||
            null,
          set_id:
            card.set?.id ||
            resolvedSet?.id ||
            setId,
          card_number:
            card.collector_number ||
            null,
          image_url:
            digital?.large ||
            digital?.normal ||
            digital?.small ||
            null,
          category:
            "Lorcana",
          rarity:
            formatRarity(
              card.rarity
            ),
          edition: null,
          finish: null,
          illustrator:
            card.illustrators?.[0] ||
            null,
        };
      });

  return {
    set: {
      id:
        resolvedSet?.id ||
        setId,
      name:
        resolvedSet?.name ||
        cards[0]?.set?.name ||
        requestedName ||
        setId,
      category:
        "Lorcana",
      code:
        resolvedSet?.code ||
        cards[0]?.set?.code ||
        null,
      cardCount:
        results.length,
    },
    results,
  };
}

// =============================================
// ONE PIECE / OPTCG API
// =============================================

type OPTCGCard = {
  card_name?: string;
  card_set_id?: string;
  card_set_name?: string;
  card_rarity?: string;
  card_image?: string;
  card_image_id?: string;
  card_type?: string;
  card_color?: string;
  id?: number | string;
  card_id?: string;
};

type OPTCGSet = {
  set_name?: string;
  set_id?: string;
};

async function loadOnePieceSet(
  setId: string,
  requestedName: string | null
) {
  // OPTCG uses set IDs such as OP-01, while card IDs look like OP01-001.
  // Resolve the canonical set ID first, then use the provider's dedicated
  // /sets/{set_id}/ endpoint instead of downloading every set card and
  // trying to infer membership locally.
  const setsResponse = await fetch(
    "https://optcgapi.com/api/allSets/",
    {
      cache: "no-store",
      headers: HEADERS,
    }
  );

  let sets: OPTCGSet[] = [];

  if (setsResponse.ok) {
    const setsData = await setsResponse.json();

    sets = Array.isArray(setsData)
      ? setsData
      : Array.isArray(setsData?.data)
      ? setsData.data
      : Array.isArray(setsData?.results)
      ? setsData.results
      : Array.isArray(setsData?.sets)
      ? setsData.sets
      : [];
  }

  const normalizedIncomingId = normalizeOnePieceSetId(setId);
  const normalizedRequestedName = normalizeText(requestedName || "");

  const resolvedSet =
    sets.find(
      (set) =>
        normalizeOnePieceSetId(set.set_id || "") ===
        normalizedIncomingId
    ) ||
    sets.find(
      (set) =>
        normalizedRequestedName &&
        normalizeText(set.set_name || "") === normalizedRequestedName
    ) ||
    null;

  const providerSetId =
    resolvedSet?.set_id || toOnePieceProviderSetId(setId);

  const response = await fetch(
    `https://optcgapi.com/api/sets/${encodeURIComponent(
      providerSetId
    )}/`,
    {
      cache: "no-store",
      headers: HEADERS,
    }
  );

  if (!response.ok) {
    throw new Error(
      `OPTCG set request failed (${response.status}) for ${providerSetId}.`
    );
  }

  const data = await response.json();

  const cards: OPTCGCard[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.cards)
    ? data.cards
    : [];

  const results: NormalizedCard[] = cards.map((card, index) => {
    const name = card.card_name || "Unknown One Piece Card";
    const imageId = card.card_image_id || null;

    return {
      external_id: createOnePieceExternalId(card, index),
      data_source: "optcgapi",
      name,
      set_name:
        card.card_set_name ||
        resolvedSet?.set_name ||
        requestedName ||
        providerSetId,
      set_id: providerSetId,
      card_number: card.card_set_id || card.card_id || null,
      image_url: card.card_image || null,
      category: "One Piece",
      rarity: card.card_rarity || null,
      edition: null,
      finish: getOnePieceVariant(name, imageId),
      illustrator: null,
    };
  });

  return {
    set: {
      id: providerSetId,
      name:
        resolvedSet?.set_name ||
        cards[0]?.card_set_name ||
        requestedName ||
        providerSetId,
      category: "One Piece",
      code: providerSetId,
      cardCount: results.length,
    },
    results,
  };
}

function normalizeOnePieceSetId(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function toOnePieceProviderSetId(value: string) {
  const clean = normalizeOnePieceSetId(value);

  // OP01 -> OP-01, EB01 -> EB-01, PRB01 -> PRB-01.
  const match = clean.match(/^([A-Z]+)(\d+)$/);

  if (match) {
    return `${match[1]}-${match[2]}`;
  }

  return value.trim().toUpperCase();
}

// =============================================
// MAGIC / SCRYFALL
// =============================================

type ScryfallCard = {
  id?: string;
  name?: string;
  set?: string;
  set_name?: string;
  collector_number?: string;
  rarity?: string;
  finishes?: string[];
  artist?: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    png?: string;
  };
  card_faces?: {
    image_uris?: {
      small?: string;
      normal?: string;
      large?: string;
      png?: string;
    };
  }[];
};

type ScryfallCardResponse = {
  has_more?: boolean;
  next_page?: string | null;
  data?: ScryfallCard[];
  details?: string;
};

type ScryfallSet = {
  code?: string;
  name?: string;
  card_count?: number;
  released_at?: string;
  set_type?: string;
  icon_svg_uri?: string;
};

async function loadMtgSet(
  setId: string
) {
  const setResponse =
    await fetch(
      `https://api.scryfall.com/sets/${encodeURIComponent(
        setId
      )}`,
      {
        cache: "no-store",
        headers: HEADERS,
      }
    );

  if (!setResponse.ok) {
    throw new Error(
      `Scryfall set request failed (${setResponse.status}).`
    );
  }

  const set:
    ScryfallSet =
      await setResponse.json();

  const params =
    new URLSearchParams();

  params.set(
    "q",
    `set:${setId}`
  );
  params.set(
    "unique",
    "prints"
  );
  params.set(
    "order",
    "set"
  );

  let nextUrl:
    string | null =
      `https://api.scryfall.com/cards/search?${params.toString()}`;

  const cards:
    ScryfallCard[] = [];

  let pageCount = 0;

  while (
    nextUrl &&
    pageCount < 20
  ) {
    const response =
      await fetch(nextUrl, {
        cache: "no-store",
        headers: HEADERS,
      });

    const data:
      ScryfallCardResponse =
        await response.json();

    if (!response.ok) {
      throw new Error(
        data.details ||
          `Scryfall cards request failed (${response.status}).`
      );
    }

    cards.push(
      ...(Array.isArray(data.data)
        ? data.data
        : [])
    );

    nextUrl =
      data.has_more &&
      data.next_page
        ? data.next_page
        : null;

    pageCount += 1;

    if (nextUrl) {
      await delay(75);
    }
  }

  const results:
    NormalizedCard[] =
      cards.map((card) => {
        const faceImage =
          card.card_faces?.find(
            (face) =>
              Boolean(
                face.image_uris
              )
          )?.image_uris;

        const image =
          card.image_uris ||
          faceImage;

        return {
          external_id:
            card.id || "",
          data_source:
            "scryfall",
          name:
            card.name ||
            null,
          set_name:
            card.set_name ||
            set.name ||
            null,
          set_id:
            card.set ||
            set.code ||
            setId,
          card_number:
            card.collector_number ||
            null,
          image_url:
            image?.large ||
            image?.normal ||
            image?.png ||
            image?.small ||
            null,
          category:
            "Magic: The Gathering",
          rarity:
            formatRarity(
              card.rarity
            ),
          edition: null,
          finish:
            normalizeFinish(
              card.finishes
            ),
          illustrator:
            card.artist ||
            null,
        };
      });

  return {
    set: {
      id:
        set.code ||
        setId,
      name:
        set.name ||
        setId,
      category:
        "Magic: The Gathering",
      code:
        set.code ||
        setId,
      cardCount:
        set.card_count ??
        results.length,
      releasedAt:
        set.released_at ||
        null,
      setType:
        set.set_type ||
        null,
      symbolUrl:
        set.icon_svg_uri ||
        null,
    },
    results,
  };
}

// =============================================
// TCGDEX FETCH RESILIENCE
// =============================================

async function fetchTcgdexWithRetry(url: string) {
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
        `TCGdex request attempt ${attempt}/${attempts} failed:`,
        error
      );

      if (attempt < attempts) {
        await delay(750);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("TCGdex request failed after retry.");
}

// =============================================
// HELPERS
// =============================================

function normalizeText(
  value: string
) {
  return value
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim()
    .replace(
      /\s+/g,
      " "
    );
}

function formatRarity(
  rarity?: string
) {
  if (!rarity) {
    return null;
  }

  return rarity
    .split("_")
    .map(
      (word) =>
        word
          .charAt(0)
          .toUpperCase() +
        word.slice(1)
    )
    .join(" ");
}

function normalizeFinish(
  finishes?: string[]
) {
  if (
    !finishes ||
    finishes.length === 0
  ) {
    return null;
  }

  if (
    finishes.includes(
      "etched"
    )
  ) {
    return "Etched Foil";
  }

  if (
    finishes.includes(
      "foil"
    )
  ) {
    return "Foil";
  }

  if (
    finishes.includes(
      "nonfoil"
    )
  ) {
    return "Non-Foil";
  }

  return finishes[0];
}

function createOnePieceExternalId(
  card: OPTCGCard,
  index: number
) {
  if (card.id) {
    return `optcg-${card.id}`;
  }

  const raw =
    [
      card.card_set_id,
      card.card_image_id,
      card.card_name,
      card.card_rarity,
    ]
      .filter(Boolean)
      .join("-");

  const slug =
    raw
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      );

  return slug
    ? `optcg-${slug}`
    : `optcg-card-${index}`;
}

function getOnePieceVariant(
  name: string,
  imageId: string | null
) {
  const value =
    name.toLowerCase();

  if (
    value.includes("manga")
  ) {
    return "Manga";
  }

  if (
    value.includes(
      "alternate art"
    )
  ) {
    return "Alternate Art";
  }

  if (
    value.includes("(sp)") ||
    value.includes(" sp ")
  ) {
    return "SP";
  }

  if (
    value.includes("gold")
  ) {
    return "Gold";
  }

  if (
    imageId &&
    /_p\d+$/i.test(imageId)
  ) {
    return "Alternate Art";
  }

  return null;
}

function delay(
  milliseconds: number
) {
  return new Promise<void>(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}
