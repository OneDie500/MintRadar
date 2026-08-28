import { NextRequest, NextResponse } from "next/server";

type ScryfallCard = {
  id?: string;
  name?: string;
  set_name?: string;
  collector_number?: string;
  rarity?: string;
  finishes?: string[];
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

type ScryfallResponse = {
  object?: string;
  total_cards?: number;
  has_more?: boolean;
  next_page?: string | null;
  data?: ScryfallCard[];
  details?: string;
};

export async function GET(request: NextRequest) {
  try {
    const searchParams =
      request.nextUrl.searchParams;

    const query =
      searchParams.get("q")?.trim();

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

    const params =
      new URLSearchParams();

    params.set("q", query);
    params.set(
      "page",
      String(page)
    );
    params.set(
      "unique",
      "prints"
    );
    params.set(
      "order",
      "name"
    );

    const url =
      `https://api.scryfall.com/cards/search?${params.toString()}`;

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

    const data: ScryfallResponse =
      await response.json();

    if (!response.ok) {
      console.error(
        "Scryfall search error:",
        response.status,
        data?.details
      );

      return NextResponse.json(
        {
          error:
            data?.details ||
            "Scryfall catalog search failed.",
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

    const results =
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

        const finish =
          normalizeFinish(
            card.finishes
          );

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
            null,

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

          edition:
            null,

          finish,

          illustrator:
            null,
        };
      });

    return NextResponse.json({
      query,
      page,
      count:
        results.length,
      total:
        data.total_cards ||
        results.length,
      hasMore:
        Boolean(
          data.has_more
        ),
      results,
    });
  } catch (error) {
    console.error(
      "MintRadar MTG catalog error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Something went wrong while searching the MTG catalog.",
        results: [],
      },
      {
        status: 500,
      }
    );
  }
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