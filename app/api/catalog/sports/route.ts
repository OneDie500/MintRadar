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
    //
    // CardSight can return sports checklist
    // cards when a customer searches a number
    // such as "151". Those results are not
    // useful for MintRadar's universal search,
    // so remove checklist-style cards here.
    //
    // IMPORTANT:
    // We are NOT blocking card number 151.
    // A real player card numbered 151 still
    // passes through normally.
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

    const results =
      cardResults.map(
        (card) => {
          const cardId =
            card.id ||
            createFallbackId(
              card
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

            finish:
              null,

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

            parallel_name:
              cleanValue(
                card.parallelName
              ),

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

    // Because MintRadar removes low-quality
    // checklist results after CardSight returns
    // them, use the provider's raw page length
    // when deciding whether more pages may exist.
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
// SPORTS CHECKLIST FILTER
// =============================================

function isChecklistCard(
  card:
    CardSightSearchResult
) {
  // CardSight can place checklist wording in
  // different fields depending on the record,
  // so inspect all descriptive Sports fields.
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

  // Handles:
  // Checklist
  // Check List
  // Checklists
  // Check Lists
  // Team Checklist
  // Series Checklists
  // "Checklist - AL"
  // punctuation/hyphen variations after
  // normalizeSearchText().
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
