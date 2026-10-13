import { createClient } from "@supabase/supabase-js";
import {
  NextRequest,
  NextResponse,
} from "next/server";

type CardSightSearchResult = {
  type?: string;
  id?: string;
  name?: string;
  relevance?: number;
  year?: string | null;
  setName?: string | null;
  releaseName?: string | null;
  manufacturerName?: string | null;
  parallelName?: string | null;
  segmentName?: string | null;
  cardNumber?: string | null;
  numberedTo?: number | null;
  rookie?: boolean | null;
  isRookie?: boolean | null;
};

type CardSightSearchResponse = {
  results?: CardSightSearchResult[];
  total_count?: number;
  skip?: number;
  take?: number;
};

type CardSightSearchAttempt = {
  query: string;
  raw: CardSightSearchResponse;
  rawResults: CardSightSearchResult[];
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

    const pageSize = 20;

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

    const apiKey =
      process.env
        .CARDSIGHTAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "CARDSIGHTAI_API_KEY is missing from .env.local",
          results: [],
        },
        {
          status: 500,
        }
      );
    }

    const skip =
      (page - 1) *
      pageSize;

    // -----------------------------------------
    // CARDSIGHT PROGRESSIVE SEARCH
    // -----------------------------------------
    //
    // CardSight can return zero results when a
    // sports query becomes too specific even when
    // it knows the exact card/parallel.
    //
    // Try the user's exact query first. If that
    // produces no usable cards, progressively
    // simplify the query while preserving the
    // strongest identifying terms.
    //
    // Example:
    // "Bo Nix Yellow Surge Refractor 125"
    //   -> exact query
    //   -> "Bo Nix Yellow Surge Refractor"
    //   -> "Bo Nix Yellow Surge"
    //   -> "Bo Nix"
    // -----------------------------------------

    const searchQueries =
      buildSportsSearchQueries(
        query
      );

    let searchAttempt:
      CardSightSearchAttempt | null =
      null;

    for (
      const candidateQuery
      of searchQueries
    ) {
      const attempt =
        await searchCardSight(
          candidateQuery,
          apiKey,
          pageSize,
          skip
        );

      const usableResults =
        attempt.rawResults.filter(
          (card) => {
            const validType =
              !card.type ||
              card.type ===
                "card";

            return (
              validType &&
              !isChecklistCard(
                card
              )
            );
          }
        );

      if (
        usableResults.length >
        0
      ) {
        searchAttempt =
          attempt;
        break;
      }

      // Keep the latest successful API response
      // so a legitimate zero-result search still
      // returns cleanly if every fallback misses.
      searchAttempt =
        attempt;
    }

    if (!searchAttempt) {
      return NextResponse.json({
        query,
        resolvedQuery:
          query,
        fallbackUsed:
          false,
        page,
        pageSize,
        count: 0,
        total: 0,
        hasMore:
          false,
        results: [],
      });
    }

    const raw =
      searchAttempt.raw;

    const rawResults =
      searchAttempt
        .rawResults;

    const resolvedQuery =
      searchAttempt.query;

    const fallbackUsed =
      normalizeSearchText(
        resolvedQuery
      ) !==
      normalizeSearchText(
        query
      );

    // -----------------------------------------
    // SPORTS RESULT QUALITY FILTER
    // -----------------------------------------

    const cardResults =
      rawResults.filter(
        (card) => {
          const validType =
            !card.type ||
            card.type ===
              "card";

          if (!validType) {
            return false;
          }

          if (
            isChecklistCard(
              card
            )
          ) {
            return false;
          }

          return true;
        }
      );

    // -----------------------------------------
    // MINT RADAR SPORTS RANKING
    // -----------------------------------------
    //
    // CardSight knows about sports parallels,
    // but its provider ranking can still place
    // the base card above the exact parallel
    // requested by the user.
    //
    // Example:
    // "Bo Nix Yellow Surge Refractor 125"
    //
    // Base Set #125 and Yellow Surge #125 are
    // different collectibles. Promote records
    // whose parallelName is actually present
    // in the user's search.
    // -----------------------------------------

    const rankedCardResults =
      [...cardResults].sort(
        (a, b) =>
          scoreSportsResult(
            b,
            query
          ) -
          scoreSportsResult(
            a,
            query
          )
      );

    // Query approved, permission-cleared raw images once per result page.
    // If the registry is empty or unavailable, base cards retain CardSight artwork;
    // non-base parallels display a placeholder instead of incorrect base art.
    const approvedImages = await loadVerifiedSportsImages(rankedCardResults);

    const results = rankedCardResults.map((card) => {
      const cardId = card.id || createFallbackId(card);
      const parallel = cleanValue(card.parallelName);
      const verifiedImage = findVerifiedSportsImage(card, approvedImages);
      const cardSightBaseImage = card.id && isBaseSportsCard(parallel)
        ? `/api/catalog/sports/image/${encodeURIComponent(card.id)}`
        : null;

      return {
        external_id: cardId,
        data_source: "cardsight",
        name: cleanValue(card.name) || "Unknown Sports Card",
        set_name: cleanValue(card.setName),
        set_id: null,
        card_number: cleanValue(card.cardNumber),
        image_url: verifiedImage ?? cardSightBaseImage,
        category: "Sports",
        rarity: null,
        edition: null,
        finish: parallel,
        illustrator: null,
        year: cleanValue(card.year),
        manufacturer: cleanValue(card.manufacturerName),
        release_name: cleanValue(card.releaseName),
        parallel_name: parallel,
        sport: cleanValue(card.segmentName),
        print_run: normalizePrintRun(card.numberedTo),
        rookie: typeof card.rookie === "boolean"
          ? card.rookie
          : typeof card.isRookie === "boolean"
            ? card.isRookie
            : null,
      };
    });

    const total =
      typeof raw.total_count ===
      "number"
        ? raw.total_count
        : results.length;

    const hasMore =
      skip +
        rawResults.length <
      total;

    return NextResponse.json({
      query,
      resolvedQuery,
      fallbackUsed,
      page,
      pageSize,
      count:
        results.length,
      total,
      hasMore,
      results,
    });
  } catch (error) {
    console.error(
      "MintRadar Sports catalog error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while searching the Sports catalog.",
        results: [],
      },
      {
        status: 500,
      }
    );
  }
}

// =============================================
// CARDSIGHT SEARCH HELPERS
// =============================================

async function searchCardSight(
  query:
    string,
  apiKey:
    string,
  take:
    number,
  skip:
    number
): Promise<CardSightSearchAttempt> {
  const params =
    new URLSearchParams();

  params.set(
    "q",
    query
  );

  params.set(
    "take",
    String(take)
  );

  params.set(
    "skip",
    String(skip)
  );

  params.set(
    "type",
    "card"
  );

  const url =
    `https://api.cardsight.ai/v1/catalog/search?${params.toString()}`;

  const response =
    await fetch(
      url,
      {
        cache:
          "no-store",

        headers: {
          Accept:
            "application/json",

          "X-API-Key":
            apiKey,

          "User-Agent":
            "MintRadar/0.1",
        },
      }
    );

  let raw:
    CardSightSearchResponse;

  try {
    raw =
      await response.json();
  } catch {
    raw = {
      results: [],
    };
  }

  if (!response.ok) {
    console.error(
      "CardSight API error:",
      response.status,
      raw
    );

    throw new Error(
      `CardSight sports search failed with status ${response.status}.`
    );
  }

  const rawResults =
    Array.isArray(
      raw?.results
    )
      ? raw.results
      : [];

  return {
    query,
    raw,
    rawResults,
  };
}

function buildSportsSearchQueries(
  query:
    string
) {
  const cleaned =
    query
      .trim()
      .replace(
        /\s+/g,
        " "
      );

  if (!cleaned) {
    return [];
  }

  const tokens =
    cleaned
      .split(" ")
      .filter(Boolean);

  const candidates:
    string[] = [];

  const addCandidate = (
    value:
      string
  ) => {
    const candidate =
      value
        .trim()
        .replace(
          /\s+/g,
          " "
        );

    if (!candidate) {
      return;
    }

    const normalized =
      normalizeSearchText(
        candidate
      );

    if (
      !normalized ||
      candidates.some(
        (existing) =>
          normalizeSearchText(
            existing
          ) ===
          normalized
      )
    ) {
      return;
    }

    candidates.push(
      candidate
    );
  };

  // Always respect the user's exact search first.
  addCandidate(
    cleaned
  );

  // Card numbers are useful for MintRadar's own
  // ranking, but CardSight can become overly
  // restrictive when they are included in a long
  // free-text query. Try the same query without
  // standalone numeric/card-number tokens.
  if (
    tokens.length >
    2
  ) {
    addCandidate(
      tokens
        .filter(
          (token) =>
            !isLikelyCardNumberToken(
              token
            )
        )
        .join(" ")
    );
  }

  // "Refractor" is often implied by the provider's
  // parallel metadata. CardSight may index a
  // parallel as "Yellow Surge" even when collectors
  // naturally search "Yellow Surge Refractor".
  if (
    tokens.some(
      (token) =>
        normalizeSearchText(
          token
        ) ===
        "refractor"
    )
  ) {
    addCandidate(
      tokens
        .filter(
          (token) =>
            normalizeSearchText(
              token
            ) !==
            "refractor"
        )
        .join(" ")
    );
  }

  // If both a number and "Refractor" were present,
  // remove both before widening further.
  if (
    tokens.length >
    2
  ) {
    addCandidate(
      tokens
        .filter(
          (token) => {
            const normalized =
              normalizeSearchText(
                token
              );

            return (
              normalized !==
                "refractor" &&
              !isLikelyCardNumberToken(
                token
              )
            );
          }
        )
        .join(" ")
    );
  }

  // Progressive right-side reduction catches
  // provider search quirks without immediately
  // collapsing to a broad player-only search.
  //
  // Keep at least two tokens so "Bo Nix" remains
  // intact rather than widening all the way to "Bo".
  for (
    let length =
      tokens.length - 1;
    length >= 2;
    length -= 1
  ) {
    addCandidate(
      tokens
        .slice(
          0,
          length
        )
        .join(" ")
    );
  }

  return candidates;
}

function isLikelyCardNumberToken(
  token:
    string
) {
  const normalized =
    token
      .trim()
      .replace(
        /^#/,
        ""
      );

  if (!normalized) {
    return false;
  }

  // Handles common collector numbers such as:
  // 125, #125, RC12, 12A, 12/99.
  return (
    /^\d+$/.test(
      normalized
    ) ||
    /^\d+\/\d+$/.test(
      normalized
    ) ||
    /^(?=.*\d)[a-z0-9-]+$/i.test(
      normalized
    )
  );
}

// =============================================
// SPORTS RESULT RANKING
// =============================================

function scoreSportsResult(
  card:
    CardSightSearchResult,
  query:
    string
) {
  const normalizedQuery =
    normalizeSearchText(
      query
    );

  const queryTokens =
    new Set(
      normalizedQuery
        .split(" ")
        .filter(Boolean)
    );

  const normalizedName =
    normalizeSearchText(
      card.name
    );

  const normalizedNumber =
    normalizeSearchText(
      card.cardNumber
    );

  const normalizedParallel =
    normalizeSearchText(
      card.parallelName
    );

  const normalizedSet =
    normalizeSearchText(
      card.setName
    );

  const normalizedRelease =
    normalizeSearchText(
      card.releaseName
    );

  let score =
    typeof card.relevance ===
      "number" &&
    Number.isFinite(
      card.relevance
    )
      ? card.relevance
      : 0;

  // Player/card name is still important.
  if (
    normalizedName &&
    normalizedQuery.includes(
      normalizedName
    )
  ) {
    score += 350;
  } else if (
    normalizedName
  ) {
    const nameTokens =
      normalizedName
        .split(" ")
        .filter(Boolean);

    const matchingNameTokens =
      nameTokens.filter(
        (token) =>
          queryTokens.has(
            token
          )
      ).length;

    score +=
      matchingNameTokens *
      60;
  }

  // Strongly respect an explicitly searched
  // collector/card number.
  if (
    normalizedNumber &&
    queryTokens.has(
      normalizedNumber
    )
  ) {
    score += 300;
  }

  // This is the key parallel-aware behavior.
  // If the full provider parallel appears in
  // the query, heavily promote it.
  if (
    normalizedParallel
  ) {
    if (
      normalizedQuery.includes(
        normalizedParallel
      )
    ) {
      score += 1200;
    } else {
      const parallelTokens =
        normalizedParallel
          .split(" ")
          .filter(Boolean);

      const matchingParallelTokens =
        parallelTokens.filter(
          (token) =>
            queryTokens.has(
              token
            )
        ).length;

      if (
        matchingParallelTokens >
        0
      ) {
        const coverage =
          matchingParallelTokens /
          parallelTokens.length;

        score +=
          matchingParallelTokens *
          100;

        score +=
          coverage *
          350;
      }
    }
  }

  // Smaller contextual boosts for product/set
  // terms when the user includes them.
  score +=
    countMatchingTokens(
      normalizedSet,
      queryTokens
    ) * 25;

  score +=
    countMatchingTokens(
      normalizedRelease,
      queryTokens
    ) * 35;

  return score;
}

function countMatchingTokens(
  normalizedValue:
    string,
  queryTokens:
    Set<string>
) {
  if (!normalizedValue) {
    return 0;
  }

  return normalizedValue
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        queryTokens.has(
          token
        )
    ).length;
}

// =============================================
// SPORTS CHECKLIST FILTER
// =============================================

function isChecklistCard(
  card:
    CardSightSearchResult
) {
  const searchableText =
    [
      card.name,
      card.setName,
      card.releaseName,
      card.parallelName,
    ]
      .map(
        normalizeSearchText
      )
      .filter(Boolean)
      .join(" ");

  if (!searchableText) {
    return false;
  }

  return /\bcheck\s*lists?\b/i.test(
    searchableText
  );
}

function normalizeSearchText(
  value:
    | string
    | null
    | undefined
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

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

function cleanValue(
  value:
    | string
    | null
    | undefined
) {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const cleaned =
    value.trim();

  return cleaned ||
    null;
}

function normalizePrintRun(
  value:
    | number
    | null
    | undefined
) {
  if (
    typeof value !==
    "number"
  ) {
    return null;
  }

  if (
    !Number.isFinite(
      value
    ) ||
    value <= 0
  ) {
    return null;
  }

  return Math.floor(
    value
  );
}

function createFallbackId(
  card:
    CardSightSearchResult
) {
  const raw =
    [
      card.year,
      card.manufacturerName,
      card.releaseName,
      card.setName,
      card.name,
      card.cardNumber,
      card.parallelName,
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

  return (
    `cardsight-${slug}` ||
    "cardsight-unknown"
  );
}

// =============================================
// VERIFIED SPORTS IMAGE LOOKUP
// =============================================
type VerifiedSportsImage = {
  card_name: string;
  year: string | null;
  manufacturer: string | null;
  release_name: string | null;
  set_name: string | null;
  card_number: string | null;
  parallel_name: string | null;
  print_run: number | null;
  image_url: string;
};

function isBaseSportsCard(parallel: string | null): boolean {
  const value = normalizeSearchText(parallel);
  return value === "" || value === "base" || value === "base set";
}

async function loadVerifiedSportsImages(
  cards: CardSightSearchResult[]
): Promise<VerifiedSportsImage[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || cards.length === 0) return [];

  const numbers = [...new Set(cards.map((card) => cleanValue(card.cardNumber)).filter(
    (number): number is string => number !== null
  ))];
  if (numbers.length === 0) return [];

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from("sports_card_images")
      .select("card_name,year,manufacturer,release_name,set_name,card_number,parallel_name,print_run,image_url")
      .eq("image_type", "raw")
      .eq("verification_status", "verified")
      .in("usage_permission", ["granted", "licensed"])
      .in("card_number", numbers)
      .limit(1000);

    if (error) {
      console.error("MintRadar verified sports images lookup failed:", error);
      return [];
    }
    return (data ?? []) as VerifiedSportsImage[];
  } catch (error) {
    console.error("MintRadar verified sports images unavailable:", error);
    return [];
  }
}

function findVerifiedSportsImage(
  card: CardSightSearchResult,
  images: VerifiedSportsImage[]
): string | null {
  const same = (a: string | null | undefined, b: string | null | undefined) =>
    normalizeSearchText(a) === normalizeSearchText(b);

  const matching = images.filter((image) => {
    if (!same(image.card_name, card.name)) return false;
    if (!same(image.year, card.year)) return false;
    if (!same(image.manufacturer, card.manufacturerName)) return false;
    if (!same(image.release_name, card.releaseName)) return false;
    if (!same(image.set_name, card.setName)) return false;
    if (!same(image.card_number, card.cardNumber)) return false;
    if (!same(image.parallel_name, card.parallelName)) return false;
    if (image.print_run !== normalizePrintRun(card.numberedTo)) return false;
    try {
      return new URL(image.image_url).protocol === "https:";
    } catch {
      return false;
    }
  });

  // Refuse ambiguous matches rather than selecting an arbitrary image.
  const urls = [...new Set(matching.map((image) => image.image_url))];
  return urls.length === 1 ? urls[0] : null;
}
