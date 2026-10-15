import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OnePieceCard = {
  card_name?: string;
  card_set_id?: string;
  card_id?: string;
  card_set_name?: string;
  set_name?: string;
  card_image?: string;
  card_image_id?: string;
  language?: string;
  card_language?: string;
  region?: string;
};

const normalize = (value?: string | null) =>
  (value || "").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

function parseImportedName(raw: string) {
  let name = raw.trim();
  let parallel = false;
  let language: "JP" | "EN" | null = null;
  for (let i = 0; i < 8; i++) {
    const match = name.match(/\s*\(([^()]*)\)\s*$/);
    if (!match) break;
    const label = normalize(match[1]);
    if (["parallel", "alternateart", "altart", "aa", "fullart"].includes(label)) parallel = true;
    else if (["jp", "jpn", "japanese"].includes(label)) language = "JP";
    else if (["en", "eng", "english"].includes(label)) language = "EN";
    else break;
    name = name.slice(0, match.index).trim();
  }
  return { name, parallel, language };
}

function isParallel(card: OnePieceCard) {
  const name = card.card_name || "";
  const id = card.card_image_id || "";
  return /(?:alternate[\s_-]*art|parallel|alt[\s_-]*art)/i.test(name) ||
    /_p\d+(?:$|[^a-z0-9])/i.test(id);
}

function isExplicitJapanese(card: OnePieceCard) {
  const language = normalize(card.card_language || card.language || card.region);
  return ["jp", "jpn", "japanese", "ja", "japan"].includes(language);
}

function uniqueByImage(cards: OnePieceCard[]) {
  return Array.from(new Map(cards.filter(card => card.card_image?.trim())
    .map(card => [card.card_image!.trim(), card])).values());
}

// Display-only official JP artwork fallback for an English listing when the
// English provider has no eligible artwork. Requires one unique verified
// regular/parallel artwork; never guesses between multiple parallel prints.
async function officialJapaneseArtworkFallback(
  request: NextRequest, cardNumber: string, setName: string, wantsParallel: boolean
) {
  try {
    const url = new URL("/api/catalog/onepiece-jp-image", request.nextUrl.origin);
    url.searchParams.set("cardNumber", cardNumber);
    url.searchParams.set("setName", setName);
    url.searchParams.set("variant", wantsParallel ? "Parallel" : "Regular");
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("ok" in data) || data.ok !== true ||
        !("imageUrl" in data) || typeof data.imageUrl !== "string" ||
        !("artworkId" in data) || typeof data.artworkId !== "string") return null;
    const image = new URL(data.imageUrl);
    const exactId = cardNumber.trim().toUpperCase();
    if (!/^(?:[A-Z]{2}\d{2}-\d{3}|P-\d{3})$/.test(exactId)) return null;
    const expectedId = new RegExp(`^${exactId}${wantsParallel ? "_p[1-9][0-9]*" : ""}$`, "i");
    const filename = image.pathname.split("/").pop() || "";
    const artworkId = filename.replace(/\.png$/i, "");
    if (image.protocol !== "https:" || image.hostname !== "www.onepiece-cardgame.com" ||
        !image.pathname.startsWith("/images/cardlist/card/") ||
        !filename.toLowerCase().endsWith(".png") ||
        !expectedId.test(artworkId) ||
        data.artworkId.toUpperCase() !== artworkId.toUpperCase()) return null;
    return {
      ok: true, imageUrl: image.href, provider: "bandai-official-jp-cardlist",
      artworkId, imageLanguage: "JP", artworkVerified: true,
      regionalArtworkVerified: true, requestedJapanese: false,
      requestedParallel: wantsParallel, fallbackUsed: true,
      fallbackType: "official-jp-artwork-for-en-listing",
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawName = params.get("name")?.trim() || "";
  const number = params.get("cardNumber")?.trim() || "";
  const setName = params.get("setName")?.trim() || "";
  const variant = params.get("variant")?.trim() || "";
  const language = params.get("language")?.trim() || "";
  if (!rawName || !number) {
    return NextResponse.json({ ok: false, imageUrl: null, reason: "missing-identity" });
  }
  const parsed = parseImportedName(rawName);
  // Imported promo names may carry a printing label in square brackets.
  // Keep that label for exact artwork selection, but exclude it from name matching.
  const onePieceDayLuffy = number.toUpperCase() === "P-041" &&
    (/one\s*piece\s*day/i.test(variant) || /\[\s*one\s*piece\s*day\s*\]/i.test(parsed.name));
  if (onePieceDayLuffy) {
    parsed.name = parsed.name.replace(/\s*\[\s*one\s*piece\s*day\s*\]/ig, "").trim();
  }
  const wantsParallel = onePieceDayLuffy || parsed.parallel || ["parallel", "alternateart", "altart", "aa", "fullart"].includes(normalize(variant));
  // An explicit (JP) in the imported name takes precedence over a mistaken EN database field.
  const wantsJapanese = parsed.language === "JP" ||
    (parsed.language !== "EN" && ["jp", "jpn", "japanese", "ja"].includes(normalize(language)));

  // Japanese-first image lookup. This calls the separately tested official JP resolver.
  // If it fails, times out, or returns an ambiguous result, preserve the existing
  // OPTCG English/unverified-region artwork fallback below.
  let japaneseLookup: { ok: boolean; reason?: string; imageUrl?: string } | null = null;
  if (wantsJapanese) {
    try {
      const jpUrl = new URL("/api/catalog/onepiece-jp-image", request.nextUrl.origin);
      jpUrl.searchParams.set("name", rawName);
      jpUrl.searchParams.set("setName", setName);
      jpUrl.searchParams.set("cardNumber", number);
      jpUrl.searchParams.set("variant", onePieceDayLuffy ? "One Piece Day" : (wantsParallel ? "Parallel" : "Regular"));
      jpUrl.searchParams.set("language", "JP");
      const jpResponse = await fetch(jpUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (jpResponse.ok) {
        const data: unknown = await jpResponse.json();
        if (data && typeof data === "object" && "ok" in data &&
            "imageUrl" in data && data.ok === true &&
            typeof data.imageUrl === "string") {
          const candidate = new URL(data.imageUrl);
          // Accept only the official Japanese card image directory, never page assets.
          if (candidate.protocol === "https:" &&
              ["www.onepiece-cardgame.com", "onepiece-cardgame.com"].includes(candidate.hostname) &&
              /^\/images\/cardlist\/card\/(?:[A-Z]{2}\d{2}-\d{3}|P-\d{3})(?:_p\d+)?\.png$/i.test(candidate.pathname)) {
            const imageId = candidate.pathname.split("/").pop()!.replace(/\.png$/i, "");
            const isJapaneseParallel = /_p\d+$/i.test(imageId);
            if (isJapaneseParallel === wantsParallel &&
                (imageId.toUpperCase() === number.toUpperCase() ||
                  new RegExp(`^${number.toUpperCase()}_p[1-9][0-9]*$`, "i").test(imageId))) {
              japaneseLookup = { ok: true, imageUrl: candidate.href };
              if (params.get("debug") !== "1") {
                return NextResponse.json({
                  ok: true,
                  imageUrl: candidate.href,
                  provider: "bandai-official-jp-cardlist",
                  normalizedName: parsed.name,
                  requestedParallel: wantsParallel,
                  requestedJapanese: true,
                  artworkVerified: true,
                  regionalArtworkVerified: true,
                  imageLanguage: "JP",
                  fallbackUsed: false,
                  fallbackType: null,
                  artworkId: imageId,
                });
              }
            } else japaneseLookup = { ok: false, reason: "jp-artwork-identity-mismatch" };
          } else japaneseLookup = { ok: false, reason: "jp-image-url-not-allowed" };
        } else japaneseLookup = { ok: false, reason: "jp-lookup-no-verified-image" };
      } else japaneseLookup = { ok: false, reason: `jp-lookup-http-${jpResponse.status}` };
    } catch (error) {
      japaneseLookup = { ok: false, reason: error instanceof Error ? error.message : "jp-lookup-failed" };
    }
  }

  try {
    const upstream = await fetch("https://optcgapi.com/api/allSetCards/", {
      headers: { Accept: "application/json", "User-Agent": "MintRadar/0.1" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok) return NextResponse.json({ ok: false, imageUrl: null, reason: "upstream-unavailable" });
    const payload = await upstream.json();
    const cards: OnePieceCard[] = Array.isArray(payload) ? payload :
      Array.isArray(payload?.data) ? payload.data :
      Array.isArray(payload?.results) ? payload.results : [];

    const exact = cards.filter(card =>
      normalize(parseImportedName(card.card_name || "").name) === normalize(parsed.name) &&
      normalize(card.card_set_id || card.card_id) === normalize(number) &&
      Boolean(card.card_image?.trim())
    );
    const candidates = uniqueByImage(exact);
    const parallelCandidates = candidates.filter(isParallel);
    const regularCandidates = candidates.filter(card => !isParallel(card));
    const artworkCandidates = wantsParallel ? parallelCandidates : regularCandidates;
    const japaneseCandidates = artworkCandidates.filter(isExplicitJapanese);

    if (params.get("debug") === "1") {
      return NextResponse.json({
        ok: false, diagnostic: true, normalizedName: parsed.name,
        requestedNumber: number, requestedSet: setName,
        requestedLanguage: language, requestedJapanese: wantsJapanese,
        requestedParallel: wantsParallel, totalMatches: candidates.length,
        fallbackAvailable: wantsJapanese && japaneseCandidates.length === 0 && artworkCandidates.length === 1,
        japaneseLookup,
        candidates: candidates.slice(0, 30).map(card => ({
          card_name: card.card_name || null,
          card_set_id: card.card_set_id || null,
          set_name: card.set_name || card.card_set_name || null,
          card_image_id: card.card_image_id || null,
          card_image: card.card_image || null,
          card_language: card.card_language || card.language || card.region || null,
          parallelDetected: isParallel(card),
          japaneseVerified: isExplicitJapanese(card),
        })),
      });
    }

    if (!candidates.length) {
      // Do not change JP-first behavior or guess between alternate artworks.
      // English listings may use uniquely verified JP regular or parallel
      // artwork as a clearly-labeled display-only fallback.
      if (!wantsJapanese) {
        const regional = await officialJapaneseArtworkFallback(request, number, setName, wantsParallel);
        if (regional) return NextResponse.json({ ...regional, normalizedName: parsed.name });
      }
      return NextResponse.json({
        ok: false, imageUrl: null, reason: "exact-card-not-found",
        normalizedName: parsed.name, candidates: 0, setName,
      });
    }

    // Prefer verified Japanese artwork. When none is identified by this provider,
    // allow a matching alternate/regular English artwork as a DISPLAY-ONLY fallback.
    // The listing's stored language, set, variant, and card identity remain unchanged.
    const usingEnglishFallback = wantsJapanese && japaneseCandidates.length === 0;
    const eligible = wantsJapanese && japaneseCandidates.length > 0
      ? japaneseCandidates : artworkCandidates;
    if (eligible.length === 0 && !wantsJapanese) {
      const regional = await officialJapaneseArtworkFallback(request, number, setName, wantsParallel);
      if (regional) return NextResponse.json({ ...regional, normalizedName: parsed.name });
    }
    if (eligible.length !== 1) {
      const reason = !artworkCandidates.length
        ? "requested-artwork-not-found"
        : "ambiguous-artwork";
      return NextResponse.json({
        ok: false, imageUrl: null, reason,
        candidates: eligible.length,
        availableArtworks: artworkCandidates.length,
        normalizedName: parsed.name, setName,
        requestedParallel: wantsParallel, requestedJapanese: wantsJapanese,
      });
    }

    const imageUrl = eligible[0].card_image!.trim();
    if (!/^https:\/\//i.test(imageUrl)) return NextResponse.json({
      ok: false, imageUrl: null, reason: "invalid-image-url",
    });
    return NextResponse.json({
      ok: true, imageUrl, provider: "optcgapi-exact",
      normalizedName: parsed.name, requestedParallel: wantsParallel,
      requestedJapanese: wantsJapanese, artworkVerified: true,
      regionalArtworkVerified: wantsJapanese && !usingEnglishFallback ? true : null,
      imageLanguage: usingEnglishFallback ? "unverified" : (wantsJapanese ? "JP" : "unverified"),
      fallbackUsed: usingEnglishFallback,
      fallbackType: usingEnglishFallback ? "non-JP-verified-artwork" : null,
    });
  } catch (error) {
    console.error("One Piece image fallback failed", error);
    return NextResponse.json({ ok: false, imageUrl: null, reason: "lookup-failed" });
  }
}
