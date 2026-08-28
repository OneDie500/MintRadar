import {
  NextRequest,
  NextResponse,
} from "next/server";

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

  prices?: {
    usd?: string | null;
    usd_foil?: string | number | null;
  };
};

type LorcastSet = {
  id?: string;
  code?: string;
  name?: string;
};

type LorcastResponse = {
  results?: LorcastCard[];
};

type LorcastSetsResponse = {
  results?: LorcastSet[];
};

const PAGE_SIZE = 20;

const HEADERS = {
  Accept: "application/json",
  "User-Agent": "MintRadar/0.1",
};

export async function GET(
  request: NextRequest
) {
  try {
    const searchParams =
      request.nextUrl.searchParams;

    const query =
      searchParams
        .get("q")
        ?.trim();

    const requestedPage =
      Number(
        searchParams.get("page") ||
          "1"
      );

    const page =
      Number.isFinite(
        requestedPage
      ) &&
      requestedPage > 0
        ? Math.floor(
            requestedPage
          )
        : 1;

    if (!query) {
      return NextResponse.json(
        {
          error:
            "Search query is required.",
          results: [],
        },
        {
          status: 400,
        }
      );
    }

    // -----------------------------------------
    // 1. NORMAL LORCAST CARD SEARCH
    // -----------------------------------------

    const normalSearchPromise =
      searchCards(query);

    // -----------------------------------------
    // 2. LOAD SET LIST
    // -----------------------------------------
    //
    // Lorcast's free-text card search is great
    // for card names, but a customer typing an
    // expansion name should also get every card
    // from that set.
    // -----------------------------------------

    const setsPromise =
      fetchSets();

    const [
      normalSearchResult,
      setsResult,
    ] =
      await Promise.allSettled([
        normalSearchPromise,
        setsPromise,
      ]);

    const normalCards =
      normalSearchResult.status ===
      "fulfilled"
        ? normalSearchResult.value
        : [];

    const allSets =
      setsResult.status ===
      "fulfilled"
        ? setsResult.value
        : [];

    if (
      normalSearchResult.status ===
        "rejected" &&
      setsResult.status ===
        "rejected"
    ) {
      console.error(
        "Lorcast card search error:",
        normalSearchResult.reason
      );

      console.error(
        "Lorcast set search error:",
        setsResult.reason
      );

      return NextResponse.json(
        {
          error:
            "Lorcana catalog search failed.",
          results: [],
        },
        {
          status: 502,
        }
      );
    }

    // -----------------------------------------
    // 3. FIND SETS MATCHING CUSTOMER QUERY
    // -----------------------------------------

    const normalizedQuery =
      normalizeText(query);

    const matchingSets =
      allSets
        .map((set) => ({
          set,
          score:
            getSetMatchScore(
              set,
              normalizedQuery
            ),
        }))
        .filter(
          (entry) =>
            entry.score > 0
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )
        .slice(0, 5)
        .map(
          (entry) =>
            entry.set
        );

    // -----------------------------------------
    // 4. LOAD CARDS FROM MATCHING SETS
    // -----------------------------------------

    const setCardResults =
      await Promise.allSettled(
        matchingSets.map(
          async (set) => {
            const identifier =
              set.code ||
              set.id;

            if (!identifier) {
              return [];
            }

            // Lorcast asks clients to avoid
            // hammering the API. These requests
            // are intentionally staggered.
            await delay(75);

            return fetchSetCards(
              identifier
            );
          }
        )
      );

    const setCards =
      setCardResults.flatMap(
        (result) =>
          result.status ===
          "fulfilled"
            ? result.value
            : []
      );

    // -----------------------------------------
    // 5. MERGE + DEDUPE EXACT PRINTINGS
    // -----------------------------------------

    const merged =
      new Map<
        string,
        LorcastCard
      >();

    [
      ...normalCards,
      ...setCards,
    ].forEach((card) => {
      const key =
        card.id ||
        [
          card.set?.code,
          card.collector_number,
          card.name,
          card.version,
        ]
          .filter(Boolean)
          .join(":");

      if (!key) {
        return;
      }

      if (!merged.has(key)) {
        merged.set(
          key,
          card
        );
      }
    });

    const allCards =
      Array.from(
        merged.values()
      );

    // -----------------------------------------
    // 6. LOCAL PAGINATION
    // -----------------------------------------

    const start =
      (page - 1) *
      PAGE_SIZE;

    const end =
      start +
      PAGE_SIZE;

    const pageCards =
      allCards.slice(
        start,
        end
      );

    // -----------------------------------------
    // 7. NORMALIZE INTO MINTRADAR
    // -----------------------------------------

    const results =
      pageCards.map(
        normalizeCard
      );

    const hasMore =
      end <
      allCards.length;

    return NextResponse.json({
      query,
      page,
      pageSize:
        PAGE_SIZE,

      count:
        results.length,

      total:
        allCards.length,

      hasMore,

      matchedSets:
        matchingSets.map(
          (set) => ({
            id:
              set.id ||
              null,
            code:
              set.code ||
              null,
            name:
              set.name ||
              null,
          })
        ),

      results,
    });
  } catch (error) {
    console.error(
      "MintRadar Lorcana catalog error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while searching the Lorcana catalog.",
        results: [],
      },
      {
        status: 500,
      }
    );
  }
}

// =============================================
// NORMAL CARD SEARCH
// =============================================

async function searchCards(
  query: string
): Promise<LorcastCard[]> {
  const params =
    new URLSearchParams();

  params.set(
    "q",
    query
  );

  params.set(
    "unique",
    "prints"
  );

  const url =
    `https://api.lorcast.com/v0/cards/search?${params.toString()}`;

  const response =
    await fetch(url, {
      cache: "no-store",
      headers: HEADERS,
    });

  const data: LorcastResponse =
    await response.json();

  if (!response.ok) {
    throw new Error(
      `Lorcast card search failed (${response.status})`
    );
  }

  return Array.isArray(
    data.results
  )
    ? data.results
    : [];
}

// =============================================
// ALL LORCANA SETS
// =============================================

async function fetchSets(): Promise<
  LorcastSet[]
> {
  const response =
    await fetch(
      "https://api.lorcast.com/v0/sets",
      {
        cache: "no-store",
        headers: HEADERS,
      }
    );

  const data: LorcastSetsResponse =
    await response.json();

  if (!response.ok) {
    throw new Error(
      `Lorcast set list failed (${response.status})`
    );
  }

  return Array.isArray(
    data.results
  )
    ? data.results
    : [];
}

// =============================================
// CARDS FROM A SPECIFIC SET
// =============================================

async function fetchSetCards(
  identifier: string
): Promise<LorcastCard[]> {
  const response =
    await fetch(
      `https://api.lorcast.com/v0/sets/${encodeURIComponent(
        identifier
      )}/cards`,
      {
        cache: "no-store",
        headers: HEADERS,
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      "Lorcast set card error:",
      identifier,
      response.status,
      errorText
    );

    return [];
  }

  const data =
    await response.json();

  return Array.isArray(data)
    ? (data as LorcastCard[])
    : [];
}

// =============================================
// NORMALIZE CARD
// =============================================

function normalizeCard(
  card: LorcastCard
) {
  const digital =
    card.image_uris
      ?.digital;

  const displayName =
    card.version
      ? `${card.name} - ${card.version}`
      : card.name;

  return {
    external_id:
      card.id || "",

    data_source:
      "lorcast",

    name:
      displayName ||
      null,

    set_name:
      card.set?.name ||
      null,

    set_id:
      card.set?.id ||
      null,

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

    edition:
      null,

    finish:
      null,

    illustrator:
      card.illustrators?.[0] ||
      null,
  };
}

// =============================================
// SET MATCHING
// =============================================

function getSetMatchScore(
  set: LorcastSet,
  normalizedQuery: string
) {
  const name =
    normalizeText(
      set.name || ""
    );

  const code =
    normalizeText(
      set.code || ""
    );

  if (
    !normalizedQuery
  ) {
    return 0;
  }

  if (
    name ===
    normalizedQuery
  ) {
    return 100;
  }

  if (
    code ===
    normalizedQuery
  ) {
    return 95;
  }

  if (
    name.startsWith(
      normalizedQuery
    )
  ) {
    return 80;
  }

  if (
    name.includes(
      normalizedQuery
    )
  ) {
    return 70;
  }

  const queryWords =
    normalizedQuery
      .split(" ")
      .filter(Boolean);

  const allWordsMatch =
    queryWords.length > 0 &&
    queryWords.every(
      (word) =>
        name.includes(word)
    );

  if (
    allWordsMatch
  ) {
    return 60;
  }

  return 0;
}

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

// =============================================
// RATE LIMIT FRIENDLY DELAY
// =============================================

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

// =============================================
// RARITY
// =============================================

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
