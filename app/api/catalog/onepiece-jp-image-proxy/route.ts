import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only, tightly scoped image proxy for official Bandai Japanese card artwork.
// Install as app/api/catalog/onepiece-jp-image-proxy/route.ts.
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ ok: false, reason: "missing-url" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid-url" }, { status: 400 });
  }

  const allowedHost = target.hostname === "www.onepiece-cardgame.com" ||
    target.hostname === "onepiece-cardgame.com";
  const allowedPath = /^\/images\/cardlist\/card\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(target.pathname);
  if (target.protocol !== "https:" || !allowedHost || !allowedPath || target.username || target.password) {
    return NextResponse.json({ ok: false, reason: "unsupported-image-url" }, { status: 400 });
  }

  try {
    const response = await fetch(target.href, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; MintRadar/1.0)",
        Referer: "https://www.onepiece-cardgame.com/cardlist/",
      },
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json({ ok: false, reason: "upstream-image-unavailable", status: response.status }, { status: 502 });
    }
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(type)) {
      return NextResponse.json({ ok: false, reason: "upstream-not-image" }, { status: 502 });
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 8_000_000) {
      return NextResponse.json({ ok: false, reason: "image-too-large" }, { status: 502 });
    }
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 8_000_000) {
      return NextResponse.json({ ok: false, reason: "invalid-image-size" }, { status: 502 });
    }
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.warn("MintRadar Bandai image proxy failed", error);
    return NextResponse.json({ ok: false, reason: "image-proxy-failed" }, { status: 502 });
  }
}
