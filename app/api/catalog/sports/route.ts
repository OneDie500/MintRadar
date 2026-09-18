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

    const params =
      new URLSearchParams();

    params.set(
      "q",
      query
    );

    params.set(
      "take",
      String(pageSize)
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

    const raw:
      CardSightSearchResponse =
      await response.json();

    if (!response.ok) {
      console.error(
        "CardSight API error:",
        response.status,
        raw
      );

      return NextResponse.json(
        {
          error:
            "Sports catalog search failed.",
          results: [],
          raw,
        },
        {
          status:
            response.status,
        }
      );
    }

    const rawResults =
      Array.isArray(
        raw?.results
      )
        ? raw.results
        : [];

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

    const results =
      rankedCardResults.map(
        (card) => {
          const cardId =
            card.id ||
            createFallbackId(
              card
            );

          const parallel =
            cleanValue(
              card.parallelName
            );

          return {
            external_id:
              cardId,

            data_source:
              "cardsight",

            name:
              cleanValue(
                card.name
              ) ||
              "Unknown Sports Card",

            set_name:
              cleanValue(
                card.setName
              ),

            set_id:
              null,

            card_number:
              cleanValue(
                card.cardNumber
              ),

            image_url:
              card.id
                ? `/api/catalog/sports/image/${encodeURIComponent(
                    card.id
                  )}`
                : null,

            category:
              "Sports",

            rarity:
              null,

            edition:
              null,

            // MintRadar uses finish as its
            // shared cross-category variant
            // field. Sports parallels belong
            // here as well.
            finish:
              parallel,

            illustrator:
              null,

            year:
              cleanValue(
                card.year
              ),

            manufacturer:
              cleanValue(
                card.manufacturerName
              ),

            release_name:
              cleanValue(
                card.releaseName
              ),

            // Preserve CardSight's provider-
            // specific field too. This is
            // useful for Sports-specific UI,
            // debugging, and future matching.
            parallel_name:
              parallel,

            sport:
              cleanValue(
                card.segmentName
              ),

            print_run:
              normalizePrintRun(
                card.numberedTo
              ),

            rookie:
              typeof card.rookie ===
                "boolean"
                ? card.rookie
                : typeof card.isRookie ===
                  "boolean"
                ? card.isRookie
                : null,
          };
        }
      );

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
