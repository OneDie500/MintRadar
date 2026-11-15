
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const PAGE_SIZE = 50;
const MAX_DETAILS = 15;

type Decision =
  | "AUTO_APPROVE_ELIGIBLE"
  | "NEEDS_REVIEW"
  | "CONFLICT"
  | "NO_MATCH";

type Kind =
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
  foil_only?: number | boolean | null;
  rarity?: string | null;
  set?: { name?: string | null } | null;
};

type Mapping = {
  provider_product_id: string | null;
  match_status: string | null;
};

function respond(
  value: Record<string, unknown>,
  status = 200
) {
  return NextResponse.json(value, { status, headers });
}

function fail(reason: string, status = 400) {
  return respond({ ok: false, reason }, status);
}

function result(
  decision: Decision,
  reason: string,
  base: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) {
  return respond({
    ok: true,
    decision,
    reason,
    ...base,
    ...extra,
    writes_performed: false,
    auto_approved: false,
  });
}

function normalized(value: string | null | undefined) {
  return (value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
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

function cardNumber(
  value: string | number | null | undefined
) {
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
): Kind {
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

function specialIdentity(
  value: string | null | undefined
) {
  const v = normalized(value);

  return (
    /full[\s-]*art|alternate|alt[\s-]*art|illustration|secret[\s-]*rare/.test(v) ||
    /master[\s-]*ball|pok[eé][\s-]*ball|cosmo(?:s)?/.test(v) ||
    /etched|stamped|parallel|promo(?:tional)?/.test(v) ||
    /exclusive|special[\s-]*edition|first[\s-]*edition|1st[\s-]*edition/.test(v) ||
    /staff|prerelease|pre[\s-]*release|league|event[\s-]*stamp/.test(v) ||
    /holiday|calendar|championship|tournament/.test(v) ||
    /rainbow|gold[\s-]*foil|textured|cracked[\s-]*ice/.test(v) ||
    /blister|pattern|collector|celebration/.test(v)
  );
}

function assessCatalog(card: CatalogCard) {
  const fields = [
    { label: "finish", value: card.finish },
    { label: "variant", value: card.variant },
    { label: "edition", value: card.edition },
  ];

  const specialFields = fields
    .filter((field) => specialIdentity(field.value))
    .map((field) => field.label);

  const populated = fields
    .filter((field) => Boolean(field.value?.trim()))
    .map((field) => ({
      label: field.label,
      kind: printingKind(field.value),
    }));

  const unknownFields = populated
    .filter((field) => field.kind === "unknown")
    .map((field) => field.label);

  const kinds = [
    ...new Set(
      populated
        .map((field) => field.kind)
        .filter((kind) => kind !== "unknown")
    ),
  ];

  return {
    special: specialFields.length > 0,
    specialFields,
    unknownFields,
    conflicting: kinds.length > 1,
    kind:
      kinds.length === 1
        ? kinds[0]
        : ("unknown" as Kind),
  };
}

function identityMatches(
  card: CatalogCard,
  provider: ApiCard
) {
  const providerSet =
    provider.set_name || provider.set?.name;

  return Boolean(
    normalized(card.name) &&
    normalized(card.name) === normalized(provider.name) &&
    setName(card.set_name) &&
    setName(card.set_name) === setName(providerSet) &&
    cardNumber(card.card_number) &&
    cardNumber(card.card_number) ===
      cardNumber(provider.number)
  );
}

// Diagnostic only. This does not create identity equivalence.
function knownSetDiscrepancy(
  card: CatalogCard,
  provider: ApiCard
) {
  return (
    normalized(card.name) === "ancient mew" &&
    normalized(provider.name) === "ancient mew" &&
    setName(card.set_name) === "miscellaneous promos" &&
    setName(
      provider.set_name || provider.set?.name
    ) === "miscellaneous cards and products" &&
    cardNumber(card.card_number) ===
      cardNumber(provider.number)
  );
}

function validId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function parseId(value: string | null) {
  if (!value || !/^\d{1,12}$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return validId(parsed) ? parsed : null;
}

async function apiGet(
  path: string,
  apiKey: string
): Promise<unknown> {
  const response = await fetch(
    `https://api.tcgapi.dev/v1/${path}`,
    {
      headers: { "X-API-Key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
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

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return fail("Development-only diagnostic.", 403);
  }

  // A Host header is not authentication. Keep the dev server
  // bound to loopback; never expose this route publicly.
  const host = req.headers.get("host") || "";
  const hostname = host.replace(/:\d+$/, "").toLowerCase();

  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]"
  ) {
    return fail("Localhost only.", 403);
  }

  const cardId = (
    req.nextUrl.searchParams.get("card_id") || ""
  ).trim();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      cardId
    )
  ) {
    return fail("Valid catalog UUID required.", 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.TCG_API_KEY;

  if (!url || !service || !apiKey) {
    return fail("Configuration incomplete.", 503);
  }

  const db = createClient(url, service, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await db
    .from("cards")
    .select(
      "id,name,set_name,card_number,language,category,finish,variant,edition"
    )
    .eq("id", cardId)
    .maybeSingle();

  if (error) return fail("Catalog lookup failed.", 503);
  if (!data) return fail("Card not found.", 404);

  const card = data as CatalogCard;

  if (
    card.language?.toUpperCase() !== "EN" ||
    card.category?.toLowerCase() !== "pokemon"
  ) {
    return fail("English Pokémon only.", 422);
  }

  const assessment = assessCatalog(card);

  const { data: links, error: linkError } = await db
    .from("card_provider_links")
    .select("provider_product_id,match_status")
    .eq("card_id", card.id)
    .eq("provider", "tcgapi")
    .limit(2);

  if (linkError) {
    return fail("Mapping lookup failed.", 503);
  }

  const mappings = (links || []) as Mapping[];
  const mapping =
    mappings.length === 1 ? mappings[0] : null;

  const mappedId = mapping
    ? parseId(mapping.provider_product_id)
    : null;

  const base = {
    card_id: card.id,
    catalog: {
      name: card.name,
      set_name: card.set_name,
      card_number: card.card_number,
      finish: card.finish,
      variant: card.variant,
      edition: card.edition,
    },
    assessment,
    existing_mapping: {
      count: mappings.length,
      provider_id: mappedId,
      status: mapping?.match_status ?? null,
    },
  };

  if (mappings.length > 1) {
    return result(
      "NEEDS_REVIEW",
      "Multiple provider mappings require review.",
      base
    );
  }

  if (
    !card.name?.trim() ||
    !card.set_name?.trim() ||
    !card.card_number?.trim()
  ) {
    return result(
      "NEEDS_REVIEW",
      "Catalog identity is incomplete.",
      base
    );
  }

  let searchItems: ApiCard[];

  try {
    const params = new URLSearchParams({
      q: card.name,
      game: "pokemon",
      type: "Cards",
      per_page: String(PAGE_SIZE),
      page: "1",
    });

    const raw = await apiGet(
      `search?${params.toString()}`,
      apiKey
    );

    if (!Array.isArray(raw)) {
      throw new Error("Unexpected search data");
    }

    searchItems = raw as ApiCard[];
  } catch (error) {
    console.error(
      "[MintRadar verification search]",
      error instanceof Error ? error.message : error
    );

    return result(
      "NEEDS_REVIEW",
      "Provider discovery unavailable.",
      base,
      { search_available: false }
    );
  }

  const searchPageFull =
    searchItems.length >= PAGE_SIZE;

  const exactCandidates = searchItems.filter(
    (item) =>
      item &&
      validId(item.id) &&
      identityMatches(card, item)
  );

  const diagnosticCandidates = searchItems.filter(
    (item) =>
      item &&
      validId(item.id) &&
      knownSetDiscrepancy(card, item)
  );

  const ids = new Set<number>();

  for (const candidate of exactCandidates) {
    if (validId(candidate.id)) ids.add(candidate.id);
  }

  for (const candidate of diagnosticCandidates) {
    if (validId(candidate.id)) ids.add(candidate.id);
  }

  if (mappedId) ids.add(mappedId);

  const uncertainCatalog =
    assessment.special ||
    assessment.kind === "unknown" ||
    assessment.conflicting ||
    assessment.unknownFields.length > 0;

  if (searchPageFull || ids.size > MAX_DETAILS) {
    return result(
      "NEEDS_REVIEW",
      "Search completeness or candidate limits prevent verification.",
      base,
      {
        search_page_full: searchPageFull,
        candidate_count: ids.size,
      }
    );
  }

  if (ids.size === 0) {
    return result(
      "NEEDS_REVIEW",
      assessment.special
        ? "Special variant requires exact provider evidence."
        : "No exact match found in this search; provider absence is not established.",
      base,
      {
        candidate_count: 0,
        search_page_full: false,
        search_exhaustive: false,
        candidates: [],
      }
    );
  }

  const evidence = [];

  for (const id of ids) {
    const discovery = searchItems.find(
      (item) => item?.id === id
    );

    let detail: ApiCard | null = null;
    let detailError: string | null = null;

    try {
      const raw = await apiGet(
        `cards/${id}`,
        apiKey
      );

      if (
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw)
      ) {
        detail = raw as ApiCard;
      } else {
        detailError = "Unexpected detail shape";
      }
    } catch (error) {
      detailError =
        error instanceof Error
          ? error.message
          : "Detail request failed";
    }

    const searchIdentity = Boolean(
      discovery && identityMatches(card, discovery)
    );

    const detailIdentity = Boolean(
      detail && identityMatches(card, detail)
    );

    const searchKind = printingKind(
      discovery?.printing
    );

    const detailKind = printingKind(
      detail?.printing
    );

    const detailPrintingPresent =
      detailKind !== "unknown";

    const exactPrinting = Boolean(
      discovery &&
      detail &&
      searchKind !== "unknown" &&
      detailKind !== "unknown" &&
      searchKind === assessment.kind &&
      detailKind === searchKind &&
      normalized(discovery.printing) ===
        normalized(detail.printing) &&
      !specialIdentity(discovery.printing) &&
      !specialIdentity(detail.printing)
    );

    const productIdsMatch = Boolean(
      discovery &&
      detail &&
      validId(discovery.tcgplayer_id) &&
      validId(detail.tcgplayer_id) &&
      discovery.tcgplayer_id ===
        detail.tcgplayer_id
    );

    const detailIdMatch = detail?.id === id;

    const failures: string[] = [];

    if (!discovery) {
      failures.push("Exact discovery record missing.");
    } else if (!searchIdentity) {
      failures.push(
        "Discovery identity differs from catalog."
      );
    }

    if (!detail) {
      failures.push("Provider detail unavailable.");
    } else {
      if (!detailIdMatch) {
        failures.push("Provider detail ID mismatch.");
      }

      if (!detailIdentity) {
        failures.push(
          "Provider detail identity differs from catalog."
        );
      }

      if (!detailPrintingPresent) {
        failures.push(
          "Provider detail does not independently identify printing."
        );
      }
    }

    if (!exactPrinting) {
      failures.push(
        "Exact printing not independently verified."
      );
    }

    if (!productIdsMatch) {
      failures.push(
        "Discovery and detail product IDs not independently verified."
      );
    }

    const diagnosticAlias = Boolean(
      detail && knownSetDiscrepancy(card, detail)
    );

    if (diagnosticAlias) {
      failures.push(
        "Known set-name discrepancy requires manual review."
      );
    }

    const eligible = Boolean(
      !uncertainCatalog &&
      !mapping &&
      searchIdentity &&
      detailIdentity &&
      detailIdMatch &&
      exactPrinting &&
      productIdsMatch &&
      !diagnosticAlias &&
      failures.length === 0
    );

    evidence.push({
      provider_id: id,
      source: discovery
        ? "search"
        : "existing_mapping",
      search_identity_match: searchIdentity,
      detail_identity_match:
        detail ? detailIdentity : null,
      detail_id_match: detailIdMatch,
      search_printing: discovery?.printing ?? null,
      detail_printing: detail?.printing ?? null,
      detail_printing_present:
        detailPrintingPresent,
      search_tcgplayer_id:
        discovery?.tcgplayer_id ?? null,
      detail_tcgplayer_id:
        detail?.tcgplayer_id ?? null,
      product_id_match: productIdsMatch,
      exact_printing_verified: exactPrinting,
      known_set_discrepancy: diagnosticAlias,
      foil_only: detail?.foil_only ?? null,
      rarity: detail?.rarity ?? null,
      detail_error: detailError,
      failures,
      eligible,
    });
  }

  const eligibleCandidates = evidence.filter(
    (item) => item.eligible
  );

  let decision: Decision = "NEEDS_REVIEW";
  let reason = "Provider evidence requires review.";

  if (assessment.special) {
    reason =
      "Special variant requires independent variant-specific verification.";
  } else if (uncertainCatalog) {
    reason =
      "Catalog printing or edition is ambiguous.";
  } else if (mapping) {
    reason =
      "Existing provider mapping retained; no new approval eligible.";
  } else if (eligibleCandidates.length > 1) {
    reason =
      "Multiple eligible candidates require review.";
  } else if (eligibleCandidates.length === 1) {
    // Every other candidate must be accounted for.
    // A failed or ambiguous competitor blocks eligibility.
    if (evidence.length !== 1) {
      reason =
        "Competing provider candidates require review.";
    } else {
      decision = "AUTO_APPROVE_ELIGIBLE";
      reason =
        "One standard-printing candidate passed all available independent checks. No approval performed.";
    }
  } else if (
    evidence.some(
      (item) =>
        item.detail_identity_match === false &&
        item.detail_id_match &&
        !item.known_set_discrepancy
    )
  ) {
    decision = "CONFLICT";
    reason =
      "Provider detail contradicts catalog identity.";
  } else {
    reason =
      "Independent printing or product evidence is insufficient.";
  }

  return result(decision, reason, base, {
    search_available: true,
    search_page_full: false,
    search_exhaustive: false,
    candidate_count: evidence.length,
    eligible_candidate_count:
      eligibleCandidates.length,
    candidates: evidence,
  });
}
