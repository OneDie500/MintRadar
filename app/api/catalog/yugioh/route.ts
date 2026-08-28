import {
  NextRequest,
  NextResponse,
} from "next/server";

type YGOCardSet = {
  set_name?: string;
  set_code?: string;
  set_rarity?: string;
  set_rarity_code?: string;
  set_price?: string;
};

type YGOCardImage = {
  id?: number;
  image_url?: string;
  image_url_small?: string;
  image_url_cropped?: string;
};

type YGOCard = {
  id?: number;
  name?: string;
  type?: string;
  frameType?: string;
  desc?: string;
  archetype?: string;
  card_sets?: YGOCardSet[];
  card_images?: YGOCardImage[];
};

type YGOResponse = {
  data?: YGOCard[];
  error?: string;
};

type CatalogResult = {
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

  illustrator: null;
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

    // -----------------------------------------
    // SEARCH YGOPRODECK
    // -----------------------------------------

    const params =
      new URLSearchParams();

    params.set(
      "fname",
      query
    );

    const url =
      `https://db.ygoprodeck.com/api/v7/cardinfo.php?${params.toString()}`;

    const response =
      await fetch(url, {
        cache: "no-store",
        headers: {
          Accept:
            "application/json",
          "User-Agent":
            "MintRadar/0.1",
        },
      });

    const data: YGOResponse =
      await response.json();

    if (!response.ok) {
      console.error(
        "YGOPRODeck search error:",
        response.status,
        data?.error
      );

      return NextResponse.json(
        {
          error:
            data?.error ||
            "Yu-Gi-Oh! catalog search failed.",
          results: [],
        },
        {
          status:
            response.status,
        }
      );
    }

    const cards =
      data.data || [];

    // -----------------------------------------
    // FLATTEN SET PRINTINGS
    // -----------------------------------------
    //
    // One Yu-Gi-Oh! card can appear in
    // many sets / rarities.
    //
    // MintRadar wants the vendor to choose
    // the EXACT printing, so we turn each
    // card + set appearance into its own
    // searchable result.
    // -----------------------------------------

    const flattenedResults:
      CatalogResult[] = [];

    cards.forEach(
      (card) => {
        const image =
          card.card_images?.[0];

        const sets =
          card.card_sets || [];

        // If there is no set data,
        // still return the base card.
        if (sets.length === 0) {
          flattenedResults.push({
            external_id:
              `ygo-${card.id}`,

            data_source:
              "ygoprodeck",

            name:
              card.name || null,

            set_name:
              null,

            set_id:
              null,

            card_number:
              card.id
                ? String(card.id)
                : null,

            image_url:
              image?.image_url ||
              image?.image_url_small ||
              null,

            category:
              "Yu-Gi-Oh!",

            rarity:
              card.type || null,

            edition:
              null,

            finish:
              null,

            illustrator:
              null,
          });

          return;
        }

        sets.forEach(
          (set) => {
            const externalId =
              createPrintingId(
                card.id,
                set.set_code,
                set.set_rarity
              );

            flattenedResults.push({
              external_id:
                externalId,

              data_source:
                "ygoprodeck",

              name:
                card.name || null,

              set_name:
                set.set_name ||
                null,

              set_id:
                set.set_code ||
                null,

              card_number:
                set.set_code ||
                null,

              image_url:
                image?.image_url ||
                image?.image_url_small ||
                null,

              category:
                "Yu-Gi-Oh!",

              rarity:
                set.set_rarity ||
                card.type ||
                null,

              edition:
                null,

              finish:
                normalizeFinish(
                  set.set_rarity
                ),

              illustrator:
                null,
            });
          }
        );
      }
    );

    // -----------------------------------------
    // PAGINATION
    // -----------------------------------------

    const start =
      (page - 1) *
      pageSize;

    const end =
      start + pageSize;

    const paginated =
      flattenedResults.slice(
        start,
        end
      );

    const hasMore =
      end <
      flattenedResults.length;

    return NextResponse.json({
      query,
      page,
      pageSize,

      count:
        paginated.length,

      total:
        flattenedResults.length,

      hasMore,

      results:
        paginated,
    });
  } catch (error) {
    console.error(
      "MintRadar Yu-Gi-Oh! catalog error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while searching the Yu-Gi-Oh! catalog.",
        results: [],
      },
      {
        status: 500,
      }
    );
  }
}

// =============================================
// UNIQUE PRINTING ID
// =============================================

function createPrintingId(
  cardId?: number,
  setCode?: string,
  rarity?: string
) {
  const cleanRarity =
    (rarity || "unknown")
      .toLowerCase()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      );

  return [
    "ygo",
    cardId || "unknown",
    setCode || "unknown",
    cleanRarity,
  ].join("-");
}

// =============================================
// FINISH / RARITY NORMALIZATION
// =============================================

function normalizeFinish(
  rarity?: string
) {
  if (!rarity) {
    return null;
  }

  const value =
    rarity.toLowerCase();

  if (
    value.includes(
      "ultimate"
    )
  ) {
    return "Ultimate Rare";
  }

  if (
    value.includes(
      "ghost"
    )
  ) {
    return "Ghost Rare";
  }

  if (
    value.includes(
      "starlight"
    )
  ) {
    return "Starlight Rare";
  }

  if (
    value.includes(
      "quarter century"
    )
  ) {
    return "Quarter Century Secret Rare";
  }

  if (
    value.includes(
      "secret"
    )
  ) {
    return "Secret Rare";
  }

  if (
    value.includes(
      "ultra"
    )
  ) {
    return "Ultra Rare";
  }

  if (
    value.includes(
      "super"
    )
  ) {
    return "Super Rare";
  }

  if (
    value.includes(
      "rare"
    )
  ) {
    return rarity;
  }

  return null;
}