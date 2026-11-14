
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CatalogCard = {
  id: string;
  name: string | null;
  set_name: string | null;
  card_number: string | null;
  language: string | null;
  category: string | null;
  finish: string | null;
  variant: string | null;
  edition: string | null;
};

type ApiCard = {
  id?: number;
  name?: string | null;
  set_name?: string | null;
  number?: string | number | null;
  printing?: string | null;
  tcgplayer_id?: number | null;
  set?: { name?: string | null } | null;
};

type PrintingKind =
  | "normal"
  | "holo"
  | "reverse"
  | "master-ball"
  | "poke-ball"
  | "cosmos"
  | "etched"
  | "stamped"
  | "parallel"
  | "unknown";

type PrintingAssessment = {
  kind: PrintingKind;
  special: boolean;
  reason: string | null;
};

const headers = {
  "Cache-Control": "private, no-store",
};

function reply(
  reason: string,
  status = 400,
  diagnostics?: Record<string, unknown>
) {
  return NextResponse.json(
    {
      ok: false,
      reason,
      ...(diagnostics ? { diagnostics } : {}),
    },
    { status, headers }
  );
}

function normalized(value: string | null | undefined) {
  return (value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function name(value: string | null | undefined) {
  return normalized(value);
}

function setName(value: string | null | undefined) {
  return normalized(value)
    .replace(
      /^(?:sv\d+[a-z]?|swsh\d+[a-z]?|sm|xy|bw|dp|pl|hgss)\s*[:\-–]\s*/i,
      ""
    )
    .replace(
      /^(?:scarlet\s*&\s*violet|sword\s*&\s*shield|sun\s*&\s*moon)\s*[:\-–]\s*/i,
      ""
    )
    .replace(/\s*&\s*/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function number(value: string | number | null | undefined) {
  const first = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .split("/")[0]
    .replace(/\s+/g, "")
    .toUpperCase();

  const match = /^([A-Z]*)(\d+)([A-Z]*)$/.exec(first);

  return match
    ? `${match[1]}${Number(match[2])}${match[3]}`
    : first;
}

function printingKind(
  value: string | null | undefined
): PrintingKind {
  const v = normalized(value);

  if (!v) return "unknown";

  if (/master[\s-]*ball/.test(v)) return "master-ball";
  if (/pok[eé][\s-]*ball/.test(v)) return "poke-ball";
  if (/cosmo(?:s)?/.test(v)) return "cosmos";
  if (/etch(?:ed|ing)?/.test(v)) return "etched";
  if (/stamp(?:ed)?/.test(v)) return "stamped";
  if (/parallel/.test(v)) return "parallel";
  if (/reverse/.test(v)) return "reverse";

  if (
    /non[\s-]?holo|non[\s-]?foil|normal|regular|standard/.test(v)
  ) {
    return "normal";
  }

  if (/holo|foil/.test(v)) return "holo";

  return "unknown";
}

function hasSpecialIdentity(
  value: string | null | undefined
) {
  const v = normalized(value);

  if (!v) return false;

  return (
    /(?:full[\s-]*art|alternate|alt[\s-]*art|illustration|secret[\s-]*rare)/.test(v) ||
    /(?:master[\s-]*ball|pok[eé][\s-]*ball|cosmo(?:s)?)/.test(v) ||
    /(?:etched|stamped|parallel|promo(?:tional)?)/.test(v) ||
    /(?:exclusive|special[\s-]*edition|first[\s-]*edition|1st[\s-]*edition)/.test(v) ||
    /(?:staff|prerelease|pre[\s-]*release|league|event[\s-]*stamp)/.test(v) ||
    /(?:holiday|calendar|championship|tournament)/.test(v) ||
    /(?:rainbow|gold[\s-]*foil|textured|cracked[\s-]*ice)/.test(v)
  );
}

function assessCatalogPrinting(
  card: CatalogCard
): PrintingAssessment {
  const fields = [
    { label: "finish", value: card.finish },
    { label: "variant", value: card.variant },
    { label: "edition", value: card.edition },
  ];

  // Special product identities cannot be reduced to generic
  // Holofoil, Reverse Holofoil, or Normal.
  for (const field of fields) {
    if (hasSpecialIdentity(field.value)) {
      return {
        kind: "unknown",
        special: true,
        reason:
          `Special identity in ${field.label} requires ` +
          "exact provider-variant evidence.",
      };
    }
  }

  const kinds = fields
    .filter((field) => Boolean(field.value?.trim()))
    .map((field) => ({
      label: field.label,
      kind: printingKind(field.value),
    }));

  if (!kinds.length) {
    return {
      kind: "unknown",
      special: false,
      reason: "Catalog printing is missing.",
    };
  }

  // Unknown nonempty variant or edition values must not be
  // silently ignored in favor of a generic finish.
  const unknown = kinds.find(
    (field) => field.kind === "unknown"
  );

  if (unknown) {
    return {
      kind: "unknown",
      special: false,
      reason:
        `Unrecognized ${unknown.label} prevents ` +
        "exact printing verification.",
    };
  }

  const unique = [
    ...new Set(kinds.map((field) => field.kind)),
  ];

  if (unique.length !== 1) {
    return {
      kind: "unknown",
      special: false,
      reason: "Catalog printing fields disagree.",
    };
  }

  return {
    kind: unique[0],
    special: false,
    reason: null,
  };
}

function identityMatches(
  card: CatalogCard,
  candidate: ApiCard
) {
  const providerSet =
    candidate.set_name || candidate.set?.name;

  return Boolean(
    name(card.name) &&
    name(card.name) === name(candidate.name) &&
    setName(card.set_name) &&
    setName(card.set_name) === setName(providerSet) &&
    number(card.card_number) &&
    number(card.card_number) === number(candidate.number)
  );
}

async function apiGet(
  path: string,
  apiKey: string
): Promise<unknown> {
  const response = await fetch(
    `https://api.tcgapi.dev/v1/${path}`,
    {
      headers: {
        "X-API-Key": apiKey,
      },
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(`TCG API HTTP ${response.status}`);
  }

  const json: unknown = await response.json();

  if (
    !json ||
    typeof json !== "object" ||
    !("data" in json)
  ) {
    throw new Error("TCG API data missing");
  }

  return (json as { data: unknown }).data;
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return reply("Development-only endpoint.", 403);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.TCG_API_KEY;

  const allowlist = new Set(
    (
      process.env.MINT_RADAR_CATALOG_APPROVER_IDS || ""
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );

  if (
    !url ||
    !anon ||
    !service ||
    !apiKey ||
    !allowlist.size
  ) {
    return reply(
      "Server approval configuration incomplete.",
      503
    );
  }

  const token = /^Bearer (.+)$/i.exec(
    req.headers.get("authorization") || ""
  )?.[1];

  if (!token) {
    return reply("Sign in required.", 401);
  }

  const auth = createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: userData, error: userError } =
    await auth.auth.getUser(token);

  if (userError || !userData.user) {
    return reply("Invalid session.", 401);
  }

  if (!allowlist.has(userData.user.id)) {
    return reply(
      "Not authorized to approve catalog mappings.",
      403
    );
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return reply("Invalid JSON.");
  }

  if (!body || typeof body !== "object") {
    return reply("Invalid request.");
  }

  const input = body as Record<string, unknown>;

  if (
    typeof input.cardId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      input.cardId
    ) ||
    typeof input.tcgapiId !== "number" ||
    !Number.isSafeInteger(input.tcgapiId) ||
    input.tcgapiId <= 0
  ) {
    return reply("Invalid card or provider ID.");
  }

  const db = createClient(url, service, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: cardData, error: cardError } =
    await db
      .from("cards")
      .select(
        "id,name,set_name,card_number,language,category,finish,variant,edition"
      )
      .eq("id", input.cardId)
      .maybeSingle();

  if (cardError || !cardData) {
    return reply("Catalog card not found.", 404);
  }

  const card = cardData as CatalogCard;

  if (
    card.language?.toUpperCase() !== "EN" ||
    card.category?.toLowerCase() !== "pokemon"
  ) {
    return reply(
      "Only English Pokémon cards are supported in V5."
    );
  }

  // Check for an existing mapping before attempting approval.
  const { data: existing, error: existingError } =
    await db
      .from("card_provider_links")
      .select("id,provider_product_id,match_status")
      .eq("card_id", card.id)
      .eq("provider", "tcgapi")
      .maybeSingle();

  if (existingError) {
    return reply(
      "Could not inspect existing mappings.",
      500
    );
  }

  if (existing) {
    return reply(
      "A TCG API mapping already exists. V5 never overwrites mappings.",
      409
    );
  }

  // Check the catalog before making provider API requests.
  // This endpoint cannot safely approve special variants yet.
  const catalogAssessment =
    assessCatalogPrinting(card);

  if (
    catalogAssessment.special ||
    catalogAssessment.kind === "unknown"
  ) {
    return reply(
      catalogAssessment.special
        ? "Special variant requires additional provider verification. Nothing saved."
        : "Catalog printing cannot be verified exactly. Nothing saved.",
      422,
      {
        catalogFinish: card.finish,
        catalogVariant: card.variant,
        catalogEdition: card.edition,
        catalogKind: catalogAssessment.kind,
        explanation: catalogAssessment.reason,
      }
    );
  }

  let detail: ApiCard;
  let searchItems: ApiCard[];

  try {
    const qs = new URLSearchParams({
      q: card.name || "",
      game: "pokemon",
      type: "Cards",
      per_page: "50",
      page: "1",
    });

    const [rawDetail, rawSearch] =
      await Promise.all([
        apiGet(
          `cards/${input.tcgapiId}`,
          apiKey
        ),
        apiGet(
          `search?${qs.toString()}`,
          apiKey
        ),
      ]);

    if (
      !rawDetail ||
      typeof rawDetail !== "object" ||
      Array.isArray(rawDetail)
    ) {
      return reply(
        "Provider card detail has an unexpected shape.",
        502
      );
    }

    if (!Array.isArray(rawSearch)) {
      return reply(
        "Provider discovery returned an unexpected shape.",
        502
      );
    }

    detail = rawDetail as ApiCard;
    searchItems = rawSearch as ApiCard[];
  } catch (err) {
    console.error(
      "[MintRadar V5 approval verification]",
      err instanceof Error ? err.message : err
    );

    return reply(
      "TCG API verification failed or search limit reached. Nothing saved.",
      502
    );
  }

  if (detail.id !== input.tcgapiId) {
    return reply(
      "Provider detail ID did not resolve exactly.",
      422
    );
  }

  if (!identityMatches(card, detail)) {
    return reply(
      "Individual-card identity verification failed. Nothing saved.",
      422
    );
  }

  // Discovery and detail must independently resolve to
  // the same exact provider card and catalog identity.
  const matching = searchItems.filter(
    (candidate) =>
      candidate &&
      candidate.id === input.tcgapiId &&
      identityMatches(card, candidate)
  );

  if (matching.length !== 1) {
    return reply(
      "Could not find one exact matching discovery record. Nothing saved.",
      422,
      {
        requestedProviderId: input.tcgapiId,
        exactDiscoveryMatches: matching.length,
        searchPageFull: searchItems.length >= 50,
      }
    );
  }

  if (searchItems.length >= 50) {
    return reply(
      "Discovery results may be incomplete (50 results). Nothing saved.",
      422
    );
  }

  const discovery = matching[0];

  const catalogKind = catalogAssessment.kind;
  const discoveryKind = printingKind(
    discovery.printing
  );
  const detailKind = printingKind(
    detail.printing
  );

  // Provider special printing labels must not be
  // accepted as generic Holo or Normal.
  const providerHasSpecialIdentity =
    hasSpecialIdentity(discovery.printing) ||
    hasSpecialIdentity(detail.printing);

  if (
    providerHasSpecialIdentity ||
    discoveryKind === "unknown" ||
    detailKind === "unknown" ||
    catalogKind !== discoveryKind ||
    detailKind !== discoveryKind
  ) {
    return reply(
      "Printing is missing, special, or mismatched. No mapping saved.",
      422,
      {
        catalogFinish: card.finish,
        catalogVariant: card.variant,
        catalogEdition: card.edition,
        discoveryPrinting:
          discovery.printing ?? null,
        detailPrinting:
          detail.printing ?? null,
        catalogKind,
        discoveryKind,
        detailKind,
        providerHasSpecialIdentity,
      }
    );
  }

  // Product IDs must agree across both independent
  // provider API responses.
  if (
    !Number.isSafeInteger(detail.tcgplayer_id) ||
    !detail.tcgplayer_id ||
    detail.tcgplayer_id <= 0 ||
    !Number.isSafeInteger(
      discovery.tcgplayer_id
    ) ||
    !discovery.tcgplayer_id ||
    discovery.tcgplayer_id <= 0 ||
    detail.tcgplayer_id !==
      discovery.tcgplayer_id
  ) {
    return reply(
      "TCGplayer product IDs are missing or disagree. No mapping saved.",
      422,
      {
        detailTcgplayerId:
          detail.tcgplayer_id ?? null,
        discoveryTcgplayerId:
          discovery.tcgplayer_id ?? null,
      }
    );
  }

  const apiSet =
    detail.set_name ||
    detail.set?.name ||
    "";

  // Preserve existing V5 write behavior.
  // Never overwrite existing mappings.
  const { error: writeError } =
    await db
      .from("card_provider_links")
      .insert({
        card_id: card.id,
        provider: "tcgapi",
        provider_product_id:
          String(detail.id),
        product_url:
          `https://www.tcgplayer.com/product/${detail.tcgplayer_id}`,
        match_status: "verified",
        match_confidence: 1,
        matched_name: detail.name,
        matched_set_name: apiSet,
        matched_card_number:
          String(detail.number ?? ""),
      });

  if (writeError) {
    const conflict =
      writeError.code === "23505";

    return reply(
      conflict
        ? "Mapping already exists; no overwrite."
        : "Database insert failed.",
      conflict ? 409 : 500
    );
  }

  return NextResponse.json(
    {
      ok: true,
      cardId: card.id,
      tcgapiId: detail.id,
      tcgplayerId:
        detail.tcgplayer_id,
      verifiedPrinting:
        discovery.printing,
    },
    { headers }
  );
}
