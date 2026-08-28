import {
  NextRequest,
  NextResponse,
} from "next/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type CardSightImageResponse = {
  data?: string;
  image?: string;
  imageData?: string;
  url?: string;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } =
      await context.params;

    const cleanId =
      id?.trim();

    if (!cleanId) {
      return NextResponse.json(
        {
          error:
            "Card ID is required.",
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
            "CARDSIGHTAI_API_KEY is missing.",
        },
        {
          status: 500,
        }
      );
    }

    const url =
      `https://api.cardsight.ai/v1/images/cards/${encodeURIComponent(
        cleanId
      )}?format=json`;

    const response =
      await fetch(
        url,
        {
          cache:
            "force-cache",

          headers: {
            Accept:
              "application/json",

            "X-API-Key":
              apiKey,

            "User-Agent":
              "MintRadar/0.1",
          },

          next: {
            revalidate:
              60 * 60 * 24 * 7,
          },
        }
      );

    const rawText =
      await response.text();

    if (!response.ok) {
      console.error(
        "CardSight image error:",
        response.status,
        cleanId,
        rawText
      );

      return NextResponse.json(
        {
          error:
            "Sports card image not found.",
          providerStatus:
            response.status,
        },
        {
          status:
            response.status === 404
              ? 404
              : 502,
        }
      );
    }

    let payload:
      CardSightImageResponse;

    try {
      payload =
        JSON.parse(rawText);
    } catch {
      console.error(
        "CardSight image endpoint returned non-JSON:",
        rawText.slice(
          0,
          500
        )
      );

      return NextResponse.json(
        {
          error:
            "CardSight returned an unexpected image response.",
        },
        {
          status: 502,
        }
      );
    }

    const imageValue =
      payload.data ||
      payload.image ||
      payload.imageData ||
      payload.url;

    if (!imageValue) {
      console.error(
        "CardSight image JSON did not contain image data:",
        payload
      );

      return NextResponse.json(
        {
          error:
            "CardSight did not return image data for this card.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      imageValue.startsWith(
        "data:"
      )
    ) {
      const parsed =
        parseDataUri(
          imageValue
        );

      if (!parsed) {
        return NextResponse.json(
          {
            error:
              "CardSight returned invalid image data.",
          },
          {
            status: 502,
          }
        );
      }

      return new NextResponse(
        parsed.bytes,
        {
          status: 200,

          headers: {
            "Content-Type":
              parsed.contentType,

            "Cache-Control":
              "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
          },
        }
      );
    }

    if (
      imageValue.startsWith(
        "http://"
      ) ||
      imageValue.startsWith(
        "https://"
      )
    ) {
      const imageResponse =
        await fetch(
          imageValue,
          {
            cache:
              "force-cache",

            next: {
              revalidate:
                60 *
                60 *
                24 *
                7,
            },
          }
        );

      if (
        !imageResponse.ok
      ) {
        return NextResponse.json(
          {
            error:
              "Card image URL could not be loaded.",
          },
          {
            status: 502,
          }
        );
      }

      const bytes =
        await imageResponse.arrayBuffer();

      const contentType =
        imageResponse.headers.get(
          "content-type"
        ) ||
        "image/jpeg";

      return new NextResponse(
        bytes,
        {
          status: 200,

          headers: {
            "Content-Type":
              contentType,

            "Cache-Control":
              "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
          },
        }
      );
    }

    return NextResponse.json(
      {
        error:
          "CardSight returned an unsupported image format.",
      },
      {
        status: 502,
      }
    );
  } catch (error) {
    console.error(
      "MintRadar Sports image proxy error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Could not load this Sports card image.",
      },
      {
        status: 500,
      }
    );
  }
}

function parseDataUri(
  value: string
) {
  const match =
    value.match(
      /^data:([^;,]+);base64,([\s\S]+)$/
    );

  if (!match) {
    return null;
  }

  const contentType =
    match[1];

  const base64 =
    match[2];

  try {
    const buffer =
      Buffer.from(
        base64,
        "base64"
      );

    const bytes =
      new Uint8Array(
        buffer
      );

    return {
      contentType,
      bytes,
    };
  } catch {
    return null;
  }
}
