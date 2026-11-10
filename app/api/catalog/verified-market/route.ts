
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

function reply(reason: string, status = 200) {
  return NextResponse.json(
    { ok: false, reason },
    { status, headers: noStore }
  );
}

type CardRow = {
  id: string;
  name: string | null;
  set_name: string | null;
  card_number: string | null;
  finish: string | null;
  variant: string | null;
  language: string | null;
  category: string | null;
};

type ProviderLink = {
  provider_product_id: string | null;
  product_url: string | null;
  match_status: string | null;
};

type PriceRow = {
  printing?: string | null;
  market_price?: number | null;
  low_price?: number | null;
  market_price_as_of?: string | null;
  last_updated_at?: string | null;
};

function printingKind(value: string | null | undefined): string {
  const v = (value || "").toLowerCase().trim();

  if (!v) return "unknown";
  if (/reverse/.test(v)) return "reverse";
  if (/master\s*ball/.test(v)) return "master-ball";
  if (/pok[eé]\s*ball/.test(v)) return "poke-ball";
  if (/cosmos/.test(v)) return "cosmos";
  if (/etched/.test(v)) return "etched";
  if (/stamped/.test(v)) return "stamped";
  if (/parallel/.test(v)) return "parallel";
  if (/non[\s-]?holo|non[\s-]?foil|normal|regular|standard/.test(v))
    return "normal";
  if (/holo|foil/.test(v)) return "holo";

  return "unknown";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

function isValidProductUrl(value: string | null): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "www.tcgplayer.com" &&
      /^\/product\/\d+(?:\/.*)?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  // TCG API evaluation is restricted to local development.
  if (process.env.NODE_ENV !== "development") {
    return reply("Market pricing is not available.", 403);
  }

  const cardId = (req.nextUrl.searchParams.get("card_id") || "").trim();

  // Never accept a provider product ID from the browser.
  if (!isUuid(cardId)) {
    return reply("A valid catalog card UUID is required.", 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key = process.env.TCG_API_KEY;

  if (!url || !service || !key) {
    return reply("Market pricing is not configured.", 503);
  }

  const db = createClient(url, service, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: card, error: cardError } = await db
    .from("cards")
    .select(
      "id,name,set_name,card_number,finish,variant,language,category"
    )
    .eq("id", cardId)
    .maybeSingle();

  if (cardError) {
    return reply("Catalog lookup is temporarily unavailable.", 503);
  }

  if (!card) {
    return reply("This card has no verified market mapping yet.");
  }

  const catalog = card as CardRow;

  if (
    catalog.category?.toLowerCase() !== "pokemon" ||
    catalog.language?.toUpperCase() !== "EN"
  ) {
    return reply(
      "Verified market pricing is currently available for English Pokémon cards only."
    );
  }

  const kind = printingKind(catalog.finish || catalog.variant);

  if (kind === "unknown") {
    return reply("Exact printing is not recorded for this card.");
  }

  const { data: links, error: linkError } = await db
    .from("card_provider_links")
    .select("provider_product_id,product_url,match_status")
    .eq("card_id", catalog.id)
    .eq("provider", "tcgapi")
    .eq("match_status", "verified")
    .limit(2);

  if (linkError) {
    return reply("Verified mapping lookup is temporarily unavailable.", 503);
  }

  // Refuse missing or ambiguous verified mappings.
  if (!links || links.length !== 1) {
    return reply(
      links && links.length > 1
        ? "Multiple verified provider mappings require review."
        : "No verified TCG API mapping yet. Check market comps below."
    );
  }

  const link = links[0] as ProviderLink;
  const providerId = String(link.provider_product_id || "");

  if (!/^\d{1,12}$/.test(providerId) || Number(providerId) <= 0) {
    return reply("Verified provider ID is invalid.");
  }

  try {
    const response = await fetch(
      `https://api.tcgapi.dev/v1/cards/${providerId}/prices`,
      {
        headers: { "X-API-Key": key },
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      }
    );

    if (!response.ok) {
      return reply("Market pricing is temporarily unavailable.", 502);
    }

    const json: unknown = await response.json();

    const data =
      json && typeof json === "object" && "data" in json
        ? (json as { data: unknown }).data
        : null;

    const rows: PriceRow[] = Array.isArray(data)
      ? (data as PriceRow[])
      : data && typeof data === "object"
        ? [data as PriceRow]
        : [];

    const exact = rows.filter(
      (row) =>
        printingKind(row.printing) === kind &&
        typeof row.market_price === "number" &&
        Number.isFinite(row.market_price) &&
        row.market_price >= 0
    );

    // Never guess when the exact printing is ambiguous.
    if (exact.length !== 1) {
      return reply(
        "No unambiguous market price is available for this exact printing."
      );
    }

    const selected = exact[0];

    const productUrl = isValidProductUrl(link.product_url)
      ? link.product_url
      : null;

    return NextResponse.json(
      {
        ok: true,
        price: {
          market_price: selected.market_price,
          low_price:
            typeof selected.low_price === "number" &&
            Number.isFinite(selected.low_price) &&
            selected.low_price >= 0
              ? selected.low_price
              : null,
          printing: selected.printing,
          as_of:
            selected.market_price_as_of ||
            selected.last_updated_at ||
            null,
          product_url: productUrl,
        },
      },
      { headers: noStore }
    );
  } catch (error) {
    console.error(
      "[MintRadar verified market]",
      error instanceof Error ? error.message : error
    );

    return reply("Market pricing is temporarily unavailable.", 502);
  }
}
