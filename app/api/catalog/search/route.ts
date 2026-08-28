import {
  NextRequest,
  NextResponse,
} from "next/server";

type TCGdexCardBrief = {
  id?: string;
  localId?: string;
  name?: string;
  image?: string;
};

type TCGdexSetBrief = {
  id?: string;
  name?: string;
};

type TCGdexSetDetail = {
  id?: string;
  name?: string;
  cards?: TCGdexCardBrief[];
};

type TCGdexCardDetail = {
  id?: string;
  localId?: string;
  name?: string;
  image?: string;
  rarity?: string;
  illustrator?: string;

  set?: {
    id?: string;
    name?: string;
  };

  variants?: {
    firstEdition?: boolean;
    holo?: boolean;
    normal?: boolean;
    reverse?: boolean;
    wPromo?: boolean;
  };
};

type NormalizedCard = {
  external_id: string;
  data_source: "tcgdex";

  name: string | null;
  set_name: string | null;
  set_id: string | null;

  card_number: string | null;

  category: "Pokemon";

  rarity: string | null;
  edition: string | null;
  finish: string | null;
  illustrator: string | null;

  image_url: string | null;
};

type SetCandidate = {
  set: TCGdexSetBrief;
  sourceQuery: string;
  score: number;
};

const PAGE_SIZE = 20;

const STOP_WORDS = new Set([
  "from",
  "in",
  "the",
  "set",
  "pokemon",
  "pokémon",
  "card",
  "cards",
]);

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

    // ----------------------------------------
    // 1. FIND POSSIBLE SETS INSIDE THE QUERY
    // ----------------------------------------
    //
    // Examples:
    //
    // "151"
    //   -> set = 151
    //
    // "Charizard 151"
    //   -> set = 151
    //   -> card text = Charizard
    //
    // "Charizard from 151"
    //   -> set = 151
    //   -> card text = Charizard
    //
    // "Pikachu Prismatic Evolutions"
    //   -> set = Prismatic Evolutions
    //   -> card text = Pikachu
    // ----------------------------------------

    const setCandidates =
      await findMatchingSets(
        query
      );

    const bestSet =
      setCandidates[0] ||
      null;

    const cardTextWithinSet =
      bestSet
        ? extractCardText(
            query,
            bestSet
          )
        : "";

    // ----------------------------------------
    // 2. SEARCH NORMAL CARD NAMES TOO
    // ----------------------------------------
    //
    // If we found a set inside the query,
    // search TCGdex using only the remaining
    // card-name portion.
    //
    // Otherwise, search the original query.
    // ----------------------------------------

    const normalCardQuery =
      cardTextWithinSet ||
      query;

    const normalSearchPromise =
      normalCardQuery
        ? searchCardsByName(
            normalCardQuery,
            page
          )
        : Promise.resolve(
            [] as TCGdexCardBrief[]
          );

    const setSearchPromise =
      bestSet
        ? loadCardsFromSet(
            bestSet.set
          )
        : Promise.resolve(
            [] as TCGdexCardBrief[]
          );

    const [
      normalSearchResult,
      setCardsResult,
    ] =
      await Promise.allSettled([
        normalSearchPromise,
        setSearchPromise,
      ]);

    const normalNameMatches =
      normalSearchResult.status ===
      "fulfilled"
        ? normalSearchResult.value
        : [];

    const allSetCards =
      setCardsResult.status ===
      "fulfilled"
        ? setCardsResult.value
        : [];

    if (
      normalSearchResult.status ===
        "rejected" &&
      setCardsResult.status ===
        "rejected"
    ) {
      console.error(
        "TCGdex card search failed:",
        normalSearchResult.reason
      );

      console.error(
        "TCGdex set-card search failed:",
        setCardsResult.reason
      );

      return NextResponse.json(
        {
          error:
            "TCGdex catalog search failed.",
          results: [],
        },
        {
          status: 502,
        }
      );
    }

    // ----------------------------------------
    // 3. FILTER SET CARDS BY CARD NAME
    // ----------------------------------------
    //
    // If the customer searched only a set name,
    // keep every card from that set.
    //
    // If the customer searched "Charizard 151",
    // keep only cards from 151 whose names match
    // "Charizard".
    // ----------------------------------------

    const filteredSetCards =
      bestSet
        ? filterSetCardsByCardText(
            allSetCards,
            cardTextWithinSet
          )
        : [];

    // ----------------------------------------
    // 4. PREFER SET-SPECIFIC MATCHES
    // ----------------------------------------
    //
    // This is important.
    //
    // For "Charizard 151", the Charizard cards
    // from set 151 should appear BEFORE generic
    // Charizard results from other sets.
    // ----------------------------------------

    const merged =
      new Map<
        string,
        TCGdexCardBrief
      >();

    [
      ...filteredSetCards,
      ...normalNameMatches,
    ].forEach((card) => {
      if (!card.id) {
        return;
      }

      if (
        !merged.has(
          card.id
        )
      ) {
        merged.set(
          card.id,
          card
        );
      }
    });

    const mergedCards =
      Array.from(
        merged.values()
      );

    // ----------------------------------------
    // 5. PAGE THE SET RESULTS LOCALLY
    // ----------------------------------------
    //
    // Normal TCGdex card-name results are already
    // paged by TCGdex. Set cards are not, so when
    // a set is detected we paginate the merged
    // results locally with set-specific matches
    // ranked first.
    // ----------------------------------------

    let cardsForThisPage:
      TCGdexCardBrief[];

    let hasMore:
      boolean;

    if (bestSet) {
      const start =
        (page - 1) *
        PAGE_SIZE;

      const end =
        start +
        PAGE_SIZE;

      cardsForThisPage =
        mergedCards.slice(
          start,
          end
        );

      hasMore =
        end <
        mergedCards.length;
    } else {
      cardsForThisPage =
        mergedCards.slice(
          0,
          PAGE_SIZE
        );

      hasMore =
        normalNameMatches.length ===
        PAGE_SIZE;
    }

    // ----------------------------------------
    // 6. LOAD CARD DETAILS
    // ----------------------------------------

    const detailedCards =
      await Promise.all(
        cardsForThisPage.map(
          (card) =>
            loadCardDetail(
              card
            )
        )
      );

    const results =
      detailedCards.filter(
        (
          card
        ): card is NormalizedCard =>
          card !== null
      );

    return NextResponse.json({
      query,
      page,
      pageSize:
        PAGE_SIZE,

      count:
        results.length,

      hasMore,

      matchedSets:
        setCandidates
          .filter(
            (candidate) =>
              candidate.set.id &&
              candidate.set.name
          )
          .slice(0, 5)
          .map(
            (candidate) => ({
              id:
                candidate.set.id,
              name:
                candidate.set.name,
              score:
                candidate.score,
            })
          ),

      parsedSearch:
        bestSet
          ? {
              set:
                bestSet.set
                  .name ||
                null,
              cardText:
                cardTextWithinSet ||
                null,
            }
          : {
              set: null,
              cardText:
                query,
            },

      results,
    });
  } catch (error) {
    console.error(
      "MintRadar catalog search error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while searching the catalog.",
        results: [],
      },
      {
        status: 500,
      }
    );
  }
}

// ============================================
// SMART SET DETECTION
// ============================================

async function findMatchingSets(
  query: string
): Promise<SetCandidate[]> {
  const searchPieces =
    buildSetSearchPieces(
      query
    );

  if (
    searchPieces.length === 0
  ) {
    return [];
  }

  const searches =
    await Promise.allSettled(
      searchPieces.map(
        async (
          piece
        ) => ({
          piece,
          sets:
            await searchSetsByName(
              piece
            ),
        })
      )
    );

  const candidates =
    new Map<
      string,
      SetCandidate
    >();

  searches.forEach(
    (result) => {
      if (
        result.status !==
        "fulfilled"
      ) {
        return;
      }

      const {
        piece,
        sets,
      } =
        result.value;

      sets.forEach(
        (set) => {
          if (
            !set.id ||
            !set.name
          ) {
            return;
          }

          const score =
            scoreSetMatch(
              query,
              piece,
              set
            );

          if (
            score <= 0
          ) {
            return;
          }

          const existing =
            candidates.get(
              set.id
            );

          if (
            !existing ||
            score >
              existing.score
          ) {
            candidates.set(
              set.id,
              {
                set,
                sourceQuery:
                  piece,
                score,
              }
            );
          }
        }
      );
    }
  );

  return Array.from(
    candidates.values()
  ).sort(
    (a, b) =>
      b.score -
      a.score
  );
}

function buildSetSearchPieces(
  query: string
) {
  const cleaned =
    normalizeText(query);

  const words =
    cleaned
      .split(" ")
      .filter(Boolean);

  const pieces =
    new Set<string>();

  // Whole query first.
  if (cleaned) {
    pieces.add(cleaned);
  }

  // Individual words matter for searches like
  // "Charizard 151".
  words.forEach(
    (word) => {
      if (
        !STOP_WORDS.has(
          word
        )
      ) {
        pieces.add(word);
      }
    }
  );

  // Add useful adjacent phrases so searches like
  // "Pikachu Prismatic Evolutions" can identify
  // the multi-word set name.
  for (
    let size =
      Math.min(
        4,
        words.length
      );
    size >= 2;
    size--
  ) {
    for (
      let start = 0;
      start <=
      words.length -
        size;
      start++
    ) {
      const phrase =
        words
          .slice(
            start,
            start +
              size
          )
          .join(" ");

      if (
        phrase &&
        !Array.from(
          STOP_WORDS
        ).includes(
          phrase
        )
      ) {
        pieces.add(
          phrase
        );
      }
    }
  }

  // Keep request count reasonable.
  return Array.from(
    pieces
  ).slice(
    0,
    12
  );
}

function scoreSetMatch(
  fullQuery: string,
  sourcePiece: string,
  set: TCGdexSetBrief
) {
  const normalizedFull =
    normalizeText(
      fullQuery
    );

  const normalizedPiece =
    normalizeText(
      sourcePiece
    );

  const setName =
    normalizeText(
      set.name || ""
    );

  if (
    !setName ||
    !normalizedPiece
  ) {
    return 0;
  }

  // Exact set-only search:
  // "151"
  if (
    normalizedFull ===
    setName
  ) {
    return 1000;
  }

  // Search contains exact set name:
  // "Charizard Prismatic Evolutions"
  if (
    normalizedFull
      .split(" ")
      .join(" ")
      .includes(
        setName
      )
  ) {
    return (
      900 +
      setName.length
    );
  }

  // The fragment sent to TCGdex exactly equals
  // the set name:
  // piece "151" -> set "151"
  if (
    normalizedPiece ===
    setName
  ) {
    return (
      800 +
      setName.length
    );
  }

  // Favor longer multi-word set fragments.
  if (
    setName.includes(
      normalizedPiece
    )
  ) {
    return (
      500 +
      normalizedPiece.length
    );
  }

  if (
    normalizedPiece.includes(
      setName
    )
  ) {
    return (
      450 +
      setName.length
    );
  }

  return 0;
}

// ============================================
// EXTRACT CARD TEXT FROM QUERY
// ============================================

function extractCardText(
  query: string,
  candidate: SetCandidate
) {
  const queryWords =
    normalizeText(
      query
    )
      .split(" ")
      .filter(Boolean);

  const setWords =
    normalizeText(
      candidate.set.name ||
        candidate.sourceQuery
    )
      .split(" ")
      .filter(Boolean);

  const sourceWords =
    normalizeText(
      candidate.sourceQuery
    )
      .split(" ")
      .filter(Boolean);

  const wordsToRemove =
    new Set([
      ...setWords,
      ...sourceWords,
      ...STOP_WORDS,
    ]);

  return queryWords
    .filter(
      (word) =>
        !wordsToRemove.has(
          word
        )
    )
    .join(" ")
    .trim();
}

// ============================================
// CARD NAME SEARCH
// ============================================

async function searchCardsByName(
  query: string,
  page: number
): Promise<
  TCGdexCardBrief[]
> {
  const params =
    new URLSearchParams();

  params.set(
    "name",
    query
  );

  params.set(
    "pagination:page",
    String(page)
  );

  params.set(
    "pagination:itemsPerPage",
    String(PAGE_SIZE)
  );

  const response =
    await fetch(
      `https://api.tcgdex.net/v2/en/cards?${params.toString()}`,
      {
        cache:
          "no-store",
      }
    );

  if (
    !response.ok
  ) {
    const errorText =
      await response.text();

    throw new Error(
      `TCGdex card search failed (${response.status}): ${errorText}`
    );
  }

  const data =
    await response.json();

  return Array.isArray(
    data
  )
    ? (data as TCGdexCardBrief[])
    : [];
}

// ============================================
// SET NAME SEARCH
// ============================================

async function searchSetsByName(
  query: string
): Promise<
  TCGdexSetBrief[]
> {
  const params =
    new URLSearchParams();

  params.set(
    "name",
    query
  );

  params.set(
    "pagination:page",
    "1"
  );

  params.set(
    "pagination:itemsPerPage",
    "20"
  );

  const response =
    await fetch(
      `https://api.tcgdex.net/v2/en/sets?${params.toString()}`,
      {
        cache:
          "no-store",
      }
    );

  if (
    !response.ok
  ) {
    const errorText =
      await response.text();

    throw new Error(
      `TCGdex set search failed (${response.status}): ${errorText}`
    );
  }

  const data =
    await response.json();

  return Array.isArray(
    data
  )
    ? (data as TCGdexSetBrief[])
    : [];
}

// ============================================
// LOAD ALL CARDS FROM ONE SET
// ============================================

async function loadCardsFromSet(
  set: TCGdexSetBrief
): Promise<
  TCGdexCardBrief[]
> {
  if (
    !set.id
  ) {
    return [];
  }

  const response =
    await fetch(
      `https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(
        set.id
      )}`,
      {
        cache:
          "no-store",
      }
    );

  if (
    !response.ok
  ) {
    const errorText =
      await response.text();

    throw new Error(
      `TCGdex set detail failed (${response.status}): ${errorText}`
    );
  }

  const detail:
    TCGdexSetDetail =
      await response.json();

  return Array.isArray(
    detail.cards
  )
    ? detail.cards
    : [];
}

// ============================================
// FILTER CARDS INSIDE MATCHED SET
// ============================================

function filterSetCardsByCardText(
  cards: TCGdexCardBrief[],
  cardText: string
) {
  const normalizedCardText =
    normalizeText(
      cardText
    );

  // Searching only the set:
  // "151"
  // -> return the whole set.
  if (
    !normalizedCardText
  ) {
    return cards;
  }

  const searchWords =
    normalizedCardText
      .split(" ")
      .filter(Boolean);

  return cards.filter(
    (card) => {
      const cardName =
        normalizeText(
          card.name || ""
        );

      if (
        !cardName
      ) {
        return false;
      }

      // Require every meaningful remaining
      // search word to exist in the card name.
      return searchWords.every(
        (word) =>
          cardName.includes(
            word
          )
      );
    }
  );
}

// ============================================
// CARD DETAIL NORMALIZATION
// ============================================

async function loadCardDetail(
  card: TCGdexCardBrief
): Promise<
  NormalizedCard | null
> {
  if (
    !card.id
  ) {
    return null;
  }

  try {
    const detailResponse =
      await fetch(
        `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(
          card.id
        )}`,
        {
          cache:
            "no-store",
        }
      );

    if (
      !detailResponse.ok
    ) {
      return {
        external_id:
          card.id,

        data_source:
          "tcgdex",

        name:
          card.name ||
          null,

        set_name:
          null,

        set_id:
          null,

        card_number:
          card.localId ||
          null,

        category:
          "Pokemon",

        rarity:
          null,

        edition:
          null,

        finish:
          null,

        illustrator:
          null,

        image_url:
          card.image
            ? `${card.image}/high.webp`
            : null,
      };
    }

    const detail:
      TCGdexCardDetail =
        await detailResponse.json();

    let edition:
      string | null =
        null;

    let finish:
      string | null =
        null;

    if (
      detail.variants
        ?.firstEdition
    ) {
      edition =
        "1st Edition";
    }

    if (
      detail.variants
        ?.holo
    ) {
      finish =
        "Holo";
    } else if (
      detail.variants
        ?.reverse
    ) {
      finish =
        "Reverse Holo";
    } else if (
      detail.variants
        ?.normal
    ) {
      finish =
        "Non-Holo";
    }

    return {
      external_id:
        detail.id ||
        card.id,

      data_source:
        "tcgdex",

      name:
        detail.name ||
        card.name ||
        null,

      set_name:
        detail.set?.name ||
        null,

      set_id:
        detail.set?.id ||
        null,

      card_number:
        detail.localId ||
        card.localId ||
        null,

      category:
        "Pokemon",

      rarity:
        detail.rarity ||
        null,

      edition,

      finish,

      illustrator:
        detail.illustrator ||
        null,

      image_url:
        detail.image
          ? `${detail.image}/high.webp`
          : card.image
          ? `${card.image}/high.webp`
          : null,
    };
  } catch (
    error
  ) {
    console.error(
      "TCGdex detail fetch failed:",
      card.id,
      error
    );

    return null;
  }
}

// ============================================
// TEXT NORMALIZATION
// ============================================

function normalizeText(
  value: string
) {
  return value
    .toLowerCase()
    .replace(
      /pokémon/g,
      "pokemon"
    )
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
