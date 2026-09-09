import { NextRequest, NextResponse } from "next/server";

const CARDSIGHT_IMAGE_BASE =
  "https://api.cardsight.ai/v1/images/cards";

function decodeBase64Image(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);

  if (!match) {
    throw new Error("Invalid image data returned by CardSight.");
  }

  const contentType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");

  return {
    contentType,
    buffer,
  };
}

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.CARDSIGHTAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "CardSight API key is not configured.",
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const cardId = searchParams.get("id")?.trim();

    if (!cardId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing CardSight card id.",
        },
        { status: 400 }
      );
    }

    const upstreamUrl =
      `${CARDSIGHT_IMAGE_BASE}/${encodeURIComponent(cardId)}` +
      "?format=json&default=true";

    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");

      console.error(
        "CardSight sports image request failed:",
        response.status,
        errorText
      );

      return NextResponse.json(
        {
          ok: false,
          error: "Unable to retrieve sports card image.",
          status: response.status,
        },
        { status: response.status }
      );
    }

    const payload = await response.json();

    if (!payload?.data || typeof payload.data !== "string") {
      return NextResponse.json(
        {
          ok: false,
          error: "CardSight returned no image data.",
        },
        { status: 404 }
      );
    }

    const { contentType, buffer } = decodeBase64Image(payload.data);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType || "image/jpeg",
        "Content-Length": buffer.length.toString(),
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("Sports image route error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Unexpected error retrieving sports card image.",
      },
      { status: 500 }
    );
  }
}