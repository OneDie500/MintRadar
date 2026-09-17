import {
  NextRequest,
  NextResponse,
} from "next/server";
import { createClient } from "@supabase/supabase-js";

type CardRow = {
  external_id: string;
  data_source: string | null;
  name: string | null;
  set_name: string | null;
  card_number: string | null;
  image_url: string | null;
  category: string | null;
  rarity: string | null;
  edition: string | null;
  finish: string | null;
};

type SetRow = {
  external_id: string;
  name: string;
  code: string | null;
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
  set: SetRow;
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

function getSupabaseClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase environment variables are not configured."
    );
  }

  return createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}


async function enrichMissingPokemonImages(
  request: NextRequest,
  cards: NormalizedCard[]
): Promise<NormalizedCard[]> {
  const origin = request.nextUrl.origin;

  return Promise.all(
    cards.map(async (card) => {
      if (card.image_url || !card.name) {
        return card;
      }

      try {
        const params = new URLSearchParams({
          name: card.name,
        });

        if (card.set_name) {
          params.set("setName", card.set_name);
        }

        if (card.card_number) {
          params.set("cardNumber", card.card_number);
        }

        const response = await fetch(
          `${origin}/api/catalog/pokemon-image-fallback?${params.toString()}`,
          { cache: "no-store" }
        );

        if (!response.ok) {
          return card;
        }

        const payload = await response.json();

        if (payload?.ok && payload?.imageUrl) {
          return {
            ...card,
            image_url: String(payload.imageUrl),
          };
        }
      } catch (error) {
        console.warn(
          "Catalog image enrichment skipped:",
          error
        );
      }

      return card;
    })
  );
}

export async function GET(
  request: NextRequest
) {
  try {
    const query =
      request.nextUrl.searchParams
        .get("q")
        ?.trim();

    const requestedPage =
      Number(
        request.nextUrl.searchParams.get(
          "page"
        ) || "1"
      );

    const page =
      Number.isFinite(requestedPage) &&
      requestedPage > 0
        ? Math.floor(requestedPage)
        : 1;

    if (!query) {
      return NextResponse.json(
        {
          error:
            "Search query is required.",
          results: [],
        },
        { status: 400 }
      );
    }

    const supabase =
      getSupabaseClient();

    const setCandidates =
      await findMatchingSets(
        supabase,
        query
      );

    const bestSetCandidate =
      setCandidates[0] || null;

    // Only let a set take over the search when the user's query
    // contains the complete set name/code. Loose partial matches
    // (for example "Ancient" -> "Ancient Origins") should not
    // hijack a normal card-name search such as "Ancient Mew".
    const bestSet =
      bestSetCandidate &&
      isConfidentSetMatch(
        query,
        bestSetCandidate
      )
        ? bestSetCandidate
        : null;

    const cardTextWithinSet =
      bestSet
        ? extractCardText(
            query,
            bestSet
          )
        : "";

    let matchingCards:
      CardRow[] = [];

    if (bestSet) {
      matchingCards =
        await searchWithinSet(
          supabase,
          bestSet.set,
          cardTextWithinSet
        );
    } else {
      const directMatches =
        await searchCardsByName(
          supabase,
          query
        );

      const numericSetMatches =
        await searchNumericSetInterpretations(
          supabase,
          query,
          setCandidates
        );

      matchingCards =
        mergeCardRows(
          directMatches,
          numericSetMatches
        );
    }

    const start =
      (page - 1) * PAGE_SIZE;
    const end =
      start + PAGE_SIZE;

    const pageRows =
      matchingCards.slice(
        start,
        end
      );

    const results =
      pageRows.map(
        normalizeCard
      );

    // ROUND 7:
    // Fill only missing catalog images using MintRadar's existing
    // Pokémon fallback. Existing catalog images remain untouched here;
    // broken URLs are handled by the browser/card resolver path.
    const enrichedResults =
      await enrichMissingPokemonImages(
        request,
        results
      );

    return NextResponse.json({
      query,
      page,
      pageSize: PAGE_SIZE,
      count: enrichedResults.length,
      hasMore:
        end < matchingCards.length,

      matchedSets:
        setCandidates
          .slice(0, 5)
          .map(
            (candidate) => ({
              id:
                candidate.set.external_id,
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
                bestSet.set.name,
              cardText:
                cardTextWithinSet ||
                null,
            }
          : {
              set: null,
              cardText: query,
            },

      results: enrichedResults,
    });
  } catch (error) {
    console.error(
      "MintRadar Pokémon catalog search error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong while searching the catalog.",
        results: [],
      },
      { status: 500 }
    );
  }
}

async function findMatchingSets(
  supabase: ReturnType<
    typeof getSupabaseClient
  >,
  query: string
): Promise<SetCandidate[]> {
  const searchPieces =
    buildSetSearchPieces(query);

  if (
    searchPieces.length === 0
  ) {
    return [];
  }

  const searches =
    await Promise.all(
      searchPieces.map(
        async (piece) => {
          const safePiece =
            escapeLikePattern(piece);

          const { data, error } =
            await supabase
              .from("catalog_sets")
              .select(
                "external_id,name,code"
              )
              .eq(
                "data_source",
                "tcgdex"
              )
              .eq(
                "category",
                "Pokemon"
              )
              .or(
                `name.ilike.%${safePiece}%,code.ilike.%${safePiece}%`
              )
              .limit(20);

          if (error) {
            throw new Error(
              `Pokémon set search failed: ${error.message}`
            );
          }

          return {
            piece,
            sets:
              (data ?? []) as SetRow[],
          };
        }
      )
    );

  const candidates =
    new Map<
      string,
      SetCandidate
    >();

  for (
    const {
      piece,
      sets,
    } of searches
  ) {
    for (const set of sets) {
      const score =
        scoreSetMatch(
          query,
          piece,
          set
        );

      if (score <= 0) {
        continue;
      }

      const existing =
        candidates.get(
          set.external_id
        );

      if (
        !existing ||
        score > existing.score
      ) {
        candidates.set(
          set.external_id,
          {
            set,
            sourceQuery: piece,
            score,
          }
        );
      }
    }
  }

  return Array.from(
    candidates.values()
  ).sort(
    (a, b) =>
      b.score - a.score
  );
}

async function searchWithinSet(
  supabase: ReturnType<
    typeof getSupabaseClient
  >,
  set: SetRow,
  cardText: string
): Promise<CardRow[]> {
  let request =
    supabase
      .from("cards")
      .select(
        "external_id,data_source,name,set_name,card_number,image_url,category,rarity,edition,finish"
      )
      .eq(
        "data_source",
        "tcgdex"
      )
      .eq(
        "category",
        "Pokemon"
      )
      .like(
        "external_id",
        `${escapeLikePattern(
          set.external_id
        )}-%`
      );

  const searchWords =
    normalizeText(cardText)
      .split(" ")
      .filter(Boolean);

  for (
    const word of searchWords
  ) {
    request =
      request.ilike(
        "name",
        `%${escapeLikePattern(
          word
        )}%`
      );
  }

  const { data, error } =
    await request
      .order(
        "card_number",
        { ascending: true }
      )
      .limit(1000);

  if (error) {
    throw new Error(
      `Pokémon set-card search failed: ${error.message}`
    );
  }

  return (data ?? []) as CardRow[];
}

async function searchCardsByName(
  supabase: ReturnType<
    typeof getSupabaseClient
  >,
  query: string
): Promise<CardRow[]> {
  const words =
    normalizeText(query)
      .split(" ")
      .filter(
        (word) =>
          word.length > 0 &&
          !STOP_WORDS.has(word)
      );

  if (words.length === 0) {
    return [];
  }

  // Treat a standalone numeric / collector-number token as a card
  // number instead of forcing every token into the card name.
  //
  // Examples:
  //   "Gastly 177"       -> name: Gastly, number: 177
  //   "Gastly #177"      -> name: Gastly, number: 177
  //   "177 Gastly"       -> name: Gastly, number: 177
  //   "Gastly 177/162"   -> name: Gastly, number: 177
  //
  // We only do this when there is at least one non-number token so
  // normal card-name searching remains the primary behavior.
  const numberTokens =
    words.filter((word) =>
      /^\d+(?:[a-z]+)?$/.test(word)
    );

  const nameWords =
    words.filter(
      (word) =>
        !numberTokens.includes(word)
    );

  const cardNumber =
    nameWords.length > 0 &&
    numberTokens.length > 0
      ? numberTokens[
          numberTokens.length - 1
        ]
      : null;

  const effectiveNameWords =
    cardNumber
      ? nameWords
      : words;

  let request =
    supabase
      .from("cards")
      .select(
        "external_id,data_source,name,set_name,card_number,image_url,category,rarity,edition,finish"
      )
      .eq(
        "data_source",
        "tcgdex"
      )
      .eq(
        "category",
        "Pokemon"
      );

  for (
    const word of
    effectiveNameWords
  ) {
    request =
      request.ilike(
        "name",
        `%${escapeLikePattern(
          word
        )}%`
      );
  }

  if (cardNumber) {
    request =
      request.ilike(
        "card_number",
        `${escapeLikePattern(
          cardNumber
        )}%`
      );
  }

  const { data, error } =
    await request
      .order(
        "name",
        { ascending: true }
      )
      .order(
        "set_name",
        { ascending: true }
      )
      .order(
        "card_number",
        { ascending: true }
      )
      .limit(1000);

  if (error) {
    throw new Error(
      `Pokémon card search failed: ${error.message}`
    );
  }

  return (data ?? []) as CardRow[];
}

async function searchNumericSetInterpretations(
  supabase: ReturnType<
    typeof getSupabaseClient
  >,
  query: string,
  setCandidates: SetCandidate[]
): Promise<CardRow[]> {
  const normalizedQuery =
    normalizeText(query);

  const queryWords =
    normalizedQuery
      .split(" ")
      .filter(Boolean);

  const numericTokens =
    queryWords.filter((word) =>
      /^\d+$/.test(word)
    );

  if (numericTokens.length === 0) {
    return [];
  }

  // A number beside a card name can legitimately mean either a
  // collector number or a numeric set name/code. Search both rather
  // than forcing one interpretation.
  //
  // Examples:
  //   "Gastly 177"    -> normal search can find Gastly #177
  //   "Charizard 151" -> numeric-set search can find Charizard in 151
  const candidateSets =
    setCandidates.filter(
      (candidate) => {
        const setName =
          normalizeText(
            candidate.set.name || ""
          );

        const setCode =
          normalizeText(
            candidate.set.code || ""
          );

        return numericTokens.some(
          (token) =>
            setName === token ||
            setCode === token
        );
      }
    );

  if (candidateSets.length === 0) {
    return [];
  }

  const matches =
    await Promise.all(
      candidateSets
        .slice(0, 5)
        .map(async (candidate) => {
          const setName =
            normalizeText(
              candidate.set.name || ""
            );

          const setCode =
            normalizeText(
              candidate.set.code || ""
            );

          const numericSetTokens =
            new Set(
              numericTokens.filter(
                (token) =>
                  setName === token ||
                  setCode === token
              )
            );

          const cardText =
            queryWords
              .filter(
                (word) =>
                  !numericSetTokens.has(word) &&
                  !STOP_WORDS.has(word)
              )
              .join(" ")
              .trim();

          if (!cardText) {
            return [];
          }

          return searchWithinSet(
            supabase,
            candidate.set,
            cardText
          );
        })
    );

  return mergeCardRows(
    ...matches
  );
}

function mergeCardRows(
  ...groups: CardRow[][]
): CardRow[] {
  const unique =
    new Map<string, CardRow>();

  for (const group of groups) {
    for (const card of group) {
      const key =
        `${card.data_source || ""}:${card.external_id}`;

      if (!unique.has(key)) {
        unique.set(key, card);
      }
    }
  }

  return Array.from(
    unique.values()
  );
}

function normalizeCard(
  card: CardRow
): NormalizedCard {
  return {
    external_id:
      card.external_id,
    data_source: "tcgdex",
    name: card.name,
    set_name: card.set_name,
    set_id:
      deriveSetId(
        card.external_id,
        card.card_number
      ),
    card_number:
      card.card_number,
    category: "Pokemon",
    rarity: card.rarity,
    edition: card.edition,
    finish: card.finish,
    illustrator: null,
    image_url: card.image_url,
  };
}

function deriveSetId(
  externalId: string,
  cardNumber: string | null
) {
  if (
    cardNumber &&
    externalId.endsWith(
      `-${cardNumber}`
    )
  ) {
    return externalId.slice(
      0,
      -(
        cardNumber.length + 1
      )
    );
  }

  const lastDash =
    externalId.lastIndexOf("-");

  return lastDash > 0
    ? externalId.slice(
        0,
        lastDash
      )
    : null;
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

  if (cleaned) {
    pieces.add(cleaned);
  }

  words.forEach(
    (word) => {
      if (
        !STOP_WORDS.has(word)
      ) {
        pieces.add(word);
      }
    }
  );

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
      words.length - size;
      start++
    ) {
      const phrase =
        words
          .slice(
            start,
            start + size
          )
          .join(" ");

      if (phrase) {
        pieces.add(phrase);
      }
    }
  }

  return Array.from(
    pieces
  ).slice(0, 12);
}

function scoreSetMatch(
  fullQuery: string,
  sourcePiece: string,
  set: SetRow
) {
  const normalizedFull =
    normalizeText(fullQuery);

  const normalizedPiece =
    normalizeText(
      sourcePiece
    );

  const setName =
    normalizeText(
      set.name || ""
    );

  const setCode =
    normalizeText(
      set.code || ""
    );

  if (
    !normalizedPiece ||
    (!setName && !setCode)
  ) {
    return 0;
  }

  if (
    normalizedFull ===
      setName ||
    normalizedFull ===
      setCode
  ) {
    return 1000;
  }

  if (
    setName &&
    normalizedFull.includes(
      setName
    )
  ) {
    return (
      900 +
      setName.length
    );
  }

  if (
    setCode &&
    normalizedFull
      .split(" ")
      .includes(setCode)
  ) {
    return (
      880 +
      setCode.length
    );
  }

  if (
    normalizedPiece ===
      setName ||
    normalizedPiece ===
      setCode
  ) {
    return (
      800 +
      normalizedPiece.length
    );
  }

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
    setCode.includes(
      normalizedPiece
    )
  ) {
    return (
      490 +
      normalizedPiece.length
    );
  }

  return 0;
}

function isConfidentSetMatch(
  query: string,
  candidate: SetCandidate
) {
  const normalizedQuery =
    normalizeText(query);

  const setName =
    normalizeText(
      candidate.set.name || ""
    );

  const setCode =
    normalizeText(
      candidate.set.code || ""
    );

  if (!normalizedQuery) {
    return false;
  }

  // Exact set-name or set-code search.
  if (
    normalizedQuery === setName ||
    normalizedQuery === setCode
  ) {
    return true;
  }

  // A complete multi-word set name appearing in the query is
  // strong enough to interpret as a set-qualified card search.
  if (
    setName &&
    setName.includes(" ") &&
    normalizedQuery.includes(setName)
  ) {
    return true;
  }

  // Set codes are intentionally compact identifiers. Require the
  // code to appear as its own token rather than as a substring.
  if (
    setCode &&
    normalizedQuery
      .split(" ")
      .includes(setCode)
  ) {
    return true;
  }

  return false;
}

function extractCardText(
  query: string,
  candidate: SetCandidate
) {
  const queryWords =
    normalizeText(query)
      .split(" ")
      .filter(Boolean);

  const setWords =
    normalizeText(
      candidate.set.name ||
        candidate.sourceQuery
    )
      .split(" ")
      .filter(Boolean);

  const codeWords =
    normalizeText(
      candidate.set.code || ""
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
      ...codeWords,
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

function escapeLikePattern(
  value: string
) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

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
