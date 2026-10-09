import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOST = "www.onepiece-cardgame.com";
const ALLOWED_PATH_PREFIX = "/images/cardlist/card/";

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url")?.trim();

  if (!rawUrl) {
    return NextResponse.json(
      { error: "Missing image URL." },
      { status: 400 }
    );
  }

  let imageUrl: URL;

  try {
    imageUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json(
      { error: "Invalid image URL." },
      { status: 400 }
    );
  }

  if (
    imageUrl.protocol !== "https:" ||
    imageUrl.hostname !== ALLOWED_HOST ||
    !imageUrl.pathname.startsWith(ALLOWED_PATH_PREFIX)
  ) {
    return NextResponse.json(
      { error: "Image host or path is not allowed." },
      { status: 403 }
    );
  }

  try {
    const upstream = await fetch(imageUrl.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; MintRadar/1.0; +https://mintradar.app)",
        Referer: "https://www.onepiece-cardgame.com/",
      },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: "One Piece image upstream request failed.",
          upstreamStatus: upstream.status,
        },
        { status: upstream.status }
      );
    }

    const contentType =
      upstream.headers.get("content-type") || "image/png";

    if (!contentType.toLowerCase().startsWith("image/")) {
      return NextResponse.json(
        { error: "Upstream response was not an image." },
        { status: 502 }
      );
    }

    const imageBytes = await upstream.arrayBuffer();

    return new NextResponse(imageBytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("One Piece image proxy error:", error);

    return NextResponse.json(
      { error: "Could not load One Piece image." },
      { status: 502 }
    );
  }
}
