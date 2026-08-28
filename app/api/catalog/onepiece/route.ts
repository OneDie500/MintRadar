import {
  NextRequest,
  NextResponse,
} from "next/server";

type OPTCGCard = {
  card_name?: string;
  card_set_id?: string;
  card_set_name?: string;
  card_rarity?: string;
  card_image?: string;
  card_image_id?: string;
  card_type?: string;
  card_color?: string;
  market_price?: number | string | null;

  // Keep these optional because the API's
  // returned objects can evolve.
  id?: number | string;
  card_id?: string;
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
        searchParams.get("page") || "1"
      );

    const page =
      Number.isFinite(requestedPage) &&
      requestedPage > 0
        ? Math.floor(requestedPage)
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
    // LOAD ONE PIECE CARD CATALOG
    // -----------------------------------------
    //
    // OPTCG API provides all set cards through
    // this endpoint. We fetch the catalog,
    // then normalize/filter it for MintRadar.
    //
    // Later we can move this into our own
    // scheduled cache so we're not repeatedly
    // requesting the full provider catalog.
    // -----------------------------------------

    const response =
      await fetch(
        "https://optcgapi.com/api/allSetCards/",
        {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "User-Agent":
              "MintRadar/0.1",
          },
        }
      );

    if (!response.ok) {
      const errorText =
        await response.text();

      console.error(
        "OPTCG API error:",
        response.status,
        errorText
      );

      return NextResponse.json(
        {
          error:
            "One Piece catalog search failed.",
          results: [],
        },
        {
          status:
            response.status,
        }
      );
    }

    const data =
      await response.json();

    const cards: OPTCGCard[] =
      Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.results)
        ? data.results
        : [];

    // -----------------------------------------
    // SEARCH
    // -----------------------------------------

    const cleanQuery =
      query.toLowerCase();

    const matchingCards =
      cards.filter((card) => {
        const searchable =
          [
            card.card_name,
            card.card_set_id,
            card.card_set_name,
            card.card_rarity,
            card.card_type,
            card.card_color,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        return searchable.includes(
          cleanQuery
        );
      });

    // -----------------------------------------
    // NORMALIZE INTO MINTRADAR
    // -----------------------------------------

    const normalized =
      matchingCards.map(
        (card, index) => {
          const name =
            card.card_name ||
            "Unknown One Piece Card";

          const cardNumber =
            card.card_set_id ||
            card.card_id ||
            null;

          const imageId =
            card.card_image_id ||
            null;

          return {
            external_id:
              createExternalId(
                card,
                index
              ),

            data_source:
              "optcgapi",

            name,

            set_name:
              card.card_set_name ||
              null,

            set_id:
              null,

            card_number:
              cardNumber,

            image_url:
              card.card_image ||
              null,

            category:
              "One Piece",

            rarity:
              card.card_rarity ||
              null,

            edition:
              null,

            finish:
              getVariant(
                name,
                imageId
              ),

            illustrator:
              null,
          };
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

    const results =
      normalized.slice(
        start,
        end
      );

    const hasMore =
      end <
      normalized.length;

    return NextResponse.json({
      query,
      page,
      pageSize,

      count:
        results.length,

      total:
        normalized.length,

      hasMore,

      results,
    });
  } catch (error) {
    console.error(
      "MintRadar One Piece catalog error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while searching the One Piece catalog.",
        results: [],
      },
      {
        status: 500,
      }
    );
  }
}

// =============================================
// EXTERNAL ID
// =============================================

function createExternalId(
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

  return (
    `optcg-${slug}` ||
    `optcg-card-${index}`
  );
}

// =============================================
// VARIANT
// =============================================

function getVariant(
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

  // OPTCG uses image IDs such as
  // OP01-001_p1 for variant artwork.
  if (
    imageId &&
    /_p\d+$/i.test(imageId)
  ) {
    return "Alternate Art";
  }

  return null;
}