import { NextRequest, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  set?: {
    id?: string;
    name?: string;
    cardCount?: {
      official?: number;
      total?: number;
    };
  };
  images?: {
    small?: string;
    large?: string;
  };
};

type PokemonTcgResponse = {
  data?: PokemonTcgCard[];
};

type TcgdexCardBrief = {
  id?: string;
  localId?: string;
  name?: string;
  image?: string | null;
};

type TcgdexCardDetail = TcgdexCardBrief & {
  set?: {
    id?: string;
    name?: string;
  };
};

type FetchAttemptResult =
  | {
      ok: true;
      response: Response;
    }
  | {
      ok: false;
      status?: number;
      error?: string;
    };

type KnownImageOverride = {
  name: string;
  setName?: string;
  cardNumber?: string;
  imageUrl: string;
};

const KNOWN_IMAGE_OVERRIDES: KnownImageOverride[] = [
  {
    name: "Ancient Mew",
    setName: "Miscellaneous Promos",
    cardNumber: "001",
    imageUrl: "/card-overrides/pokemon/ancient-mew-001.jpg",
  },
];

// Validate a complete high-resolution JPEG or PNG before exposing a dev-only URL.
// No redirects: avoids a supplied public URL bouncing to a private endpoint.
async function inspectDevelopmentPromoScan(rawUrl: string): Promise<{
  url: string | null;
  diagnostics: { status: string; width?: number; height?: number };
}> {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const forbidden = host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") ||
      host === "::1" || host.includes(":") ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host);
    if (url.protocol !== "https:" || forbidden || url.username || url.password) {
      return { url: null, diagnostics: { status: "invalid-public-https-url" } };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(url.toString(), {
        method: "GET", cache: "no-store", redirect: "error", signal: controller.signal,
        headers: { Range: "bytes=0-262143" },
      });
      if (!response.ok) return { url: null, diagnostics: { status: `http-${response.status}` } };
      const mime = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
      if (mime !== "image/png" && mime !== "image/jpeg") {
        await response.body?.cancel();
        return { url: null, diagnostics: { status: "unsupported-image-type" } };
      }
      const reader = response.body?.getReader();
      if (!reader) return { url: null, diagnostics: { status: "empty-response" } };
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (length < 262144) {
        const part = await reader.read();
        if (part.done) break;
        const keep = part.value.subarray(0, 262144 - length);
        chunks.push(keep);
        length += keep.length;
        if (keep.length !== part.value.length) break;
      }
      await reader.cancel();
      const bytes = Buffer.concat(chunks);
      let width = 0, height = 0;
      if (mime === "image/png" && bytes.length >= 24 &&
          bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
        width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
      } else if (mime === "image/jpeg" && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let pos = 2;
        while (pos + 9 < bytes.length) {
          if (bytes[pos] !== 0xff) break;
          const marker = bytes[pos + 1];
          if (marker === 0xd8 || marker === 0xd9) { pos += 2; continue; }
          const segment = bytes.readUInt16BE(pos + 2);
          if (segment < 2 || pos + 2 + segment > bytes.length) break;
          if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
            height = bytes.readUInt16BE(pos + 5);
            width = bytes.readUInt16BE(pos + 7);
            break;
          }
          pos += segment + 2;
        }
      }
      if (Math.max(width, height) < 1000 || Math.min(width, height) < 650) {
        return { url: null, diagnostics: { status: "insufficient-or-unreadable-resolution", width, height } };
      }
      return { url: url.toString(), diagnostics: { status: "high-resolution-dev-scan-verified", width, height } };
    } finally { clearTimeout(timer); }
  } catch {
    return { url: null, diagnostics: { status: "scan-fetch-or-validation-failed" } };
  }
}

function normalize(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeCardNumber(value?: string | null) {
  return (value || "")
    .trim()
    .replace(/^#/, "")
    .trim();
}

function shortCardNumber(value?: string | null) {
  return normalizeCardNumber(value)
    .split("/")[0]
    .trim();
}

function normalizeSet(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bpokemon\b/g, " ")
    .replace(/\btrading card game\b/g, " ")
    .replace(/\bbase set\b/g, " ")
    .replace(/\btrainer gallery\b/g, " trainer gallery ")
    .replace(/\bgalarian gallery\b/g, " galarian gallery ")
    .replace(/\bshiny vault\b/g, " shiny vault ")
    .replace(/\bpromo cards?\b/g, " promo ")
    .replace(/\bblack star promos?\b/g, " promo ")
    .replace(/\bblack star\b/g, " promo ")
    .replace(/\bsvp\b/g, " scarlet violet promo ")
    .replace(/\bsv\b/g, " scarlet violet ")
    .replace(/\bswsh\b/g, " sword shield ")
    .replace(/\bcelebrations classic collection\b/g, " celebrations ")
    .replace(/\bclassic collection\b/g, " celebrations ")
    .replace(/\bsun moon\b/g, " sun and moon ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setSimilarityScore(
  wanted?: string | null,
  actual?: string | null
) {
  const left = normalizeSet(wanted);
  const right = normalizeSet(actual);

  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 500;
  }

  if (
    left.includes(right) ||
    right.includes(left)
  ) {
    return 350;
  }

  const leftWords = new Set(
    left.split(" ").filter(Boolean)
  );

  const rightWords =
    right.split(" ").filter(Boolean);

  const overlap =
    rightWords.filter((word) =>
      leftWords.has(word)
    ).length;

  const denominator =
    Math.max(
      leftWords.size,
      rightWords.length
    );

  if (!denominator) {
    return 0;
  }

  const ratio =
    overlap / denominator;

  if (ratio >= 0.8) {
    return 300;
  }

  if (ratio >= 0.6) {
    return 220;
  }

  if (ratio >= 0.4) {
    return 125;
  }

  return overlap > 0 ? 40 : 0;
}

function escapeQueryValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}


const VARIANT_HINTS = [
  "poke ball pattern",
  "poké ball pattern",
  "master ball pattern",
  "masterball pattern",
  "reverse holo",
  "reverse holofoil",
  "holo",
  "holofoil",
  "full art",
  "alternate art",
  "alternate full art",
  "alt art",
  "illustration rare",
  "special illustration rare",
  "ultra rare",
  "secret rare",
  "rainbow rare",
  "gold",
  "stamp",
  "stamped",
  "blister",
  "blisters",
  "checklane",
  "check lane",
  "prerelease",
  "pre release",
  "build and battle",
  "build & battle",
];

const LANGUAGE_TAGS: Record<string, string> = {
  en: "EN",
  eng: "EN",
  english: "EN",
  jp: "JP",
  jpn: "JP",
  japanese: "JP",
  cn: "CN",
  chn: "CN",
  chinese: "CN",
};

const GENERIC_SET_NAMES = [
  "miscellaneous cards products",
  "miscellaneous cards and products",
  "miscellaneous promos",
  "promotional cards",
  "promo cards",
  "alternate art promos",
  "alternate art promo",
  "alternate arts",
  "alternate art",
  "other",
  "unknown",
];

function normalizeMetadataText(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericSetName(value?: string | null) {
  const normalized = normalizeMetadataText(value);

  if (!normalized) {
    return false;
  }

  return GENERIC_SET_NAMES.some(
    (candidate) =>
      normalized === candidate ||
      normalized.includes(candidate)
  );
}

function variantSetHint(variant?: string | null) {
  if (!variant) {
    return null;
  }

  const withoutDescriptor = variant
    .replace(/\b(?:promo\s+)?stamp(?:ed)?\b/gi, " ")
    .replace(/\b(?:triple|single|three[ -]?pack|3[ -]?pack)?\s*blisters?\b/gi, " ")
    .replace(/\bcheck\s*lane\s*blisters?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return withoutDescriptor || null;
}

function splitCanonicalNameAndVariant(
  value: string
) {
  const original = value.trim();
  let workingName = original;
  const variants: string[] = [];
  let language: string | null = null;

  while (workingName) {
    const match = workingName.match(
      /^(.*?)\s*\(([^()]+)\)\s*$/
    );

    if (!match) {
      break;
    }

    const possibleName = match[1].trim();
    const metadata = match[2].trim();
    const normalizedMetadata =
      normalizeMetadataText(metadata);

    const languageTag =
      LANGUAGE_TAGS[normalizedMetadata];

    if (languageTag) {
      language = language || languageTag;
      workingName = possibleName;
      continue;
    }

    const looksLikeVariant =
      VARIANT_HINTS.some((hint) => {
        const normalizedHint =
          normalizeMetadataText(hint);

        return (
          normalizedMetadata === normalizedHint ||
          normalizedMetadata.includes(normalizedHint)
        );
      });

    if (!possibleName || !looksLikeVariant) {
      break;
    }

    variants.unshift(metadata);
    workingName = possibleName;
  }

  return {
    canonicalName: workingName || original,
    variant: variants.length
      ? variants.join(" / ")
      : null,
    language,
  };
}

function namesMatch(
  wantedName: string,
  actualName?: string | null
) {
  const wanted =
    normalize(wantedName);

  const actual =
    normalize(actualName);

  if (!wanted || !actual) {
    return {
      matched: false,
      exact: false,
    };
  }

  if (wanted === actual) {
    return {
      matched: true,
      exact: true,
    };
  }

  if (
    actual.includes(wanted) ||
    wanted.includes(actual)
  ) {
    return {
      matched: true,
      exact: false,
    };
  }

  return {
    matched: false,
    exact: false,
  };
}

function localizedNameLooksCompatible(
  wantedName: string,
  actualName?: string | null
) {
  const wanted = normalize(wantedName);
  const actual = normalize(actualName);

  if (!wanted || !actual) {
    return false;
  }

  // If TCGdex returns a Latin/English-compatible name, require it to
  // identify the same Pokémon/card name. Fully localized JP/CN names
  // cannot be compared safely here, so they are validated later by
  // collector number + set confidence instead of being guessed by name.
  const actualHasLatinLetters = /[a-z]/i.test(actualName || "");

  if (!actualHasLatinLetters) {
    return true;
  }

  return (
    actual === wanted ||
    actual.includes(wanted) ||
    wanted.includes(actual)
  );
}


function findKnownImageOverride({
  name,
  setName,
  cardNumber,
}: {
  name: string;
  setName?: string | null;
  cardNumber?: string | null;
}) {
  const wantedName = normalize(name);
  const wantedSet = normalize(setName);
  const wantedNumber = normalize(
    normalizeCardNumber(cardNumber)
  );

  return KNOWN_IMAGE_OVERRIDES.find((override) => {
    const overrideName =
      normalize(override.name);
    const overrideSet =
      normalize(override.setName);
    const overrideNumber =
      normalize(
        normalizeCardNumber(
          override.cardNumber
        )
      );

    if (overrideName !== wantedName) {
      return false;
    }

    if (
      overrideSet &&
      wantedSet &&
      overrideSet !== wantedSet
    ) {
      return false;
    }

    if (
      overrideNumber &&
      wantedNumber &&
      overrideNumber !== wantedNumber
    ) {
      return false;
    }

    return true;
  });
}


function buildCollectorNumberVariants(
  value?: string | null
) {
  const full =
    normalizeCardNumber(value);

  if (!full) {
    return [] as string[];
  }

  const short =
    shortCardNumber(full);

  const variants =
    new Set<string>([
      full,
      short,
    ]);

  for (
    const source of
    [full, short]
  ) {
    const compact =
      source
        .replace(/\s+/g, "")
        .toUpperCase();

    if (!compact) {
      continue;
    }

    variants.add(compact);

    const prefixed =
      compact.match(
        /^([A-Z]+)0*(\d+)$/
      );

    if (prefixed) {
      const prefix = prefixed[1];
      const digits = prefixed[2];

      variants.add(
        `${prefix}${digits}`
      );

      if (
        ["SVP", "SWSH", "SM", "XY", "CC"]
          .includes(prefix)
      ) {
        variants.add(
          String(Number(digits))
        );
      }
    }

    const numeric =
      compact.match(/^0*(\d+)$/);

    if (numeric) {
      variants.add(
        String(Number(numeric[1]))
      );
    }
  }

  return Array.from(variants)
    .filter(Boolean);
}

function scoreCard(
  card: PokemonTcgCard,
  {
    name,
    setName,
    cardNumber,
  }: {
    name: string;
    setName?: string | null;
    cardNumber?: string | null;
  }
) {
  const parsedName =
    splitCanonicalNameAndVariant(
      name
    );

  const match =
    namesMatch(
      parsedName.canonicalName,
      card.name
    );

  if (!match.matched) {
    return -1;
  }

  const wantedNumbers =
    new Set(
      buildCollectorNumberVariants(
        cardNumber
      ).map((value) =>
        normalize(value)
      )
    );

  const cardNumberValues =
    new Set(
      buildCollectorNumberVariants(
        card.number
      ).map((value) =>
        normalize(value)
      )
    );

  const numberMatches =
    wantedNumbers.size === 0 ||
    Array.from(
      wantedNumbers
    ).some((value) =>
      cardNumberValues.has(value)
    );

  let score =
    match.exact
      ? 1000
      : 250;

  if (wantedNumbers.size) {
    if (numberMatches) {
      score += 700;
    } else {
      score -= 500;
    }
  }

  score += setSimilarityScore(
    setName,
    card.set?.name
  );

  if (card.images?.large) {
    score += 25;
  } else if (
    card.images?.small
  ) {
    score += 10;
  }

  return score;
}


async function verifiedPokemonTcgVariantImageUrl({
  cardId,
  requestedCardNumber,
}: {
  cardId?: string | null;
  requestedCardNumber?: string | null;
}) {
  const shortRequested =
    shortCardNumber(requestedCardNumber)
      .replace(/\s+/g, "")
      .toLowerCase();

  const alternateMatch =
    shortRequested.match(/^(\d+)([a-z])$/i);

  if (!alternateMatch || !cardId) {
    return null;
  }

  const baseNumber = alternateMatch[1];

  const idMatch =
    cardId.match(/^(.+)-(\d+)$/i);

  if (!idMatch) {
    return null;
  }

  const setId = idMatch[1];
  const providerBaseNumber = idMatch[2];

  if (
    String(Number(providerBaseNumber)) !==
    String(Number(baseNumber))
  ) {
    return null;
  }

  const imageUrl =
    `https://images.pokemontcg.io/${encodeURIComponent(
      setId
    )}/${encodeURIComponent(
      shortRequested
    )}_hires.png`;

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    5000
  );

  try {
    const response = await fetch(imageUrl, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });

    return response.ok
      ? imageUrl
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function tcgdexImageUrl(
  imageBase?: string | null
) {
  if (!imageBase) {
    return null;
  }

  const clean = imageBase.replace(
    /\/+$/,
    ""
  );

  if (
    /\.(png|webp|jpe?g)$/i.test(clean)
  ) {
    return clean;
  }

  return `${clean}/high.png`;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs = 7000
): Promise<T | null> {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type TcgdexLanguage = "en" | "ja" | "zh-cn" | "zh-tw";

type TcgdexSetBrief = {
  id?: string | null;
  name?: string | null;
};

type TcgdexJapaneseSetDetail = {
  id?: string | null;
  name?: string | null;
  cardCount?: {
    official?: number | null;
    total?: number | null;
  } | null;
  cards?: TcgdexCardBrief[];
};

const JP_SET_NAME_ALIASES: Record<string, string[]> = {
  "eevee heroes": ["イーブイヒーローズ"],
  "hot air arena": ["熱風のアリーナ"],
  "heat wave arena": ["熱風のアリーナ"],
};

// Exact Japanese expansion identity, not a card/artwork override.
// SM12a is the official set code for TAG TEAM GX Tag All Stars.
// This also supports marketplace labels that omit the Japanese product title.
const VERIFIED_JP_MODERN_SET_IDS: Record<string, string> = {
  "tag team gx all stars": "sm12a",
  "tag team gx tag all stars": "sm12a",
  // Heat Wave Arena / Hot Air Arena is the Japanese SV9a expansion.
  "hot air arena": "SV9a",
  "heat wave arena": "SV9a",
};

// Curated set identities, NOT card-number or artwork overrides.
// The 1997 Japanese Rocket Gang release is PMCG4. Marketplace labels can
// use the English expansion name even when TCGdex indexes it as ロケット団.
// Keep this map exact to avoid confusing it with modern Team Rocket sets.
const VERIFIED_JP_VINTAGE_SET_IDS: Record<string, string> = {
  "team rocket japanese": "PMCG4",
  "japanese team rocket": "PMCG4",
  "rocket gang japanese": "PMCG4",
  "rocket gang": "PMCG4",
};

// Historical Japanese set labels used by marketplace inventory.
const VINTAGE_TEST_SET_IDS: Record<string, string> = {
  "neo genesis japanese": "neo1",
  "neo discovery japanese": "neo2",
  "neo revelation japanese": "neo3",
  "neo destiny japanese": "neo4",
  "pokemon vs japanese": "VS1",
  "pokemon vs": "VS1",
};

// Staged artwork is enabled ONLY in local development. Never in deployment.
function privateVintageArtworkEnabled() {
  return process.env.NODE_ENV === "development";
}

type StagedVintageArtwork = {
  catalog_id: string;
  set_id: string;
  card_name: string | null;
  image_url: string | null;
  visual_approved: boolean | null;
  identity_approved: boolean | null;
  rights_cleared: boolean | null;
};

async function findPrivateStagedVintageArtwork(catalogId: string) {
  if (!privateVintageArtworkEnabled()) return null;
  if (!/^(?:PMCG[1-9]|PCG[1-9]|E[1-5]|NEO[1-4]|VS1)-[0-9A-Z]+$/i.test(catalogId)) {
    return null;
  }
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  const endpoint = new URL(`${base.replace(/\/$/, "")}/rest/v1/vintage_artwork_staging`);
  endpoint.searchParams.set("select", "catalog_id,set_id,card_name,image_url,visual_approved,identity_approved,rights_cleared");
  endpoint.searchParams.set("catalog_id", `ilike.${catalogId}`);
  endpoint.searchParams.set("limit", "2");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(endpoint.toString(), {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as StagedVintageArtwork[];
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row = rows[0];
    if (row.catalog_id.toLowerCase() !== catalogId.toLowerCase()) return null;
    const url = row.image_url?.trim();
    if (!url) return null;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "pcg-search.com") return null;
    return { imageUrl: url, provider: "private-vintage-staging-test",
      match: { id: row.catalog_id, name: row.card_name, setId: row.set_id },
      testingOnly: true, rightsCleared: row.rights_cleared === true };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Resolve marketplace English-language labels against the provider's English
// set index, then verify that the same provider ID exists in the JP index.
// Never guess an ID from a similar-sounding expansion title.
async function verifiedJapaneseSetId(setName?: string | null) {
  const key = normalizeMetadataText(setName || "");
  if (!key) return null;
  const englishSets = await fetchJsonWithTimeout<TcgdexSetBrief[]>(
    "https://api.tcgdex.net/v2/en/sets"
  );
  if (!Array.isArray(englishSets)) return null;
  const matches = englishSets.filter((set) =>
    Boolean(set.id) && normalizeMetadataText(set.name || "") === key
  );
  if (matches.length !== 1 || !matches[0].id) return null;
  const id = matches[0].id;
  const japaneseSet = await fetchJsonWithTimeout<TcgdexJapaneseSetDetail>(
    `https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(id)}`
  );
  return japaneseSet?.id === id ? id : null;
}

// Discover Japanese sets by their actual catalog name, not by collector
// number. An ambiguous or missing set must never produce guessed artwork.
async function discoverJapaneseSetId(setName?: string | null) {
  const requested = (setName || "").trim();
  if (!requested) return null;
  const modernSetId = VERIFIED_JP_MODERN_SET_IDS[normalizeMetadataText(requested)];
  if (modernSetId) return modernSetId;
  // Exact, source-verified vintage expansion code. This does NOT convert
  // a Pokédex number (e.g. Dark Hypno 97) into a collector number (037).
  const vintageId = VERIFIED_JP_VINTAGE_SET_IDS[
    normalizeMetadataText(requested)
  ];
  if (vintageId) return vintageId;
  const testVintageId = VINTAGE_TEST_SET_IDS[normalizeMetadataText(requested)];
  if (testVintageId) return testVintageId;
  const verified = await verifiedJapaneseSetId(requested);
  if (verified) return verified;
  const aliases = JP_SET_NAME_ALIASES[normalizeMetadataText(requested)] || [];
  const sets = await fetchJsonWithTimeout<TcgdexSetBrief[]>(
    "https://api.tcgdex.net/v2/ja/sets"
  );
  if (!Array.isArray(sets)) return null;
  const names = [requested, ...aliases];
  const matches = sets.filter((set) =>
    Boolean(set.id) && names.some((name) =>
      name.trim() === (set.name || "").trim() ||
      (normalizeMetadataText(name) !== "" &&
       normalizeMetadataText(name) === normalizeMetadataText(set.name || ""))
    )
  );
  return matches.length === 1 ? matches[0].id || null : null;
}


// Diagnostic-only cross-language vintage identity resolution. PokeAPI species
// names are independent of TCGdex set IDs. This is not an artwork provider.
// Match the complete Japanese card name (including Dark/Light modifiers) and
// require a UNIQUE result in the already-verified Japanese TCGdex set.
type PokemonSpeciesTranslation = {
  id?: number;
  names?: Array<{ name?: string; language?: { name?: string } }>;
};

function vintageEnglishNameParts(name: string) {
  const clean = (name || "").trim().replace(/\s+/g, " ");
  const modifier = /^(Dark|Light)\s+/i.exec(clean);
  const species = modifier ? clean.slice(modifier[0].length) : clean;
  // Conservative: don't misidentify EX, ex, LV.X, GX, V, etc. as a species.
  if (!/^[a-z][a-z .'-]*$/i.test(species) ||
      /\b(?:ex|gx|vmax|vstar|break|lv\.?x|mega)\b/i.test(species)) return null;
  return { modifier: modifier?.[1].toLowerCase() || null, species };
}

async function inspectJapaneseVintageIdentity({
  setId, name, suppliedNumber,
}: {
  setId: string;
  name: string;
  suppliedNumber?: string | null;
}) {
  const japaneseSet = await fetchJsonWithTimeout<TcgdexJapaneseSetDetail>(
    `https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(setId)}`
  );
  if (!Array.isArray(japaneseSet?.cards)) {
    return { status: "japanese-catalog-unavailable", providerSetId: setId };
  }

  const cards = japaneseSet.cards;
  const numberVariants = new Set(
    buildCollectorNumberVariants(suppliedNumber).map(normalize)
  );
  const matchingCards = numberVariants.size
    ? cards.filter((card) =>
        Boolean(card.id && card.localId) &&
        buildCollectorNumberVariants(card.localId).some((number) =>
          numberVariants.has(normalize(number))
        )
      )
    : [];
  const numberCandidate = matchingCards.length === 1 ? matchingCards[0] : null;
  // A localized Japanese name can be verified directly against the same
  // TCGdex Japanese set and collector number. This avoids requiring an
  // English/PokeAPI species translation for already-localized catalog rows.
  // Require exactly one numbered candidate, exact set identity, and exact
  // normalized Japanese name; a number match alone is never sufficient.
  const normalizedJapaneseName = (value: string) =>
    value.normalize("NFKC").replace(/\s+/g, "").trim();
  const directJapaneseMatch = numberCandidate &&
    japaneseSet.id?.toLowerCase() === setId.toLowerCase() &&
    numberCandidate.id?.toLowerCase().startsWith(`${setId.toLowerCase()}-`) &&
    normalizedJapaneseName(numberCandidate.name || "") === normalizedJapaneseName(name) &&
    Boolean(normalizedJapaneseName(name))
      ? numberCandidate
      : null;
  const parts = vintageEnglishNameParts(name);
  let translatedJapaneseName: string | null = null;
  let speciesId: number | null = null;
  let translationSource: string | null = null;
  if (parts) {
    const slug = parts.species.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const species = await fetchJsonWithTimeout<PokemonSpeciesTranslation>(
      `https://pokeapi.co/api/v2/pokemon-species/${encodeURIComponent(slug)}/`
    );
    const enName = species?.names?.find((entry) => entry.language?.name === "en")?.name;
    const jaName = species?.names?.find((entry) => entry.language?.name?.toLowerCase() === "ja-hrkt")?.name || species?.names?.find((entry) => entry.language?.name?.toLowerCase() === "ja")?.name;
    // Japanese TCGdex names use Japanese kana. No transliteration guesses.
    if (enName && jaName && normalizeMetadataText(enName) === normalizeMetadataText(parts.species)) {
      speciesId = typeof species?.id === "number" ? species.id : null;
      translatedJapaneseName = `${parts.modifier === "dark" ? "わるい" : parts.modifier === "light" ? "やさしい" : ""}${jaName}`;
      translationSource = "pokeapi-species-ja-hrkt-or-ja";
    }
  }

  const nameMatches = translatedJapaneseName
    ? cards.filter((card) => card.id && card.localId &&
        (card.name || "").normalize("NFKC").replace(/\s+/g, "") ===
        translatedJapaneseName.normalize("NFKC").replace(/\s+/g, ""))
    : [];
  // LOCAL TEST ONLY: one narrowly scoped historical bilingual alias candidate.
  // The Japanese Neo Genesis index has been observed to label Slowking as
  // スローキング rather than PokeAPI's ヤドキング. Do not generalize this to other
  // cards or promote this to identity approval/rights clearance.
  let historicalAliasCandidate = false;
  let historicalAliasStatus = "not-applicable";
  if (name.trim().toLowerCase() === "slowking" &&
      setId.toLowerCase() === "neo1" &&
      translatedJapaneseName === "ヤドキング" && speciesId === 199 &&
      nameMatches.length === 0) {
    const aliasMatches = cards.filter((card) =>
      card.id?.toLowerCase() === "neo1-049" &&
      card.localId === "049" &&
      (card.name || "").normalize("NFKC").replace(/\s+/g, "") === "スローキング"
    );
    if (aliasMatches.length === 1 &&
        (!numberCandidate || numberCandidate.id === aliasMatches[0].id ||
         Number(suppliedNumber) === 199)) {
      historicalAliasCandidate = true;
      historicalAliasStatus = "single-japanese-catalog-alias-candidate-local-test-only";
    } else {
      historicalAliasStatus = "historical-alias-not-confirmed-in-current-catalog";
    }
  }
  // If the JP set index omits a translated card name, cross-check the
  // SAME provider card ID against the English index of this exact set.
  // Never use a similar set or a number-only match as proof of identity.
  let verified = directJapaneseMatch || (nameMatches.length === 1 ? nameMatches[0] : null);
  let englishCatalogMatches = 0;
  let englishCatalogStatus = "not-needed";
  if (!verified && nameMatches.length === 0) {
    const englishSet = await fetchJsonWithTimeout<TcgdexJapaneseSetDetail>(
      `https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(setId)}`
    );
    if (Array.isArray(englishSet?.cards) && englishSet?.id?.toLowerCase() === setId.toLowerCase()) {
      const englishMatches = englishSet.cards.filter((card) =>
        Boolean(card.id && card.localId) &&
        normalizeMetadataText(card.name || "") === normalizeMetadataText(name)
      );
      englishCatalogMatches = englishMatches.length;
      if (englishMatches.length === 1) {
        const corresponding = cards.filter((card) =>
          card.id?.toLowerCase() === englishMatches[0].id?.toLowerCase() && Boolean(card.localId)
        );
        if (corresponding.length === 1) {
          verified = corresponding[0];
          englishCatalogStatus = "same-set-same-card-id-verified";
        } else {
          englishCatalogStatus = "english-card-id-absent-from-japanese-set";
        }
      } else {
        englishCatalogStatus = englishMatches.length ? "ambiguous-english-name" : "english-name-not-found";
      }
    } else {
      englishCatalogStatus = "english-set-unavailable";
    }
  }
  // Historical Neo-era names differ from modern PokeAPI species translations.
  // These are identity CANDIDATES, never artwork overrides. Verify each one
  // against the live Japanese provider detail (set, localId, dexId, holo).
  let neoHistoricalIdentityStatus = "not-applicable";
  const neoHistoricalCandidates: Record<string, { id: string; localId: string; japaneseName: string; dexId: number }> = {
    "neo2:wobbuffet": { id: "neo2-031", localId: "031", japaneseName: "ウォブバフェット", dexId: 202 },
    "neo3:jumpluff": { id: "neo3-007", localId: "007", japaneseName: "ジャンプラフ", dexId: 189 },
  };
  const neoCandidate = neoHistoricalCandidates[`${setId.toLowerCase()}:${name.trim().toLowerCase()}`];
  if (!verified && neoCandidate && speciesId === neoCandidate.dexId &&
      /^\d+$/.test((suppliedNumber || "").trim()) &&
      Number(suppliedNumber) === neoCandidate.dexId) {
    const setEntry = cards.filter(card =>
      card.id?.toLowerCase() === neoCandidate.id &&
      card.localId === neoCandidate.localId &&
      card.name === neoCandidate.japaneseName
    );
    if (setEntry.length === 1 && japaneseSet.id?.toLowerCase() === setId.toLowerCase()) {
      const detail = await fetchJsonWithTimeout<TcgdexCardDetail & {
        dexId?: number[];
        rarity?: string;
        variants?: { holo?: boolean };
      }>(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(neoCandidate.id)}`);
      if (detail?.id?.toLowerCase() === neoCandidate.id &&
          detail.localId === neoCandidate.localId &&
          detail.name === neoCandidate.japaneseName &&
          detail.set?.id?.toLowerCase() === setId.toLowerCase() &&
          detail.dexId?.includes(neoCandidate.dexId) &&
          detail.variants?.holo === true && detail.rarity === "Holo Rare") {
        verified = setEntry[0];
        neoHistoricalIdentityStatus = "live-japanese-set-detail-dex-and-holo-verified";
      } else {
        neoHistoricalIdentityStatus = "live-detail-did-not-confirm-identity";
      }
    } else {
      neoHistoricalIdentityStatus = "japanese-set-entry-not-confirmed";
    }
  }
  // Only enable the historical alias for local image testing, with an exact
  // provider ID + local ID + JP alias match in the current set index.
  if (!verified && historicalAliasCandidate && privateVintageArtworkEnabled()) {
    verified = cards.find((card) => card.id?.toLowerCase() === "neo1-049" &&
      card.localId === "049" && card.name === "スローキング") || null;
  }
  const numberMatchesVerified = Boolean(verified && numberCandidate && verified.id === numberCandidate.id);
  const suppliedNumberIsSpeciesId = Boolean(speciesId && /^\d+$/.test((suppliedNumber || "").trim()) &&
    Number(suppliedNumber) === speciesId);
  // The name match must be unique. If a supplied number points at a different
  // printing, only reconcile it when that number is the species Pokédex ID.
  const identityVerified = Boolean(verified &&
    (!numberCandidate || numberMatchesVerified || suppliedNumberIsSpeciesId));
  const status = identityVerified
    ? (directJapaneseMatch ? "exact-japanese-set-number-name-verified" :
       englishCatalogStatus === "same-set-same-card-id-verified"
      ? "cross-language-provider-id-verified" : "cross-language-identity-verified")
    : verified ? "number-conflicts-with-translated-identity"
    : numberCandidate ? "collector-number-candidate-needs-name-verification"
    : "translation-source-required";
  return {
    status,
    providerSetId: setId,
    requestedEnglishName: name,
    suppliedNumber: suppliedNumber || null,
    japaneseSetName: japaneseSet.name || null,
    japaneseSetCardCount: cards.length,
    translationSource,
    translatedJapaneseName,
    speciesPokedexNumber: speciesId,
    japaneseExactNameMatches: nameMatches.length,
    directJapaneseCatalogMatch: Boolean(directJapaneseMatch),
    englishCatalogMatches,
    englishCatalogStatus,
    historicalAliasStatus,
    neoHistoricalIdentityStatus,
    historicalAliasCandidate,
    historicalAliasRequiresManualReview: historicalAliasCandidate,
    ...(numberCandidate ? {
      numberCandidateProviderCardId: numberCandidate.id,
      numberCandidateJapaneseName: numberCandidate.name || null,
    } : {}),
    ...(identityVerified && verified ? {
      candidateProviderCardId: verified.id,
      candidateJapaneseName: verified.name || null,
      candidateCollectorNumber: verified.localId,
      numberReconciliationNeeded: !numberMatchesVerified,
      suppliedNumberIsSpeciesId,
    } : {}),
    identityVerified,
    artworkVerified: false,
  };
}
async function resolveJapaneseSetScopedImage({
  name,
  setName,
  setId: suppliedSetId,
  cardNumber,
}: {
  name: string;
  setName?: string | null;
  setId?: string | null;
  cardNumber?: string | null;
}) {
  if (!cardNumber) {
    return null;
  }

  const normalizedSet =
    normalizeMetadataText(setName || "");

  const aliases =
    JP_SET_NAME_ALIASES[normalizedSet] || [];

  let setId =
    suppliedSetId?.trim() || VERIFIED_JP_MODERN_SET_IDS[normalizedSet] || null;

  let matchingSets: TcgdexSetBrief[] = [];

  // Prefer the provider set identity already carried by the catalog.
  // Only use the legacy alias lookup when no setId was supplied.
  if (setId) {
    matchingSets = [
      {
        id: setId,
        name: setName || null,
      },
    ];
  } else {
    if (!setName || !aliases.length) {
      return null;
    }

    const sets =
      await fetchJsonWithTimeout<TcgdexSetBrief[]>(
        "https://api.tcgdex.net/v2/ja/sets"
      );

    if (!Array.isArray(sets)) {
      return null;
    }

    matchingSets =
      sets.filter((set) => {
        const actual =
          (set?.name || "").trim();

        return aliases.some(
          (alias) =>
            actual === alias ||
            actual.includes(alias) ||
            alias.includes(actual)
        );
      });

    if (matchingSets.length !== 1) {
      return null;
    }

    setId =
      matchingSets[0]?.id || null;
  }

  if (!setId) {
    return null;
  }

  // TCGdex's set/card endpoint is keyed by the provider's localId, not by
  // marketplace full-number notation such as "082/069". Resolve the set first
  // and inspect its own card list so the number can never escape this set.
  const setDetail =
    await fetchJsonWithTimeout<TcgdexJapaneseSetDetail>(
      `https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(
        setId
      )}`
    );

  if (
    !setDetail ||
    !Array.isArray(setDetail.cards)
  ) {
    return null;
  }

  const requestedNumbers =
    new Set(
      buildCollectorNumberVariants(
        cardNumber
      ).map((value) =>
        normalize(value)
      )
    );

  const matchingCards =
    setDetail.cards.filter((card) => {
      const candidateNumbers =
        new Set(
          buildCollectorNumberVariants(
            card.localId
          ).map((value) =>
            normalize(value)
          )
        );

      return Array.from(
        requestedNumbers
      ).some((value) =>
        candidateNumbers.has(value)
      );
    });

  if (matchingCards.length !== 1) {
    return null;
  }

  const matchedBrief =
    matchingCards[0];

  if (
    !matchedBrief?.id ||
    !matchedBrief?.localId
  ) {
    return null;
  }

  const card =
    await fetchJsonWithTimeout<TcgdexCardDetail>(
      `https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(
        matchedBrief.id
      )}`
    );

  if (!card || !card.id || !card.localId) {
    return null;
  }

  const actualSetName =
    card.set?.name ||
    setDetail.name ||
    matchingSets[0]?.name ||
    "";

  const setMatches =
    Boolean(suppliedSetId) ||
    aliases.some(
      (alias) =>
        actualSetName === alias ||
        actualSetName.includes(alias) ||
        alias.includes(actualSetName)
    );

  if (!setMatches) {
    return null;
  }

  // Cross-language names are not interchangeable. For known bilingual
  // trainer identities, require the exact Japanese name in the verified set.
  // Other cards retain the existing behavior; no artwork URL is fabricated.
  const exactJapaneseTrainerNames: Record<string, string> = {
    "sv9a:089:ethans adventure": "ヒビキの冒険",
  };
  const trainerKey = `${setId.toLowerCase()}:${normalize(matchedBrief.localId)}:${normalizeMetadataText(name).replace(/ /g, "")}`;
  const expectedJapaneseName = exactJapaneseTrainerNames[trainerKey];
  if (expectedJapaneseName &&
      (card.name !== expectedJapaneseName ||
       card.set?.id?.toLowerCase() !== setId.toLowerCase() ||
       card.localId !== matchedBrief.localId)) {
    return null;
  }

  const imageUrl =
    tcgdexImageUrl(
      card.image ||
      matchedBrief.image
    );

  if (!imageUrl) {
    return null;
  }

  return {
    imageUrl,
    provider: "tcgdex-jp-set-scoped",
    match: {
      id: card.id,
      name:
        card.name ||
        matchedBrief.name ||
        name,
      setName:
        actualSetName ||
        setName,
      cardNumber:
        card.localId ||
        matchedBrief.localId ||
        cardNumber,
    },
    setId,
  };
}


type PokemonJapanCard = {
  cardID?: string | number | null;
  cardThumbFile?: string | null;
  cardNameAltText?: string | null;
};

type PokemonJapanSearchResponse = {
  hitCnt?: number | null;
  maxPage?: number | null;
  cardList?: PokemonJapanCard[] | null;
};

function normalizePrintedCollectorNumber(
  value?: string | null
) {
  return (value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/^#/, "")
    .trim()
    .toUpperCase();
}

function officialJapanDetailMatchesIdentity({
  html,
  setId,
  cardNumber,
}: {
  html: string;
  setId: string;
  cardNumber: string;
}) {
  const wantedSet =
    setId.trim().toUpperCase();

  const wantedNumber =
    normalizePrintedCollectorNumber(
      cardNumber
    );

  if (!wantedSet || !wantedNumber) {
    return false;
  }

  const escapedSet =
    wantedSet
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const setPattern =
    new RegExp(
      `(?:alt=["'][^"']*${escapedSet}[^"']*["']|>${escapedSet}<|\\b${escapedSet}\\b)`,
      "i"
    );

  const wantedParts =
    wantedNumber.match(
      /^([^/]+)\/([^/]+)$/
    );

  if (wantedParts) {
    const numerator =
      wantedParts[1]
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const denominator =
      wantedParts[2]
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // When the caller already knows the full printed collector identity,
    // preserve the strictest possible verification: exact set + numerator +
    // denominator must all appear on the official Pokémon Japan detail page.
    const identityPattern =
      new RegExp(
        `${escapedSet}\\s*(?:<[^>]+>|&nbsp;|&#160;|\\s)*` +
        `${numerator}\\s*(?:<[^>]+>|&nbsp;|&#160;|\\s)*\\/` +
        `\\s*(?:<[^>]+>|&nbsp;|&#160;|\\s)*${denominator}`,
        "i"
      );

    if (identityPattern.test(html)) {
      return true;
    }

    const numberPattern =
      new RegExp(
        `${numerator}\\s*(?:<[^>]+>|&nbsp;|&#160;|\\s)*\\/` +
        `\\s*(?:<[^>]+>|&nbsp;|&#160;|\\s)*${denominator}`,
        "i"
      );

    return (
      setPattern.test(html) &&
      numberPattern.test(html)
    );
  }

  // TCGdex localIds for Japanese cards are commonly short numerators such as
  // "002". Do not invent the denominator from cardCount.official: that field
  // does not always equal the denominator printed on the physical card
  // (Sky Legend SM10b is one example). Instead, let the official Pokémon
  // Japan detail page supply the authoritative denominator while still
  // requiring the exact provider set code and exact printed numerator.
  const numericShort =
    wantedNumber.match(/^0*(\d+)$/);

  if (!numericShort) {
    return false;
  }

  const numeratorValue =
    Number(numericShort[1]);

  const numeratorCandidates =
    Array.from(
      new Set([
        wantedNumber,
        String(numeratorValue).padStart(3, "0"),
      ])
    )
      .filter(Boolean)
      .map((value) =>
        value.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )
      );

  const numeratorPattern =
    new RegExp(
      `(?:^|[^0-9])(?:${numeratorCandidates.join("|")})` +
      `\\s*(?:<[^>]+>|&nbsp;|&#160;|\\s)*\\/` +
      `\\s*(?:<[^>]+>|&nbsp;|&#160;|\\s)*[^<\\s]+`,
      "i"
    );

  return (
    setPattern.test(html) &&
    numeratorPattern.test(html)
  );
}

function extractOfficialJapanDetailImage(
  html: string,
  setId: string
) {
  const escapedSet =
    setId.trim().replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const patterns = [
    new RegExp(
      `https://www\\.pokemon-card\\.com/assets/images/card_images/large/${escapedSet}/[^"'<>\\\\s]+\\.(?:jpg|jpeg|png|webp)`,
      "i"
    ),
    new RegExp(
      `/assets/images/card_images/large/${escapedSet}/[^"'<>\\\\s]+\\.(?:jpg|jpeg|png|webp)`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (!match?.[0]) {
      continue;
    }

    const value = match[0]
      .replace(/&amp;/g, "&")
      .trim();

    return value.startsWith("http")
      ? value
      : `https://www.pokemon-card.com${value}`;
  }

  return null;
}


async function fetchOfficialJapanDetail(
  cardId: string
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    7000
  );

  try {
    const response = await fetch(
      `https://www.pokemon-card.com/card-search/details.php/card/${encodeURIComponent(
        cardId
      )}/regu/all`,
      {
        method: "GET",
        headers: {
          Accept:
            "text/html,application/xhtml+xml",
          "Accept-Language":
            "ja,en-US;q=0.9,en;q=0.8",
          "User-Agent":
            "Mozilla/5.0",
        },
        cache: "no-store",
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Independently verified Japanese promo detail records. These are card IDs,
// NOT artwork URL overrides. Every response re-verifies the official page.
// Add further promos only after verifying their exact official detail record.
const VERIFIED_JP_PROMO_DETAILS: Record<string, { cardId: string; japaneseName: string; officialMark: string }> = {
  "bw-p:220/bw-p:mew": { cardId: "28897", japaneseName: "ミュウ", officialMark: "BWP" },
};

async function resolveOfficialJapanesePromoDetail({
  name, setId, setName, cardNumber,
}: {
  name: string;
  setId?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
}) {
  const normalizedNumber = normalizePrintedCollectorNumber(cardNumber).toLowerCase();
  const normalizedSetId = (setId || "").trim().toLowerCase();
  const normalizedSetName = normalizeMetadataText(setName);
  // Do not let a generic promo name or unrelated set opt into this lookup.
  const isBwPromo = normalizedSetId === "bw-p" ||
    (!normalizedSetId && ["black and white promos jp", "black and white promos", "bw p promotional cards"].includes(normalizedSetName));
  if (!isBwPromo || !/^\d+\/bw-p$/.test(normalizedNumber)) return null;
  const key = `bw-p:${normalizedNumber}:${normalizeMetadataText(name)}`;
  const record = VERIFIED_JP_PROMO_DETAILS[key];
  if (!record) return null;

  const html = await fetchOfficialJapanDetail(record.cardId);
  if (!html) return null;
  // The official page prints the expansion mark as BWP and the promo suffix
  // as BW-P. Verify both, the complete promo number, and Japanese name.
  if (!officialJapanDetailMatchesIdentity({
    html, setId: record.officialMark, cardNumber: normalizedNumber,
  })) return null;
  if (!html.includes(record.japaneseName)) return null;

  // Historical promo images may be stored under a folder that differs from
  // the BWP expansion mark. Only extract an official large-card image from
  // this already-verified official detail page; never construct an image URL.
  const officialImageMatch = html.match(
    /(?:https:\/\/www\.pokemon-card\.com)?\/assets\/images\/card_images\/large\/[^\/"'<>\s]+\/[^"'<>\s]+\.(?:jpg|jpeg|png|webp)/i
  );
  const imageUrl = officialImageMatch?.[0]
    ? (officialImageMatch[0].startsWith("http")
        ? officialImageMatch[0]
        : `https://www.pokemon-card.com${officialImageMatch[0]}`)
    : null;
  if (!imageUrl) return null;
  return {
    imageUrl,
    provider: "pokemon-japan-official-promo-detail-verified",
    match: {
      id: record.cardId,
      name: record.japaneseName,
      setName: setName || "BW-P Promotional cards",
      setId: "BW-P",
      cardNumber: cardNumber || null,
      officialMark: record.officialMark,
    },
  };
}

async function resolveOfficialPokemonJapanImage({
  setId,
  cardNumber,
  name,
  setName,
  diagnostics,
}: {
  setId?: string | null;
  cardNumber?: string | null;
  name: string;
  setName?: string | null;
  diagnostics?: Record<string, unknown>;
}) {
  if (diagnostics) {
    diagnostics.setId = setId || null;
    diagnostics.requestedNumber = cardNumber || null;
    diagnostics.searchRequests = 0;
    diagnostics.searchResults = 0;
    diagnostics.detailPagesFetched = 0;
    diagnostics.verifiedIdentities = 0;
    diagnostics.imageCandidates = 0;
    diagnostics.failures = [];
  }
  const report = (reason: string) => {
    if (diagnostics) {
      (diagnostics.failures as string[]).push(reason);
    }
  };
  if (!setId || !cardNumber || !name) {
    report("missing-set-id-number-or-name");
    return null;
  }

  const requestedShort =
    shortCardNumber(cardNumber)
      .replace(/\s+/g, "");

  const numericMatch =
    requestedShort.match(/^0*(\d+)$/);

  if (!numericMatch) {
    report("non-numeric-collector-number");
    return null;
  }

  // Keep the caller's collector identity authoritative. Japanese provider
  // localIds are often short numerators (for example "002"), and TCGdex's
  // cardCount.official is not guaranteed to equal the denominator printed on
  // the physical card. The official detail-page verifier below will require
  // exact set + numerator and read the denominator from Pokémon Japan itself.
  const printedNumber =
    normalizePrintedCollectorNumber(
      cardNumber
    );

  const setDetail =
    await fetchJsonWithTimeout<TcgdexJapaneseSetDetail>(
      `https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(
        setId
      )}`
    );

  /*
   * First preserve the fast path: search Pokémon Japan by the supplied source
   * name inside the exact set.
   *
   * If that returns no verified printing, retry the SAME exact set without a
   * name keyword. This is important for MintRadar's English-facing display
   * layer: a caller may legitimately carry "Mega Darkrai ex" while Pokémon
   * Japan indexes the card only as メガダークライex.
   *
   * The keyword-free retry is still safe because no result is accepted until
   * its official detail page proves BOTH the exact set code and the full
   * printed collector identity (for example M5 118/081).
   */
  const requestedNumbers =
    new Set(
      buildCollectorNumberVariants(
        cardNumber
      ).map((value) =>
        normalize(value)
      )
    );

  const sourceCard =
    Array.isArray(setDetail?.cards)
      ? setDetail.cards.find(
          (candidate) => {
            const candidateNumbers =
              new Set(
                buildCollectorNumberVariants(
                  candidate.localId
                ).map((value) =>
                  normalize(value)
                )
              );

            return Array.from(
              requestedNumbers
            ).some((value) =>
              candidateNumbers.has(value)
            );
          }
        )
      : null;

  /*
   * Prefer the exact Japanese source name from the provider set itself.
   * The UI may already be showing an English-facing display name, but the
   * official Japanese search index naturally knows the Japanese print name.
   */
  if (diagnostics) {
    diagnostics.tcgdexSetCardCount = Array.isArray(setDetail?.cards) ? setDetail.cards.length : null;
    diagnostics.providerSourceName = sourceCard?.name || null;
  }

  // An official card can be absent from the name index while still being
  // searchable by its printed collector number. Search that number inside
  // the verified expansion, then verify the official detail identity.
  // This is discovery only: a matching search result is NEVER proof of artwork.
  const numericSearchKeyword = String(Number(numericMatch[1]));
  const searchKeywords = Array.from(new Set([
    (sourceCard?.name || "").trim(),
    name.trim(),
    numericSearchKeyword,
  ])).filter(Boolean);

  const searchScopes = [
    {
      mode: "provider-set-filter",
      pg: setId,
    },
    {
      mode: "global-name-exact-detail-verification",
      pg: "",
    },
  ];

  for (const searchKeyword of searchKeywords) {
    for (const searchScope of searchScopes) {
      // Numeric searches are restricted to the exact expansion, and bounded
      // to avoid broad, expensive searches of unrelated printings.
      if (searchKeyword === numericSearchKeyword && !searchScope.pg) continue;
      let page = 1;
      let maxPage = 1;
      const pageLimit = searchKeyword === numericSearchKeyword ? 3 : 20;

      while (page <= maxPage && page <= pageLimit) {
        const url = new URL(
          "https://www.pokemon-card.com/card-search/resultAPI.php"
        );

        url.searchParams.set(
          "keyword",
          searchKeyword
        );
        url.searchParams.set("se_ta", "");
        url.searchParams.set(
          "regulation_sidebar_form",
          "all"
        );
        url.searchParams.set("illust", "");
        url.searchParams.set(
          "sm_and_keyword",
          "true"
        );

        if (searchScope.pg) {
          url.searchParams.set(
            "pg",
            searchScope.pg
          );
        }

        url.searchParams.set(
          "page",
          String(page)
        );

      if (diagnostics) {
        diagnostics.searchRequests = (diagnostics.searchRequests as number) + 1;
      }
      const controller =
        new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        7000
      );

      let response: Response;

      try {
        response = await fetch(
          url.toString(),
          {
            method: "GET",
            headers: {
              Accept:
                "application/json, text/javascript, */*; q=0.01",
              "Accept-Language":
                "ja,en-US;q=0.9,en;q=0.8",
              Referer:
                "https://www.pokemon-card.com/card-search/",
              "X-Requested-With":
                "XMLHttpRequest",
              "User-Agent":
                "Mozilla/5.0",
            },
            cache: "no-store",
            signal: controller.signal,
          }
        );
      } catch {
        report(`official-search-fetch-failed:${searchScope.mode}`);
        clearTimeout(timeout);
        break;
      }

      clearTimeout(timeout);

      if (!response.ok) {
        report(`official-search-http-${response.status}:${searchScope.mode}`);
        break;
      }

      let payload: PokemonJapanSearchResponse;

      try {
        payload =
          (await response.json()) as PokemonJapanSearchResponse;
      } catch {
        report(`official-search-invalid-json:${searchScope.mode}`);
        break;
      }

      const cards =
        Array.isArray(payload.cardList)
          ? payload.cardList
          : [];

      if (diagnostics) {
        diagnostics.searchResults = (diagnostics.searchResults as number) + cards.length;
      }
      maxPage =
        typeof payload.maxPage === "number" &&
        payload.maxPage > 0
          ? payload.maxPage
          : 1;

      for (const card of cards) {
        if (card.cardID == null) {
          continue;
        }

        const cardId = String(card.cardID);
        const html =
          await fetchOfficialJapanDetail(cardId);

        if (!html) {
          report("official-detail-fetch-failed");
          continue;
        }
        if (diagnostics) {
          diagnostics.detailPagesFetched = (diagnostics.detailPagesFetched as number) + 1;
        }

        const identityMatches =
          officialJapanDetailMatchesIdentity({
            html,
            setId,
            cardNumber: printedNumber,
          });

        if (!identityMatches) {
          if (diagnostics) {
            const rejected = (diagnostics.rejectedDetailSamples as Array<Record<string, unknown>> | undefined) || [];
            if (rejected.length < 8) {
              const setSeen = html.toUpperCase().includes(setId.trim().toUpperCase());
              const numberSeen = new RegExp(`(?:^|[^0-9])0*${Number(requestedShort)}\\s*(?:<[^>]+>|&nbsp;|&#160;|\\s)*\\/`, "i").test(html);
              rejected.push({ cardId, setSeen, numberSeen, htmlLength: html.length });
              diagnostics.rejectedDetailSamples = rejected;
            }
          }
          continue;
        }

        if (diagnostics) {
          diagnostics.verifiedIdentities = (diagnostics.verifiedIdentities as number) + 1;
        }

        const thumb =
          (card.cardThumbFile || "").trim();

        // Some official search-result records omit the thumbnail even though
        // the verified detail page contains the large image. Identity has
        // already been proven above, so the detail image is safe to use.
        const detailImage =
          extractOfficialJapanDetailImage(
            html,
            setId
          );

        const imageUrl =
          thumb
            ? (
                thumb.startsWith("http")
                  ? thumb
                  : `https://www.pokemon-card.com${
                      thumb.startsWith("/")
                        ? thumb
                        : `/${thumb}`
                    }`
              )
            : detailImage;

        if (!imageUrl) {
          report("verified-card-has-no-image");
          continue;
        }
        if (diagnostics) {
          diagnostics.imageCandidates = (diagnostics.imageCandidates as number) + 1;
        }

        return {
          imageUrl,
          provider:
            searchScope.mode ===
              "provider-set-filter"
              ? "pokemon-japan-official-exact"
              : "pokemon-japan-official-global-name-verified",
          match: {
            id: cardId,
            name:
              card.cardNameAltText ||
              name,
            setName:
              setName || null,
            cardNumber,
            printedNumber,
            setId,
            searchKeyword:
              searchKeyword || null,
          },
        };
      }

        page += 1;
      }
    }
  }

  // Last-resort official search: query the verified expansion without a
  // name keyword. This catches Japanese name-index gaps and alternate-art
  // printings. Never trust a search result's position or thumbnail: the
  // official detail page must still prove the exact set and printed number.
  // Keep this bounded to avoid crawling an entire expansion per request.
  if (setId && cardNumber) {
    for (let page = 1; page <= 2; page++) {
      const url = new URL("https://www.pokemon-card.com/card-search/resultAPI.php");
      url.searchParams.set("keyword", "");
      url.searchParams.set("se_ta", "");
      url.searchParams.set("regulation_sidebar_form", "all");
      url.searchParams.set("illust", "");
      url.searchParams.set("sm_and_keyword", "true");
      url.searchParams.set("pg", setId);
      url.searchParams.set("page", String(page));
      if (diagnostics) diagnostics.searchRequests = (diagnostics.searchRequests as number) + 1;
      const payload = await fetchJsonWithTimeout<PokemonJapanSearchResponse>(url.toString(), 7000);
      const results = Array.isArray(payload?.cardList) ? payload.cardList : [];
      if (diagnostics) diagnostics.searchResults = (diagnostics.searchResults as number) + results.length;
      if (!results.length) break;
      for (const result of results.slice(0, 12)) {
        if (result.cardID == null) continue;
        const cardId = String(result.cardID);
        const html = await fetchOfficialJapanDetail(cardId);
        if (!html) continue;
        if (diagnostics) diagnostics.detailPagesFetched = (diagnostics.detailPagesFetched as number) + 1;
        if (!officialJapanDetailMatchesIdentity({ html, setId, cardNumber: printedNumber })) continue;
        if (diagnostics) diagnostics.verifiedIdentities = (diagnostics.verifiedIdentities as number) + 1;
        const imageUrl = extractOfficialJapanDetailImage(html, setId);
        if (!imageUrl) continue;
        if (diagnostics) diagnostics.imageCandidates = (diagnostics.imageCandidates as number) + 1;
        return {
          imageUrl,
          provider: "pokemon-japan-official-set-browse-verified",
          match: { id: cardId, name: result.cardNameAltText || name,
            setName: setName || null, cardNumber, printedNumber, setId,
            searchKeyword: null },
        };
      }
      if (typeof payload?.maxPage === "number" && page >= payload.maxPage) break;
    }
  }

  // Verified set-level bootstrap for official pages when both provider
  // catalogs and the official search API have no indexed cards.
  // This is deliberately limited to a known official S6a page neighborhood.
  // Never infer an image from the page ID: verify the full printed identity
  // on every fetched official page before returning anything.
  const officialSetPageAnchors: Record<string, number[]> = {
    S6A: [39894],
  };
  const anchors = officialSetPageAnchors[setId.trim().toUpperCase()] || [];
  if (anchors.length) {
    if (diagnostics) {
      diagnostics.officialDetailDiscovery = {
        method: "verified-set-page-neighborhood",
        anchorCount: anchors.length,
        pagesAttempted: 0,
        identityMatches: 0,
      };
    }
    // The anchor first, then a bounded neighborhood. This recovers cards
    // even if the official search endpoint returns an empty cardList.
    const ids = Array.from(new Set(anchors.flatMap((anchor) => [
      anchor,
      ...Array.from({length: 8}, (_, i) => anchor + i + 1),
      ...Array.from({length: 8}, (_, i) => anchor - i - 1),
    ]))).filter((id) => id > 0);
    for (const id of ids) {
      const discovery = diagnostics?.officialDetailDiscovery as
        | { pagesAttempted: number; identityMatches: number }
        | undefined;
      if (discovery) discovery.pagesAttempted++;
      const html = await fetchOfficialJapanDetail(String(id));
      if (!html) continue;
      if (diagnostics) {
        diagnostics.detailPagesFetched =
          (diagnostics.detailPagesFetched as number) + 1;
      }
      if (!officialJapanDetailMatchesIdentity({
        html, setId, cardNumber: printedNumber,
      })) continue;
      if (discovery) discovery.identityMatches++;
      if (diagnostics) {
        diagnostics.verifiedIdentities =
          (diagnostics.verifiedIdentities as number) + 1;
      }
      const imageUrl = extractOfficialJapanDetailImage(html, setId);
      if (!imageUrl) {
        report("verified-official-detail-image-not-found");
        continue;
      }
      if (diagnostics) {
        diagnostics.imageCandidates =
          (diagnostics.imageCandidates as number) + 1;
        diagnostics.outcome = "official-detail-discovery-success";
      }
      return {
        imageUrl,
        provider: "pokemon-japan-official-detail-verified",
        match: {
          id: String(id), name, setName: setName || null,
          cardNumber, printedNumber, setId,
          searchKeyword: null,
        },
      };
    }
    report("official-detail-discovery-no-verified-image");
  }

  if (diagnostics) {
    diagnostics.outcome = "no-official-image-verified";
    if ((diagnostics.searchResults as number) === 0) report("official-search-returned-no-cards");
    else if ((diagnostics.verifiedIdentities as number) === 0) report("no-exact-set-and-number-verified");
  }
  return null;
}

// Vintage Japanese images are served ONLY from MintRadar-owned public assets.
// Add individually verified, appropriately licensed files under
// public/card-overrides/pokemon/vintage-jp/<SET_ID>/<LOCAL_ID>.png
// (or .jpg/.jpeg/.webp). No third-party hotlinks or cross-set substitutions.
async function resolveLocalVintageJapaneseImage({
  setId,
  cardNumber,
}: {
  setId?: string | null;
  cardNumber?: string | null;
}) {
  const exactSetId = (setId || "").trim().toUpperCase();
  const requestedNumber = normalizePrintedCollectorNumber(cardNumber);
  const match = requestedNumber.match(/^(\d{1,4})$/);

  if (!/^(?:PCG[1-9]|PMCG[1-9])$/.test(exactSetId) || !match) return null;

  // Full collector numbers need their own denominator verification;
  // local assets are indexed only by exact set-scoped short IDs.
  const localId = match[1].padStart(3, "0");
  const base = path.join(
    process.cwd(), "public", "card-overrides", "pokemon", "vintage-jp",
    exactSetId, localId
  );

  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    try {
      const file = await stat(`${base}.${ext}`);
      if (!file.isFile() || file.size === 0) continue;
      return {
        imageUrl: `/card-overrides/pokemon/vintage-jp/${exactSetId}/${localId}.${ext}`,
        provider: "mintradar-vintage-jp-local-exact",
        match: { setId: exactSetId, cardNumber: localId },
      };
    } catch {
      // No verified local asset for this exact set + number.
    }
  }
  return null;
}

// PCG Search: narrowly allowlisted, visually checked Japanese vintage printings.
// This is intentionally NOT a universal generated-URL fallback. HTTP 200 alone
// cannot prove the image belongs to the requested printing.
// Enable only after confirming the intended use complies with source permissions:
// ENABLE_PCG_SEARCH_VINTAGE_ARTWORK=true
const VERIFIED_PCG_SEARCH_VINTAGE_ARTWORK: Record<string, string> = {
  "E1-086": "https://pcg-search.com/img/e/e1086.png",
  "E1-118": "https://pcg-search.com/img/e/e1118.png",
  "PCG6-019": "https://pcg-search.com/img/pcg/pcg6019.png",
};

function resolveVerifiedPcgSearchVintageArtwork({
  setId,
  cardNumber,
}: {
  setId?: string | null;
  cardNumber?: string | null;
}) {
  if (process.env.ENABLE_PCG_SEARCH_VINTAGE_ARTWORK !== "true") {
    return null;
  }

  // Require a real source set code, never a guessed Pokédex number or a
  // cross-language set-name approximation. Full printed numbers are not
  // accepted until their denominators have been independently verified.
  const exactSetId = (setId || "").trim().toUpperCase();
  const rawNumber = normalizePrintedCollectorNumber(cardNumber);
  if (!/^(?:E[1-5]|PCG[1-9])$/.test(exactSetId) ||
      !/^\d{1,3}$/.test(rawNumber)) return null;

  const localId = rawNumber.padStart(3, "0");
  const providerCardId = `${exactSetId}-${localId}`;
  const imageUrl = VERIFIED_PCG_SEARCH_VINTAGE_ARTWORK[providerCardId];
  if (!imageUrl) return null;

  return {
    imageUrl,
    provider: "pcg-search-jp-vintage-curated-exact",
    match: { id: providerCardId, setId: exactSetId, cardNumber: localId },
  };
}

// V7: Resolve artwork only AFTER cross-language identity has been verified.
// A reconciled local ID is never inferred from the imported Pokédex number.
async function resolveVerifiedVintageJapaneseArtwork({
  setId, collectorNumber, providerCardId, diagnostics,
}: {
  setId: string;
  collectorNumber: string;
  providerCardId: string;
  diagnostics?: Record<string, unknown>;
}) {
  const report = (status: string, extra?: Record<string, unknown>) => {
    if (diagnostics) {
      diagnostics.status = status;
      if (extra) Object.assign(diagnostics, extra);
    }
  };
  const expectedId = `${setId}-${collectorNumber}`;
  if (providerCardId !== expectedId) {
    report("provider-card-id-mismatch", { expectedId, providerCardId });
    return null;
  }

  const local = await resolveLocalVintageJapaneseImage({
    setId, cardNumber: collectorNumber,
  });
  if (local) {
    report("verified-local-artwork-found");
    return { ...local, artworkVerified: true };
  }
  report("local-artwork-not-found");

  const detail = await fetchJsonWithTimeout<TcgdexCardDetail>(
    `https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(providerCardId)}`
  );
  if (!detail) {
    report("tcgdex-card-detail-unavailable");
    return null;
  }
  if (detail.id !== providerCardId ||
      detail.localId !== collectorNumber ||
      detail.set?.id !== setId) {
    report("tcgdex-card-detail-identity-mismatch", {
      returnedCardId: detail.id || null,
      returnedLocalId: detail.localId || null,
      returnedSetId: detail.set?.id || null,
    });
    return null;
  }
  if (!detail.image) {
    report("tcgdex-exact-printing-has-no-image");
    return null;
  }

  let base: URL;
  try { base = new URL(detail.image); }
  catch { report("tcgdex-image-url-invalid"); return null; }
  if (base.protocol !== "https:" ||
      base.hostname !== "assets.tcgdex.net" ||
      !base.pathname.startsWith("/ja/")) {
    report("tcgdex-image-url-not-allowed", {
      imageHost: base.hostname,
      imagePath: base.pathname,
    });
    return null;
  }

  const imageUrl = tcgdexImageUrl(detail.image);
  if (!imageUrl) {
    report("tcgdex-image-url-unavailable");
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(imageUrl, {
      method: "GET", cache: "no-store", signal: controller.signal,
    });
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok || !contentType.startsWith("image/")) {
      report("tcgdex-image-response-not-verified", {
        imageHttpStatus: response.status,
        imageContentType: contentType || null,
      });
      await response.body?.cancel();
      return null;
    }
    await response.body?.cancel();
  } catch {
    report("tcgdex-image-fetch-failed-or-timed-out");
    return null;
  } finally { clearTimeout(timer); }

  report("verified-tcgdex-artwork-found");
  return {
    imageUrl,
    provider: "tcgdex-jp-verified-vintage-identity",
    match: { id: providerCardId, setId, cardNumber: collectorNumber },
    artworkVerified: true,
  };
}

type SimplifiedChineseSetIdentity = {
  providerSetCode: string;
  displaySetName: string;
};

const SIMPLIFIED_CHINESE_SET_IDENTITIES: Record<
  string,
  SimplifiedChineseSetIdentity
> = {
  "gem pack 2": {
    providerSetCode: "CBB2C",
    displaySetName: "Chinese Gem Pack 2",
  },
  "gem pack vol 2": {
    providerSetCode: "CBB2C",
    displaySetName: "Chinese Gem Pack 2",
  },
  "gem pack volume 2": {
    providerSetCode: "CBB2C",
    displaySetName: "Chinese Gem Pack 2",
  },
  "chinese gem pack 2": {
    providerSetCode: "CBB2C",
    displaySetName: "Chinese Gem Pack 2",
  },
};

function simplifiedChineseSetIdentity(
  setName?: string | null
) {
  const normalized =
    normalizeMetadataText(setName || "");

  return (
    SIMPLIFIED_CHINESE_SET_IDENTITIES[
      normalized
    ] || null
  );
}

function parseCbb2cCollectorNumber(
  cardNumber?: string | null
) {
  const normalized =
    normalizeCardNumber(cardNumber)
      .replace(/\s+/g, "")
      .toUpperCase();

  const match =
    normalized.match(
      /^(\d{2})(\d{2})\/(\d{1,2})$/
    );

  if (!match) {
    return null;
  }

  const family = match[1];
  const printing = match[2];
  const denominator =
    match[3].padStart(2, "0");

  return {
    family,
    printing,
    denominator,
    providerNumber:
      `${family} ${printing}/${denominator}`,
    compactNumber:
      `${family}${printing}/${denominator}`,
  };
}

function normalizeChineseVariant(
  value?: string | null
) {
  const normalized =
    normalizeMetadataText(value || "");

  if (!normalized) {
    return null;
  }

  if (
    normalized.includes("poke ball") ||
    normalized.includes("pokeball")
  ) {
    return "poke-ball";
  }

  if (
    normalized.includes("master ball") ||
    normalized.includes("masterball")
  ) {
    return "master-ball";
  }

  if (
    normalized.includes("rotary") ||
    normalized.includes("ripple") ||
    normalized.includes("prismatic")
  ) {
    return "rotary";
  }

  if (
    normalized.includes("star pattern") ||
    normalized.includes("stars") ||
    normalized.includes("glitter")
  ) {
    return "stars";
  }

  if (
    normalized.includes("stamp")
  ) {
    return "stamp";
  }

  if (
    normalized.includes("energy")
  ) {
    return "energy";
  }

  return normalized;
}

function cbb2cExpectedVariant(
  printing: string
) {
  const value = Number(printing);

  if (value === 1 || value === 2) {
    return "energy";
  }

  if (value === 3 || value === 4) {
    return "poke-ball";
  }

  if (value === 5 || value === 6) {
    return "stars";
  }

  if (value === 7 || value === 8) {
    return "rotary";
  }

  if (value === 9 || value === 10) {
    return "master-ball";
  }

  if (value === 11 || value === 12) {
    return "stamp";
  }

  // 13+ are distinct V / VMAX / special printings and are identified
  // by exact set + collector number rather than a foil-pattern bucket.
  return null;
}

function simplifiedTcgSlugPart(
  value: string
) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function htmlEntityDecodeBasic(
  value: string
) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function absoluteSimplifiedTcgUrl(
  value: string
) {
  const clean =
    htmlEntityDecodeBasic(value.trim());

  if (!clean) {
    return null;
  }

  if (/^https?:\/\//i.test(clean)) {
    return clean;
  }

  return `https://simplifiedtcg.com${
    clean.startsWith("/") ? clean : `/${clean}`
  }`;
}

async function fetchTextWithTimeout(
  url: string,
  timeoutMs = 7000
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept:
          "text/html,application/xhtml+xml",
        "Accept-Language":
          "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function simplifiedTcgPageMatchesIdentity({
  html,
  providerSetCode,
  providerNumber,
  name,
}: {
  html: string;
  providerSetCode: string;
  providerNumber: string;
  name: string;
}) {
  const text =
    htmlEntityDecodeBasic(
      html.replace(/<[^>]+>/g, " ")
    )
      .replace(/\s+/g, " ")
      .trim();

  const normalizedText =
    text.toLowerCase();

  const wantedSet =
    providerSetCode.toLowerCase();

  const wantedNumber =
    providerNumber
      .replace(/\s+/g, "")
      .toLowerCase();

  const compactText =
    text
      .replace(/\s+/g, "")
      .toLowerCase();

  const wantedName =
    normalizeMetadataText(name);

  const pageNameCompatible =
    !wantedName ||
    normalizeMetadataText(text)
      .includes(wantedName);

  return (
    normalizedText.includes(wantedSet) &&
    compactText.includes(wantedNumber) &&
    pageNameCompatible
  );
}

function extractSimplifiedTcgImage(
  html: string
) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      const absolute =
        absoluteSimplifiedTcgUrl(
          match[1]
        );

      if (absolute) {
        return absolute;
      }
    }
  }

  // Fallback for card-image markup if social metadata is unavailable.
  const imgMatches =
    Array.from(
      html.matchAll(
        /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi
      )
    );

  for (const match of imgMatches) {
    const candidate =
      absoluteSimplifiedTcgUrl(
        match[1] || ""
      );

    if (
      candidate &&
      /(?:card|pokemon|cbb2c)/i.test(
        candidate
      )
    ) {
      return candidate;
    }
  }

  return null;
}


const PRICECHARTING_CN_VARIANT_SLUGS = [
  {
    slug: "pokeball",
    labels: [
      "pokeball",
      "poke ball",
      "poke ball pattern",
      "reverse holo",
    ],
  },
  {
    slug: "masterball",
    labels: [
      "masterball",
      "master ball",
      "master ball pattern",
    ],
  },
  {
    slug: "rotary",
    labels: [
      "rotary",
      "rotary pattern",
      "ripple",
    ],
  },
];

function priceChartingChineseNumber(
  cardNumber?: string | null
) {
  const compact =
    normalizeCardNumber(cardNumber)
      .replace(/\s+/g, "")
      .toUpperCase();

  const match =
    compact.match(
      /^0*(\d+)\/\d+$/
    );

  if (!match) {
    return null;
  }

  return String(Number(match[1]));
}

function priceChartingPageProvesCnIdentity({
  html,
  name,
  cardNumber,
  variantLabels,
}: {
  html: string;
  name: string;
  cardNumber: string;
  variantLabels: string[];
}) {
  const decoded =
    htmlEntityDecodeBasic(
      html.replace(/<[^>]+>/g, " ")
    )
      .replace(/\s+/g, " ")
      .trim();

  const normalized =
    normalizeMetadataText(decoded);

  const wantedName =
    normalizeMetadataText(name);

  const wantedFullNumber =
    normalizeCardNumber(cardNumber)
      .replace(/\s+/g, "")
      .toLowerCase();

  const compactText =
    decoded
      .replace(/\s+/g, "")
      .toLowerCase();

  const numberWithoutLeadingZeroes =
    priceChartingChineseNumber(
      cardNumber
    );

  const hasName =
    Boolean(wantedName) &&
    normalized.includes(wantedName);

  const hasSetIdentity =
    normalized.includes(
      "chinese gem pack 2"
    ) ||
    normalized.includes(
      "gem pack vol 2"
    ) ||
    normalized.includes(
      "gem pack volume 2"
    ) ||
    normalized.includes("cbb2c") ||
    normalized.includes("cbb2");

  const hasExactFullNumber =
    compactText.includes(
      wantedFullNumber
    );

  const hasMarketplaceNumber =
    Boolean(numberWithoutLeadingZeroes) &&
    (
      normalized.includes(
        `#${numberWithoutLeadingZeroes}`
      ) ||
      normalized.includes(
        ` ${numberWithoutLeadingZeroes} `
      )
    );

  const hasVariant =
    variantLabels.length === 0 ||
    variantLabels.some((label) =>
      normalized.includes(
        normalizeMetadataText(label)
      )
    );

  return (
    hasName &&
    hasSetIdentity &&
    (hasExactFullNumber ||
      hasMarketplaceNumber) &&
    hasVariant
  );
}

function extractPriceChartingCardImage(
  html: string
) {
  // PriceCharting's verified product page exposes the card art directly
  // as an <img itemprop="image"> hosted on images.pricecharting.com.
  // Prefer that product image over logos, set icons, and other page art.
  const itemPropPatterns = [
    /<img\b[^>]*\bitemprop=["']image["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
    /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*\bitemprop=["']image["'][^>]*>/i,
  ];

  for (const pattern of itemPropPatterns) {
    const match = html.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const value =
      htmlEntityDecodeBasic(
        match[1].trim()
      );

    if (
      /^https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\//i.test(
        value
      )
    ) {
      // The product page commonly renders 240.jpg but also exposes the
      // same asset at 1600.jpg. Prefer the larger copy for MintRadar.
      return value.replace(
        /\/240\.jpg(?:[?#].*)?$/i,
        "/1600.jpg"
      );
    }
  }

  // Secondary exact-host fallback in case PriceCharting changes the
  // attribute ordering/markup while keeping its product-image CDN.
  const hostedImageMatch =
    html.match(
      /https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^"'<>\\\s]+\/(?:1600|240)\.jpg/i
    );

  if (hostedImageMatch?.[0]) {
    return htmlEntityDecodeBasic(
      hostedImageMatch[0]
    ).replace(
      /\/240\.jpg(?:[?#].*)?$/i,
      "/1600.jpg"
    );
  }

  // Retain social metadata as a final fallback.
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const value =
      htmlEntityDecodeBasic(
        match[1].trim()
      );

    if (
      value &&
      /^https?:\/\//i.test(value)
    ) {
      return value;
    }
  }

  return null;
}


type CnProviderAttempt = {
  provider: string;
  pageUrl?: string | null;
  pageFetched: boolean;
  httpStatus?: number | null;
  fetchError?: string | null;
  identityMatched: boolean;
  imageFound: boolean;
  imageUrl?: string | null;
  rejectionReason?: string | null;
};

async function fetchTextDiagnostic(
  url: string,
  timeoutMs = 7000
) {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept:
          "text/html,application/xhtml+xml",
        "Accept-Language":
          "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      text,
      error: null as string | null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null as number | null,
      text: null as string | null,
      error:
        error instanceof Error
          ? error.message
          : "Unknown fetch error",
    };
  } finally {
    clearTimeout(timeout);
  }
}


async function resolvePriceChartingChineseImage({
  name,
  cardNumber,
  variant,
}: {
  name: string;
  cardNumber?: string | null;
  variant?: string | null;
}) {
  const attempts: CnProviderAttempt[] = [];

  if (!cardNumber) {
    return {
      match: null,
      attempts,
      rejectionReason: "missing-card-number",
    };
  }

  const marketNumber =
    priceChartingChineseNumber(cardNumber);

  const nameSlug =
    simplifiedTcgSlugPart(name);

  if (!marketNumber || !nameSlug) {
    return {
      match: null,
      attempts,
      rejectionReason:
        "could-not-build-market-identity",
    };
  }

  const requestedVariant =
    normalizeChineseVariant(variant);

  const candidates =
    requestedVariant
      ? PRICECHARTING_CN_VARIANT_SLUGS.filter(
          (candidate) =>
            candidate.labels.some(
              (label) =>
                normalizeChineseVariant(label) ===
                requestedVariant
            )
        )
      : [
          {
            slug: "",
            labels: [] as string[],
          },
        ];

  if (!candidates.length) {
    return {
      match: null,
      attempts,
      rejectionReason:
        "no-supported-variant-candidate",
    };
  }

  const verified: Array<{
    imageUrl: string;
    pageUrl: string;
    variantSlug: string;
  }> = [];

  for (const candidate of candidates) {
    const productSlug =
      candidate.slug
        ? `${nameSlug}-${candidate.slug}-${marketNumber}`
        : `${nameSlug}-${marketNumber}`;

    const pageUrl =
      `https://www.pricecharting.com/game/` +
      `pokemon-chinese-gem-pack-2/` +
      productSlug;

    const fetched =
      await fetchTextDiagnostic(pageUrl);

    if (!fetched.ok || !fetched.text) {
      attempts.push({
        provider: "pricecharting-cn-exact",
        pageUrl,
        pageFetched: false,
        httpStatus: fetched.status,
        fetchError: fetched.error,
        identityMatched: false,
        imageFound: false,
        rejectionReason:
          fetched.status
            ? `http-${fetched.status}`
            : "fetch-failed",
      });
      continue;
    }

    const identityMatched =
      priceChartingPageProvesCnIdentity({
        html: fetched.text,
        name,
        cardNumber,
        variantLabels: candidate.labels,
      });

    if (!identityMatched) {
      attempts.push({
        provider: "pricecharting-cn-exact",
        pageUrl,
        pageFetched: true,
        httpStatus: fetched.status,
        fetchError: null,
        identityMatched: false,
        imageFound: false,
        rejectionReason:
          "page-identity-did-not-match",
      });
      continue;
    }

    const imageUrl =
      extractPriceChartingCardImage(
        fetched.text
      );

    attempts.push({
      provider: "pricecharting-cn-exact",
      pageUrl,
      pageFetched: true,
      httpStatus: fetched.status,
      fetchError: null,
      identityMatched: true,
      imageFound: Boolean(imageUrl),
      imageUrl: imageUrl || null,
      rejectionReason:
        imageUrl
          ? null
          : "identity-matched-but-image-not-found",
    });

    if (!imageUrl) {
      continue;
    }

    verified.push({
      imageUrl,
      pageUrl,
      variantSlug: candidate.slug,
    });

    if (verified.length > 1) {
      return {
        match: null,
        attempts,
        rejectionReason:
          "multiple-exact-variant-pages-matched",
      };
    }
  }

  if (verified.length !== 1) {
    return {
      match: null,
      attempts,
      rejectionReason:
        attempts.length
          ? attempts[
              attempts.length - 1
            ].rejectionReason ||
            "no-exact-pricecharting-match"
          : "no-pricecharting-attempts",
    };
  }

  const match = verified[0];

  return {
    match: {
      imageUrl: match.imageUrl,
      provider:
        "pricecharting-cn-exact",
      match: {
        name,
        setName:
          "Chinese Gem Pack 2",
        cardNumber:
          normalizeCardNumber(cardNumber),
        variant:
          match.variantSlug || null,
        setId: "CBB2C",
      },
      sourcePage: match.pageUrl,
    },
    attempts,
    rejectionReason: null,
  };
}

async function resolveSimplifiedChineseImage({
  name,
  setName,
  cardNumber,
  variant,
}: {
  name: string;
  setName?: string | null;
  cardNumber?: string | null;
  variant?: string | null;
}) {
  const attempts: CnProviderAttempt[] = [];

  const setIdentity =
    simplifiedChineseSetIdentity(setName);

  if (!setIdentity || !cardNumber) {
    return {
      match: null,
      attempts,
      rejectionReason:
        !setIdentity
          ? "unrecognized-cn-set"
          : "missing-card-number",
    };
  }

  if (
    setIdentity.providerSetCode ===
    "CBB2C"
  ) {
    const parsed =
      parseCbb2cCollectorNumber(
        cardNumber
      );

    if (!parsed) {
      return {
        match: null,
        attempts,
        rejectionReason:
          "collector-number-parse-failed",
      };
    }

    const expectedVariant =
      cbb2cExpectedVariant(
        parsed.printing
      );

    const requestedVariant =
      normalizeChineseVariant(variant);

    if (
      expectedVariant &&
      requestedVariant &&
      expectedVariant !==
        requestedVariant
    ) {
      return {
        match: null,
        attempts,
        rejectionReason:
          "variant-conflicts-with-legacy-cbb2c-rule",
      };
    }

    const slugName =
      simplifiedTcgSlugPart(name);

    if (!slugName) {
      return {
        match: null,
        attempts,
        rejectionReason:
          "could-not-build-name-slug",
      };
    }

    const pageUrl =
      `https://simplifiedtcg.com/tcg/pokemon/simplified/` +
      `${setIdentity.providerSetCode.toLowerCase()}/` +
      `${slugName}-${parsed.family}-${parsed.printing}-${parsed.denominator}/`;

    const fetched =
      await fetchTextDiagnostic(pageUrl);

    if (!fetched.ok || !fetched.text) {
      attempts.push({
        provider: "simplifiedtcg-cn-exact",
        pageUrl,
        pageFetched: false,
        httpStatus: fetched.status,
        fetchError: fetched.error,
        identityMatched: false,
        imageFound: false,
        rejectionReason:
          fetched.status
            ? `http-${fetched.status}`
            : "fetch-failed",
      });

      return {
        match: null,
        attempts,
        rejectionReason:
          attempts[0].rejectionReason,
      };
    }

    const identityMatched =
      simplifiedTcgPageMatchesIdentity({
        html: fetched.text,
        providerSetCode:
          setIdentity.providerSetCode,
        providerNumber:
          parsed.providerNumber,
        name,
      });

    if (!identityMatched) {
      attempts.push({
        provider: "simplifiedtcg-cn-exact",
        pageUrl,
        pageFetched: true,
        httpStatus: fetched.status,
        fetchError: null,
        identityMatched: false,
        imageFound: false,
        rejectionReason:
          "page-identity-did-not-match",
      });

      return {
        match: null,
        attempts,
        rejectionReason:
          "page-identity-did-not-match",
      };
    }

    const imageUrl =
      extractSimplifiedTcgImage(
        fetched.text
      );

    attempts.push({
      provider: "simplifiedtcg-cn-exact",
      pageUrl,
      pageFetched: true,
      httpStatus: fetched.status,
      fetchError: null,
      identityMatched: true,
      imageFound: Boolean(imageUrl),
      imageUrl: imageUrl || null,
      rejectionReason:
        imageUrl
          ? null
          : "identity-matched-but-image-not-found",
    });

    if (!imageUrl) {
      return {
        match: null,
        attempts,
        rejectionReason:
          "identity-matched-but-image-not-found",
      };
    }

    return {
      match: {
        imageUrl,
        provider:
          "simplifiedtcg-cn-exact",
        match: {
          name,
          setName:
            setIdentity.displaySetName,
          cardNumber:
            parsed.compactNumber,
          providerCardNumber:
            parsed.providerNumber,
          variant:
            expectedVariant ||
            requestedVariant ||
            null,
          setId:
            setIdentity.providerSetCode,
        },
        sourcePage: pageUrl,
      },
      attempts,
      rejectionReason: null,
    };
  }

  return {
    match: null,
    attempts,
    rejectionReason:
      "unsupported-cn-set",
  };
}

// Marketplace imports sometimes omit language even when their set label
// explicitly identifies a Japanese printing. Explicit language always wins.
function inferJapaneseLanguageFromSetLabel(setName?: string | null): "JP" | null {
  const value = (setName || "").trim();
  if (!value) return null;
  if (/日本|日本語|ポケモン|[ぁ-んァ-ン一-龯]/u.test(value)) return "JP";
  if (/(?:\(\s*(?:JP|Japanese)\s*\)|\bJapanese\b|\bJP\s+Promos?\b)/i.test(value)) return "JP";
  // Explicit Japanese set codes embedded in marketplace set labels.
  // Require a code followed by a colon: never confuse M6a with SM6a,
  // and never infer JP from a bare free-text substring.
  if (/^(?:M\d+[a-z]?|SV\d+[a-z]?|SM\d+[a-z]?|S\d+[a-z]?|BW\d+[a-z]?|XY\d+[a-z]?)\s*:/i.test(value)) return "JP";
  // Common Japanese-only product label without an explicit locale suffix.
  if (/^tag\s+team\s+gx\s+all\s+stars$/i.test(value)) return "JP";
  return null;
}

function normalizeTcgdexLanguage(value?: string | null): TcgdexLanguage {
  const normalized = (value || "").trim().toLowerCase();

  if (["jp", "jpn", "ja", "japanese"].includes(normalized)) {
    return "ja";
  }

  if (["cn-tw", "zh-tw", "tw", "traditional chinese"].includes(normalized)) {
    return "zh-tw";
  }

  if (["cn", "chn", "zh-cn", "chinese", "simplified chinese"].includes(normalized)) {
    return "zh-cn";
  }

  return "en";
}


async function resolveExactRegionalTcgdexImage({
  setId,
  cardNumber,
  language,
  diagnostics,
}: {
  setId?: string | null;
  cardNumber?: string | null;
  language: TcgdexLanguage;
  diagnostics?: Record<string, unknown>;
}) {
  if (
    !setId?.trim() ||
    !cardNumber?.trim()
  ) {
    return null;
  }

  const wantedSetId = setId.trim();
  const wantedNumbers = new Set(
    buildCollectorNumberVariants(cardNumber).map((value) =>
      normalize(value)
    )
  );

  if (diagnostics) {
    diagnostics.requestedSetId = wantedSetId;
    diagnostics.requestedNumber = cardNumber;
    diagnostics.language = language;
    diagnostics.candidateAttempts = [];
    diagnostics.setLookup = { attempted: false };
  }
  const attempts = diagnostics?.candidateAttempts as Array<Record<string, unknown>> | undefined;

  const candidateIds = Array.from(
    new Set(
      buildCollectorNumberVariants(cardNumber).map(
        (numberVariant) =>
          `${wantedSetId}-${numberVariant}`
      )
    )
  );

  // Fastest and safest path: TCGdex card IDs normally use
  // "{regional set id}-{local collector id}". Try those exact identities
  // first, then verify BOTH the returned set id and local collector number.
  for (const candidateId of candidateIds) {
    const detail =
      await fetchJsonWithTimeout<TcgdexCardDetail>(
        `https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(
          candidateId
        )}`
      );

    const attempt: Record<string, unknown> = {
      candidateId,
      found: Boolean(detail?.id),
      returnedId: detail?.id || null,
      returnedSetId: detail?.set?.id || null,
      returnedNumber: detail?.localId || null,
      hasImage: Boolean(detail?.image),
    };
    attempts?.push(attempt);
    if (!detail?.id || !detail.localId) {
      attempt.outcome = "missing-card-or-number";
      continue;
    }

    const actualSetId =
      detail.set?.id?.trim() || "";

    if (
      actualSetId.toLowerCase() !==
      wantedSetId.toLowerCase()
    ) {
      attempt.outcome = "set-id-mismatch";
      continue;
    }

    const actualNumbers = new Set(
      buildCollectorNumberVariants(
        detail.localId
      ).map((value) => normalize(value))
    );

    const numberMatches =
      Array.from(wantedNumbers).some((value) =>
        actualNumbers.has(value)
      );

    if (!numberMatches) {
      attempt.outcome = "collector-number-mismatch";
      continue;
    }

    const imageUrl =
      tcgdexImageUrl(detail.image);

    if (!imageUrl) {
      attempt.outcome = "exact-card-has-no-image";
      continue;
    }
    attempt.outcome = "verified-image";

    return {
      imageUrl,
      provider: "tcgdex-regional-exact-id",
      match: {
        id: detail.id,
        name: detail.name || null,
        setName: detail.set?.name || null,
        cardNumber: detail.localId,
      },
      setId: actualSetId,
    };
  }

  // Some TCGdex catalogs do not expose the expected composite card ID.
  // In that case, inspect ONLY the explicitly supplied regional set and
  // accept a card only when the local collector number is unique in that set.
  if (diagnostics) diagnostics.setLookup = { attempted: true, setId: wantedSetId };
  const setDetail =
    await fetchJsonWithTimeout<TcgdexJapaneseSetDetail>(
      `https://api.tcgdex.net/v2/${language}/sets/${encodeURIComponent(
        wantedSetId
      )}`
    );

  const setLookup = diagnostics?.setLookup as Record<string, unknown> | undefined;
  if (setLookup) {
    setLookup.found = Boolean(setDetail?.id);
    setLookup.returnedSetId = setDetail?.id || null;
    setLookup.cardCount = Array.isArray(setDetail?.cards) ? setDetail.cards.length : null;
  }
  if (
    !setDetail ||
    !Array.isArray(setDetail.cards)
  ) {
    return null;
  }

  const exactMatches =
    setDetail.cards.filter((candidate) => {
      const candidateNumbers = new Set(
        buildCollectorNumberVariants(
          candidate.localId
        ).map((value) => normalize(value))
      );

      return Array.from(wantedNumbers).some(
        (value) => candidateNumbers.has(value)
      );
    });

  if (setLookup) {
    setLookup.numberMatchCount = exactMatches.length;
    setLookup.numberMatches = exactMatches.slice(0, 5).map((c) => ({ id: c.id, localId: c.localId, hasImage: Boolean(c.image) }));
  }
  if (
    exactMatches.length !== 1 ||
    !exactMatches[0]?.id
  ) {
    return null;
  }

  const matchedBrief = exactMatches[0];

  if (setLookup) setLookup.matchedCardId = matchedBrief.id || null;
  const detail =
    await fetchJsonWithTimeout<TcgdexCardDetail>(
      `https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(
        matchedBrief.id!
      )}`
    );

  if (setLookup) {
    setLookup.detailFound = Boolean(detail?.id);
    setLookup.detailSetId = detail?.set?.id || null;
    setLookup.detailNumber = detail?.localId || null;
    setLookup.detailHasImage = Boolean(detail?.image || matchedBrief.image);
  }
  if (!detail?.id || !detail.localId) {
    return null;
  }

  const actualSetId =
    detail.set?.id?.trim() ||
    setDetail.id?.trim() ||
    "";

  if (
    actualSetId.toLowerCase() !==
    wantedSetId.toLowerCase()
  ) {
    return null;
  }

  const actualNumbers = new Set(
    buildCollectorNumberVariants(
      detail.localId
    ).map((value) => normalize(value))
  );

  if (
    !Array.from(wantedNumbers).some((value) =>
      actualNumbers.has(value)
    )
  ) {
    return null;
  }

  const imageUrl =
    tcgdexImageUrl(
      detail.image || matchedBrief.image
    );

  if (!imageUrl) {
    return null;
  }

  return {
    imageUrl,
    provider: "tcgdex-regional-exact-set",
    match: {
      id: detail.id,
      name:
        detail.name ||
        matchedBrief.name ||
        null,
      setName:
        detail.set?.name ||
        setDetail.name ||
        null,
      cardNumber:
        detail.localId ||
        matchedBrief.localId ||
        cardNumber,
    },
    setId: actualSetId,
  };
}


// When TCGdex verifies an English card but has no artwork, the public
// PokemonTCG image CDN can still hold the exact provider-set printing.
// Never guess a set from a name: derive the CDN path only from an exact
// TCGdex card ID whose collector-number suffix matches the request.
async function verifiedEnglishPokemonCdnImage({
  tcgdexId,
  requestedNumber,
}: {
  tcgdexId?: string | null;
  requestedNumber?: string | null;
}): Promise<string | null> {
  const id = (tcgdexId || "").trim();
  const requested = normalizeCardNumber(requestedNumber).toUpperCase();
  const match = id.match(/^([a-z0-9]+)-([a-z0-9]+)$/i);
  if (!match || !requested) {
    return null;
  }

  const setId = match[1];
  const number = match[2];
  // TCGdex stores Scarlet & Violet promos as svp-176, while imported
  // inventory may label the same printed promo "SVP 176" or "SVP176".
  // Strip the prefix ONLY when the independently verified provider set
  // is svp; never strip a prefix from unrelated card numbers.
  const comparableRequested = setId.toLowerCase() === "svp"
    ? requested.replace(/^SVP[\s-]*/, "")
    : requested;
  if (number.toUpperCase() !== comparableRequested) {
    return null;
  }
  const urls = [
    `https://images.pokemontcg.io/${setId}/${number}_hires.png`,
    `https://images.pokemontcg.io/${setId}/${number}.png`,
  ];

  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(url, {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok &&
          (response.headers.get("content-type") || "").toLowerCase().startsWith("image/")) {
        return url;
      }
    } catch {
      // CDN unavailable; preserve the existing API fallback.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function resolveTcgdexImage({
  name,
  setName,
  cardNumber,
  language = "en",
}: {
  name: string;
  setName?: string | null;
  cardNumber?: string | null;
  language?: TcgdexLanguage;
}) {
  const numberVariants =
    buildCollectorNumberVariants(
      cardNumber
    );

  const diagnostics: {
    requestedName: string;
    requestedSet: string | null;
    requestedNumber: string | null;
    numberVariants: string[];
    searchAttempts: Array<{
      url: string;
      resultCount: number | null;
    }>;
    candidatesFound: number;
    shortlistedCandidates: number;
    topCandidates: Array<{
      id: string | null;
      name: string | null;
      setName: string | null;
      cardNumber: string | null;
      imageBase: string | null;
      imageUrl: string | null;
      baseScore: number;
      setScore: number;
      finalScore: number;
      numberMatches: boolean;
      localizedNameCompatible?: boolean;
    }>;
    rejectionReason: string | null;
    developmentPromoScan?: { status: string; width?: number; height?: number };
  } = {
    requestedName: name,
    requestedSet: setName || null,
    requestedNumber: cardNumber || null,
    numberVariants,
    searchAttempts: [],
    candidatesFound: 0,
    shortlistedCandidates: 0,
    topCandidates: [],
    rejectionReason: null,
  };

  const listAttempts: URL[] = [];

  for (const numberVariant of numberVariants) {
    const url = new URL(
      `https://api.tcgdex.net/v2/${language}/cards`
    );

    url.searchParams.set(
      "name",
      name
    );
    url.searchParams.set(
      "localId",
      numberVariant
    );

    listAttempts.push(url);

    // Localized TCGdex catalogs use localized card names. For JP/CN, the
    // imported display name may intentionally remain English, so collector
    // number must be allowed to discover candidates without a name filter.
    if (language !== "en") {
      const numberOnlyUrl = new URL(
        `https://api.tcgdex.net/v2/${language}/cards`
      );
      numberOnlyUrl.searchParams.set(
        "localId",
        numberVariant
      );
      listAttempts.push(numberOnlyUrl);
    }
  }

  const broadUrl = new URL(
    `https://api.tcgdex.net/v2/${language}/cards`
  );
  broadUrl.searchParams.set(
    "name",
    name
  );
  listAttempts.push(broadUrl);

  const briefs: TcgdexCardBrief[] = [];
  const seen = new Set<string>();

  for (const url of listAttempts) {
    const rows =
      await fetchJsonWithTimeout<
        TcgdexCardBrief[]
      >(url.toString());

    diagnostics.searchAttempts.push({
      url: url.toString(),
      resultCount:
        Array.isArray(rows)
          ? rows.length
          : null,
    });

    if (!Array.isArray(rows)) {
      continue;
    }

    for (const row of rows) {
      if (
        !row?.id ||
        seen.has(row.id)
      ) {
        continue;
      }

      seen.add(row.id);
      briefs.push(row);
    }

    if (briefs.length >= 40) {
      break;
    }
  }

  diagnostics.candidatesFound =
    briefs.length;

  if (!briefs.length) {
    diagnostics.rejectionReason =
      "no-tcgdex-candidates";

    return {
      match: null,
      diagnostics,
    };
  }

  const wantedName =
    normalize(name);

  const wantedNumbers =
    new Set(
      numberVariants.map((value) =>
        normalize(value)
      )
    );

  const scoredBriefs = briefs
    .map((card) => {
      const candidateName =
        normalize(card.name);
      const candidateNumbers =
        new Set(
          buildCollectorNumberVariants(
            card.localId
          ).map((value) =>
            normalize(value)
          )
        );

      const candidateNumberMatches =
        !wantedNumbers.size ||
        Array.from(
          wantedNumbers
        ).some((value) =>
          candidateNumbers.has(value)
        );

      let score = 0;

      if (
        candidateName === wantedName
      ) {
        score += 1000;
      } else if (
        candidateName.includes(
          wantedName
        ) ||
        wantedName.includes(
          candidateName
        )
      ) {
        score += 250;
      } else if (language === "en") {
        score -= 1000;
      }

      if (
        wantedNumbers.size &&
        candidateNumberMatches
      ) {
        score += language === "en" ? 800 : 1200;
      } else if (
        wantedNumbers.size
      ) {
        score -= 700;
      }

      if (card.image) {
        score += 25;
      }

      return {
        card,
        score,
      };
    })
    .sort(
      (a, b) => b.score - a.score
    );

  const shortlist = scoredBriefs
    .filter(
      ({ score }) => score >= 1000
    )
    .slice(0, 12);

  diagnostics.shortlistedCandidates =
    shortlist.length;

  // Some official alternate printings use an alphabetic collector suffix
  // (for example 92a/145) while TCGdex only exposes the base printing (92).
  // Never collapse the alternate into the base artwork. Instead, use an exact
  // name + exact base-number candidate only to discover the provider set ID,
  // then verify that the actual suffixed artwork exists on the Pokemon TCG
  // image CDN before accepting it.
  const requestedShortNumber =
    shortCardNumber(cardNumber)
      .replace(/\s+/g, "")
      .toLowerCase();

  const alphabeticVariant =
    requestedShortNumber.match(
      /^(\d+)([a-z])$/i
    );

  if (
    alphabeticVariant &&
    wantedName
  ) {
    const baseNumber =
      String(
        Number(alphabeticVariant[1])
      );

    const exactBaseCandidates =
      briefs.filter((card) => {
        const candidateName =
          normalize(card.name);

        const candidateShort =
          shortCardNumber(card.localId)
            .replace(/\s+/g, "")
            .toLowerCase();

        const candidateNumeric =
          candidateShort.match(
            /^0*(\d+)$/
          );

        return (
          candidateName === wantedName &&
          candidateNumeric &&
          String(
            Number(candidateNumeric[1])
          ) === baseNumber
        );
      });

    if (exactBaseCandidates.length === 1) {
      const baseCard =
        exactBaseCandidates[0];

      const verifiedVariantImage =
        await verifiedPokemonTcgVariantImageUrl({
          cardId: baseCard.id,
          requestedCardNumber: cardNumber,
        });

      if (
        verifiedVariantImage &&
        baseCard.id
      ) {
        const detail =
          await fetchJsonWithTimeout<
            TcgdexCardDetail
          >(
            `https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(
              baseCard.id
            )}`
          );

        diagnostics.rejectionReason = null;

        diagnostics.topCandidates = [
          {
            id: baseCard.id || null,
            name: baseCard.name || null,
            setName:
              detail?.set?.name || null,
            cardNumber:
              requestedShortNumber,
            imageBase:
              verifiedVariantImage,
            imageUrl:
              verifiedVariantImage,
            baseScore: 1800,
            setScore: 0,
            finalScore: 1800,
            numberMatches: true,
          },
          ...diagnostics.topCandidates,
        ].slice(0, 8);

        return {
          match: {
            imageUrl:
              verifiedVariantImage,
            provider:
              "pokemon-tcg-image-cdn",
            match: {
              id:
                `${baseCard.id.slice(
                  0,
                  baseCard.id.lastIndexOf("-") + 1
                )}${requestedShortNumber}`,
              name:
                baseCard.name || null,
              setName:
                detail?.set?.name || null,
              cardNumber:
                requestedShortNumber,
              score: 1800,
            },
          },
          diagnostics,
        };
      }
    }
  }

  const detailed = await Promise.all(
    shortlist.map(
      async ({ card, score }) => {
        if (!card.id) {
          return null;
        }

        const detail =
          await fetchJsonWithTimeout<
            TcgdexCardDetail
          >(
            `https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(
              card.id
            )}`
          );

        if (!detail) {
          return null;
        }

        const setScore =
          setSimilarityScore(
            setName,
            detail.set?.name
          );

        const candidateNumbers =
          new Set(
            buildCollectorNumberVariants(
              detail.localId
            ).map((value) =>
              normalize(value)
            )
          );

        const numberMatches =
          !wantedNumbers.size ||
          Array.from(
            wantedNumbers
          ).some((value) =>
            candidateNumbers.has(value)
          );

        const localizedNameCompatible =
          language === "en"
            ? true
            : localizedNameLooksCompatible(
                name,
                detail.name
              );

        return {
          card: detail,
          baseScore: score,
          score: score + setScore,
          setScore,
          numberMatches,
          localizedNameCompatible,
        };
      }
    )
  );

  const ranked = detailed
    .filter(
      (
        entry
      ): entry is NonNullable<
        typeof entry
      > => Boolean(entry)
    )
    .sort(
      (a, b) => b.score - a.score
    );

  diagnostics.topCandidates =
    ranked
      .slice(0, 8)
      .map((entry) => ({
        id:
          entry.card.id || null,
        name:
          entry.card.name || null,
        setName:
          entry.card.set?.name || null,
        cardNumber:
          entry.card.localId || null,
        imageBase:
          entry.card.image || null,
        imageUrl:
          tcgdexImageUrl(
            entry.card.image
          ),
        baseScore:
          entry.baseScore,
        setScore:
          entry.setScore,
        finalScore:
          entry.score,
        numberMatches:
          entry.numberMatches,
        localizedNameCompatible:
          entry.localizedNameCompatible,
      }));

  const best = ranked[0];

  if (!best) {
    diagnostics.rejectionReason =
      shortlist.length
        ? "tcgdex-detail-fetch-failed"
        : "no-candidate-passed-brief-confidence";

    // If nothing reached the detail stage, still expose the best brief
    // candidates so we can see their IDs/numbers/images.
    if (!diagnostics.topCandidates.length) {
      diagnostics.topCandidates =
        scoredBriefs
          .slice(0, 8)
          .map(({ card, score }) => ({
            id: card.id || null,
            name: card.name || null,
            setName: null,
            cardNumber:
              card.localId || null,
            imageBase:
              card.image || null,
            imageUrl:
              tcgdexImageUrl(
                card.image
              ),
            baseScore: score,
            setScore: 0,
            finalScore: score,
            numberMatches:
              !wantedNumbers.size ||
              buildCollectorNumberVariants(
                card.localId
              ).some((value) =>
                wantedNumbers.has(
                  normalize(value)
                )
              ),
          }));
    }

    return {
      match: null,
      diagnostics,
    };
  }

  if (
    cardNumber &&
    !best.numberMatches
  ) {
    diagnostics.rejectionReason =
      "collector-number-mismatch";

    return {
      match: null,
      diagnostics,
    };
  }

  if (
    language !== "en" &&
    !best.localizedNameCompatible
  ) {
    diagnostics.rejectionReason =
      "localized-name-mismatch";

    return {
      match: null,
      diagnostics,
    };
  }

  if (
    language !== "en" &&
    setName &&
    best.setScore <= 0
  ) {
    diagnostics.rejectionReason =
      "localized-set-mismatch";

    return {
      match: null,
      diagnostics,
    };
  }

  if (
    language === "en" &&
    setName &&
    best.setScore <= 0
  ) {
    diagnostics.rejectionReason =
      "set-mismatch";

    return {
      match: null,
      diagnostics,
    };
  }

  const imageUrl =
    tcgdexImageUrl(
      best.card.image
    );

  if (!imageUrl) {
    // TCGdex already proved the exact English name, set and number above.
    // Recover only the same printing from the independent image CDN.
    const cdnImage = language === "en" && cardNumber
      ? await verifiedEnglishPokemonCdnImage({
          tcgdexId: best.card.id,
          requestedNumber: cardNumber,
        })
      : null;

    if (cdnImage) {
      diagnostics.rejectionReason = null;
      return {
        match: {
          imageUrl: cdnImage,
          provider: "pokemon-tcg-cdn-exact",
          match: {
            id: best.card.id || null,
            name: best.card.name || null,
            setName: best.card.set?.name || null,
            cardNumber: best.card.localId || null,
            score: best.score,
          },
        },
        diagnostics,
      };
    }

    // Local-development-only scan testing. The exact TCGdex identity has
    // already been confirmed. URLs must be explicitly supplied by the developer;
    // this never approves copyright or enables production display.
    const devScanUrls: Record<string, string | undefined> = {
      "svp-176": process.env.POKEMON_SVP_176_DEV_SCAN_URL,
      "svp-211": process.env.POKEMON_SVP_211_DEV_SCAN_URL,
    };
    const devScanId = (best.card.id || "").toLowerCase();
    const devScanUrl = devScanUrls[devScanId];
    const expectedDevName = devScanId === "svp-176" ? "umbreon ex" :
      devScanId === "svp-211" ? "gothitelle" : null;
    if (process.env.NODE_ENV === "development" && language === "en" &&
        expectedDevName && best.card.name?.trim().toLowerCase() === expectedDevName &&
        devScanUrl) {
      const devScan = await inspectDevelopmentPromoScan(devScanUrl);
      diagnostics.developmentPromoScan = devScan.diagnostics;
      if (devScan.url) {
        diagnostics.rejectionReason = null;
        return {
          match: {
            imageUrl: devScan.url,
            provider: "private-svp-scan-test",
            match: {
              id: best.card.id || null,
              name: best.card.name || null,
              setName: best.card.set?.name || null,
              cardNumber: best.card.localId || null,
              score: best.score,
            },
          },
          diagnostics,
        };
      }
    }

    // Exact SVP promo artwork may be supplied by a separately licensed source.
    // An exact TCGdex name/set/number match was required above. Never substitute
    // a different printing, and never treat a public image URL as usage rights.
    const approvedPromoImages: Record<string, { name: string; url: string | undefined }> = {
      "svp-176": { name: "Umbreon ex", url: process.env.POKEMON_SVP_176_APPROVED_IMAGE_URL },
      "svp-211": { name: "Gothitelle", url: process.env.POKEMON_SVP_211_APPROVED_IMAGE_URL },
    };
    const exactPromo = approvedPromoImages[(best.card.id || "").toLowerCase()];
    if (language === "en" && exactPromo &&
        best.card.name?.trim().toLowerCase() === exactPromo.name.toLowerCase() &&
        process.env.POKEMON_SVP_PROMO_IMAGE_RIGHTS_CLEARED === "true" &&
        exactPromo.url) {
      try {
        const approvedUrl = new URL(exactPromo.url);
        // HTTPS only; never accept local/private hosts or embedded credentials.
        const hostname = approvedUrl.hostname.toLowerCase();
        const isPublicHost = hostname !== "localhost" &&
          !hostname.endsWith(".localhost") && !hostname.endsWith(".local") &&
          !hostname.endsWith(".internal") &&
          !/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(hostname) &&
          hostname !== "::1";
        if (approvedUrl.protocol === "https:" && isPublicHost &&
            !approvedUrl.username && !approvedUrl.password) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4500);
          try {
            const response = await fetch(approvedUrl.toString(), {
              method: "HEAD", cache: "no-store", signal: controller.signal,
              redirect: "error",
            });
            if (response.ok &&
                (response.headers.get("content-type") || "").toLowerCase().startsWith("image/")) {
              diagnostics.rejectionReason = null;
              return {
                match: {
                  imageUrl: approvedUrl.toString(),
                  provider: "approved-exact-svp-promo-artwork",
                  match: {
                    id: best.card.id || null,
                    name: best.card.name || null,
                    setName: best.card.set?.name || null,
                    cardNumber: best.card.localId || null,
                    score: best.score,
                  },
                },
                diagnostics,
              };
            }
          } finally {
            clearTimeout(timer);
          }
        }
      } catch {
        // Invalid or unreachable approved source: leave the image unresolved.
      }
    }

    diagnostics.rejectionReason =
      "matched-card-has-no-image";

    return {
      match: null,
      diagnostics,
    };
  }

  diagnostics.rejectionReason = null;

  return {
    match: {
      imageUrl,
      match: {
        id: best.card.id || null,
        name:
          best.card.name || null,
        setName:
          best.card.set?.name || null,
        cardNumber:
          best.card.localId || null,
        score: best.score,
      },
    },
    diagnostics,
  };
}

function wait(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function isRetryableStatus(status: number) {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function fetchPokemonCards(
  url: string,
  apiKey: string
): Promise<FetchAttemptResult> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
      };
    }

    return {
      ok: true,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown upstream request error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runProviderQuery(
  query: string,
  apiKey: string
) {
  const url = new URL(
    "https://api.pokemontcg.io/v2/cards"
  );

  url.searchParams.set("q", query);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set(
    "select",
    "id,name,number,set,images"
  );

  const requestUrl = url.toString();

  let result =
    await fetchPokemonCards(
      requestUrl,
      apiKey
    );

  const shouldRetry =
    !result.ok &&
    (
      (
        result.status !== undefined &&
        isRetryableStatus(
          result.status
        )
      ) ||
      result.status === undefined
    );

  if (shouldRetry) {
    // Round 8: aborted/network failures used to skip the retry path
    // entirely because they have no HTTP status. Give the provider
    // one clean second attempt before declaring it unavailable.
    await wait(750);

    result =
      await fetchPokemonCards(
        requestUrl,
        apiKey
      );
  }

  if (!result.ok) {
    return {
      ok: false as const,
      cards: [] as PokemonTcgCard[],
      status: result.status,
      error: result.error,
    };
  }

  const payload =
    (await result.response.json()) as PokemonTcgResponse;

  return {
    ok: true as const,
    cards: payload.data || [],
  };
}

function dedupeCards(
  cards: PokemonTcgCard[]
) {
  const seen = new Set<string>();

  return cards.filter((card) => {
    const key =
      card.id ||
      [
        normalize(card.name),
        normalize(card.set?.name),
        normalize(card.number),
      ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

// Read-only catalog identity reconciliation. The source record must have an
// exact provider ID, matching canonical English name, and matching local number.
// A counterpart image is diagnostic evidence ONLY, not proof of the same art.
async function inspectJapaneseCatalogIdentity(args: {
  setId: string | null;
  cardNumber: string | null;
  englishName: string;
}) {
  const { setId, cardNumber, englishName } = args;
  if (!setId || !cardNumber || !/^[a-z0-9-]{2,24}$/i.test(setId)) {
    return { status: "insufficient-identity" };
  }
  const localNumber = shortCardNumber(cardNumber);
  if (!/^[a-z0-9]{1,12}$/i.test(localNumber)) {
    return { status: "unsupported-collector-number" };
  }
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return { status: "catalog-access-not-configured" };
  const id = `${setId}-${localNumber}`;
  const endpoint = new URL(`${base.replace(/\/$/, "")}/rest/v1/cards`);
  endpoint.searchParams.set("select", "external_id,name,canonical_name,canonical_external_id,image_url,language,card_number");
  endpoint.searchParams.set("external_id", `ilike.${id}`);
  endpoint.searchParams.set("limit", "2");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: controller.signal, cache: "no-store",
    });
    if (!response.ok) return { status: "catalog-query-unavailable" };
    const rows = await response.json() as Array<{
      external_id: string; name: string | null; canonical_name: string | null;
      canonical_external_id: string | null; image_url: string | null;
      language: string | null; card_number: string | null;
    }>;
    const matching = rows.filter(row =>
      row.external_id.toLowerCase() === id.toLowerCase() &&
      row.language?.toUpperCase() === "JP" &&
      normalize(row.canonical_name) === normalize(englishName) &&
      buildCollectorNumberVariants(row.card_number).some(n =>
        normalize(n) === normalize(localNumber))
    );
    if (matching.length !== 1) return { status: "no-unique-verified-catalog-identity", providerId: id };
    const row = matching[0];
    return {
      status: "verified-japanese-catalog-identity",
      providerId: row.external_id,
      japaneseName: row.name,
      canonicalExternalId: row.canonical_external_id,
      hasJapaneseImage: Boolean(row.image_url?.trim()),
      // No English counterpart image is returned: canonical identity does not
      // prove artwork equivalence, and images require independent verification.
    };
  } catch {
    return { status: "catalog-query-failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  try {
    const name =
      request.nextUrl.searchParams
        .get("name")
        ?.trim() || "";

    const setName =
      request.nextUrl.searchParams
        .get("setName")
        ?.trim() || null;

    const suppliedSetId =
      request.nextUrl.searchParams
        .get("setId")
        ?.trim() || null;

    const rawCardNumber =
      request.nextUrl.searchParams
        .get("cardNumber")
        ?.trim() || null;

    const cardNumber =
      normalizeCardNumber(
        rawCardNumber
      ) || null;

    const parsedName =
      splitCanonicalNameAndVariant(
        name
      );

    // Normalize marketplace-only English name annotations for artwork lookup.
    // Keep the original inventory name and the JP/CN identity paths unchanged.
    const requestedLanguageForName =
      request.nextUrl.searchParams.get("language")?.trim() ||
      parsedName.language || inferJapaneseLanguageFromSetLabel(setName) || "EN";
    let canonicalName = parsedName.canonicalName;
    let marketplaceExclusiveVariant: string | null = null;
    if (normalizeTcgdexLanguage(requestedLanguageForName) === "en") {
      // Marketplace import names can append a Pokemon Center-exclusive label.
      // Treat this as printing metadata, never part of the card's actual name.
      // Only normalize this explicit annotation for English artwork searches.
      const exclusiveSuffix = canonicalName.match(
        /\s*\((Pok[eé]mon Center Exclusive)\)\s*$/i
      );
      if (exclusiveSuffix) {
        marketplaceExclusiveVariant = exclusiveSuffix[1];
        canonicalName = canonicalName.slice(0, exclusiveSuffix.index).trim();
      }
      // A trailing numeric annotation is redundant ONLY when it matches the
      // collector number supplied independently by the inventory record.
      const collectorPrefix = shortCardNumber(cardNumber);
      const trailingNumber = canonicalName.match(/\s*\((\d+)\)\s*$/);
      if (
        trailingNumber && collectorPrefix &&
        Number(trailingNumber[1]) === Number(collectorPrefix)
      ) {
        canonicalName = canonicalName.slice(0, trailingNumber.index).trim();
      }
      // Marketplace rarity descriptors are not part of the Pokémon name.
      canonicalName = canonicalName.replace(/\s*\((?:Secret|Secret Rare)\)\s*$/i, "").trim();
      // TCGdex uses the delta symbol in this era rather than the marketplace
      // spelling "(Delta Species)". Preserve the actual Pokémon name.
      canonicalName = canonicalName.replace(/\s*\(Delta Species\)\s*$/i, " δ").trim();
    }

    const explicitVariant =
      request.nextUrl.searchParams
        .get("variant")
        ?.trim() || null;

    const variant =
      explicitVariant ||
      parsedName.variant ||
      marketplaceExclusiveVariant;

    const requestedLanguage =
      request.nextUrl.searchParams
        .get("language")
        ?.trim() || null;

    const language =
      requestedLanguage ||
      parsedName.language ||
      inferJapaneseLanguageFromSetLabel(setName) ||
      "EN";

    const tcgdexLanguage =
      normalizeTcgdexLanguage(language);

    const inferredSetHint =
      isGenericSetName(setName)
        ? variantSetHint(variant)
        : null;

    const resolverSetName =
      isGenericSetName(setName)
        ? inferredSetHint
        : setName;

    if (!name) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          error: "Card name is required.",
        },
        { status: 400 }
      );
    }

    // -----------------------------------------
    // KNOWN MINT RADAR OVERRIDES
    // -----------------------------------------

    const knownOverride =
      findKnownImageOverride({
        name,
        setName,
        cardNumber,
      });

    if (knownOverride) {
      return NextResponse.json({
        ok: true,
        imageUrl: knownOverride.imageUrl,
        provider: "mintradar-override",
        match: {
          name: knownOverride.name,
          setName:
            knownOverride.setName || null,
          cardNumber:
            knownOverride.cardNumber || null,
        },
      });
    }

    // -----------------------------------------
    // EXACT REGIONAL TCGDEX IDENTITY RESOLVER
    // -----------------------------------------
    //
    // If MintRadar already knows the physical regional language, provider
    // set id, and collector number, use that identity before any fuzzy
    // localized search, including English promos. The returned TCGdex detail must independently prove
    // the same set id + collector number, so canonical English mappings
    // cannot substitute artwork from another physical card.
    const exactRegionalDiagnostics: Record<string, unknown> = {
      attempted: Boolean(suppliedSetId && cardNumber),
      requestedSetId: suppliedSetId,
      requestedNumber: cardNumber,
      language: tcgdexLanguage,
      outcome: "not-attempted",
    };
    if (
      suppliedSetId &&
      cardNumber
    ) {
      exactRegionalDiagnostics.outcome = "no-verified-image";
      const exactRegional =
        await resolveExactRegionalTcgdexImage({
          setId: suppliedSetId,
          cardNumber,
          language: tcgdexLanguage,
          diagnostics: exactRegionalDiagnostics,
        });

      if (exactRegional) {
        return NextResponse.json({
          ok: true,
          imageUrl: exactRegional.imageUrl,
          provider: exactRegional.provider,
          match: exactRegional.match,
          parsedIdentity: {
            originalName: name,
            canonicalName,
            variant,
            language,
            suppliedSetName: setName,
            suppliedSetId,
            resolverSetName,
            resolvedSetName:
              exactRegional.match.setName || null,
            resolvedSetId:
              exactRegional.setId,
          },
        });
      }
    }

    // Curated vintage JP artwork: after the exact TCGdex regional attempt,
    // but BEFORE the expensive official Japan searches. The three mappings
    // below were visually checked against their exact printed identities.
    // No cross-set substitutions, inferred numbers, or generic URL patterns.
    if (tcgdexLanguage === "ja" && suppliedSetId && cardNumber) {
      const curatedVintage = resolveVerifiedPcgSearchVintageArtwork({
        setId: suppliedSetId,
        cardNumber,
      });
      if (curatedVintage) {
        return NextResponse.json({
          ok: true,
          imageUrl: curatedVintage.imageUrl,
          provider: curatedVintage.provider,
          match: curatedVintage.match,
          regionalArtworkVerified: true,
          diagnostics: {
            curatedVintage: "exact-allowlist-match",
            exactRegional: exactRegionalDiagnostics,
          },
        });
      }
    }

    // -----------------------------------------
    // JAPANESE SET-SCOPED IMAGE RESOLVER
    // -----------------------------------------

    if (tcgdexLanguage === "ja") {
      const officialJapanDiagnostics: Record<string, unknown> = {};
      const discoveredJapaneseSetId = suppliedSetId ||
        await discoverJapaneseSetId(resolverSetName);
      let privateVintageIdentityDiagnostics: Record<string, unknown> | null = null;
      // Private test artwork: use only a verified card identity. This avoids
      // confusing Pokédex numbers with printed collector numbers.
      if (privateVintageArtworkEnabled() && discoveredJapaneseSetId &&
          /^(?:PMCG[1-9]|PCG[1-9]|E[1-5]|neo[1-4]|VS1)$/i.test(discoveredJapaneseSetId)) {
        const vintageIdentity = await inspectJapaneseVintageIdentity({
          setId: discoveredJapaneseSetId,
          name: canonicalName,
          suppliedNumber: cardNumber,
        });
        privateVintageIdentityDiagnostics = vintageIdentity;
        if ("identityVerified" in vintageIdentity && vintageIdentity.identityVerified === true &&
            "candidateProviderCardId" in vintageIdentity &&
            typeof vintageIdentity.candidateProviderCardId === "string") {
          const staged = await findPrivateStagedVintageArtwork(
            vintageIdentity.candidateProviderCardId
          );
          if (staged) {
            return NextResponse.json({ ok: true, ...staged,
              diagnostics: { vintageIdentity, mode: "local-development-only",
        identityApproval: "not-granted-by-historical-alias",
        artworkRights: "not-cleared-by-historical-alias" } },
              { headers: { "Cache-Control": "private, no-store" } });
          }
        }
      }
      // Official Japanese promos can have a printed series suffix (BW-P)
      // different from the official page's expansion mark (BWP). Resolve
      // only exact, independently verified official detail records.
      const verifiedPromo = await resolveOfficialJapanesePromoDetail({
        name: canonicalName,
        setId: discoveredJapaneseSetId,
        setName: resolverSetName,
        cardNumber,
      });
      if (verifiedPromo) {
        return NextResponse.json({
          ok: true,
          imageUrl: verifiedPromo.imageUrl,
          provider: verifiedPromo.provider,
          match: verifiedPromo.match,
          parsedIdentity: {
            originalName: name, canonicalName, variant, language,
            suppliedSetName: setName, suppliedSetId,
            resolverSetName, resolvedSetName: resolverSetName,
            resolvedSetId: "BW-P",
          },
        });
      }

      const jpSetScoped =
        await resolveJapaneseSetScopedImage({
          name: canonicalName,
          setName: resolverSetName,
          setId: discoveredJapaneseSetId,
          cardNumber,
        });

      if (jpSetScoped) {
        return NextResponse.json({
          ok: true,
          imageUrl:
            jpSetScoped.imageUrl,
          provider:
            jpSetScoped.provider,
          match:
            jpSetScoped.match,
          parsedIdentity: {
            originalName: name,
            canonicalName,
            variant,
            language,
            suppliedSetName: setName,
            resolverSetName,
            resolvedSetName:
              jpSetScoped.match.setName || null,
            resolvedSetId:
              jpSetScoped.setId,
          },
        });
      }

      // TCGdex may know the Japanese set but have no card rows/images for it.
      // Once the set identity is uniquely verified, use that exact Japanese
      // set code against the official Pokémon Japan card-search API. Each
      // candidate is then verified against its official detail page using
      // the full printed collector number. Never search outside this set.
      const normalizedJpSet =
        normalizeMetadataText(
          resolverSetName || ""
        );

      const jpAliases =
        JP_SET_NAME_ALIASES[
          normalizedJpSet
        ] || [];

      let officialJapanSetId =
        discoveredJapaneseSetId;

      // Backward compatibility for older callers that do not yet send setId.
      if (!officialJapanSetId && jpAliases.length) {
        const jpSets =
          await fetchJsonWithTimeout<
            TcgdexSetBrief[]
          >(
            "https://api.tcgdex.net/v2/ja/sets"
          );

        if (Array.isArray(jpSets)) {
          const matchingJpSets =
            jpSets.filter((candidate) => {
              const actual =
                (
                  candidate?.name || ""
                ).trim();

              return jpAliases.some(
                (alias) =>
                  actual === alias ||
                  actual.includes(alias) ||
                  alias.includes(actual)
              );
            });

          if (
            matchingJpSets.length === 1 &&
            matchingJpSets[0]?.id
          ) {
            officialJapanSetId =
              matchingJpSets[0].id;
          }
        }
      }

      if (officialJapanSetId) {
        // Preserve the exact collector identity supplied by the catalog.
        // If it is only a short Japanese localId (for example "002"), the
        // official resolver verifies that numerator against Pokémon Japan's
        // exact set detail instead of guessing a denominator from TCGdex.
        const officialJapanCardNumber =
          cardNumber;

        const officialJapan =
          await resolveOfficialPokemonJapanImage({
            setId: officialJapanSetId,
            cardNumber:
              officialJapanCardNumber,
            name: canonicalName,
            setName:
              resolverSetName,
            diagnostics: officialJapanDiagnostics,
          });

        if (officialJapan) {
          return NextResponse.json({
            ok: true,
            imageUrl:
              officialJapan.imageUrl,
            provider:
              officialJapan.provider,
            match:
              officialJapan.match,
            parsedIdentity: {
              originalName: name,
              canonicalName,
              variant,
              language,
              suppliedSetName:
                setName,
              suppliedSetId,
              resolverSetName,
              resolvedSetName:
                resolverSetName,
              resolvedSetId:
                officialJapanSetId,
            },
          });
        }
      }

      // Only after TCGdex and official Japan fail, try a verified local
      // vintage JP asset for the exact same set + local collector number.
      const vintageJp = await resolveLocalVintageJapaneseImage({
        setId: officialJapanSetId,
        cardNumber,
      });
      if (vintageJp) {
        return NextResponse.json({
          ok: true,
          imageUrl: vintageJp.imageUrl,
          provider: vintageJp.provider,
          match: vintageJp.match,
        });
      }

      // Last-resort curated PCG Search artwork for exactly three visually
      // verified printings. No arbitrary card-number URL generation.
      // Keep this after TCGdex, official Japan, and owned local artwork.
      const pcgSearchVintage = resolveVerifiedPcgSearchVintageArtwork({
        setId: officialJapanSetId,
        cardNumber,
      });
      if (pcgSearchVintage) {
        return NextResponse.json({
          ok: true,
          imageUrl: pcgSearchVintage.imageUrl,
          provider: pcgSearchVintage.provider,
          match: pcgSearchVintage.match,
        });
      }

      // Critical safety rule: an explicit JP provider setId is authoritative.
      // Never fall through to a global localId search when we know the set.
      const recognizedJpSet =
        Boolean(
          discoveredJapaneseSetId ||
          JP_SET_NAME_ALIASES[
            normalizeMetadataText(
              resolverSetName || ""
            )
          ]?.length
        );

      if (recognizedJpSet) {
        const vintageIdentity = privateVintageIdentityDiagnostics ||
          (discoveredJapaneseSetId && /^PMCG[1-9]$/i.test(discoveredJapaneseSetId)
            ? await inspectJapaneseVintageIdentity({
                setId: discoveredJapaneseSetId,
                name: canonicalName,
                suppliedNumber: cardNumber,
              })
            : null);
        const vintageArtworkDiagnostics: Record<string, unknown> = {
          status: "not-attempted-identity-not-verified",
        };
        // V8: the supplied Collectr number may be a Pokédex number.
        // Retry artwork ONLY using the independently verified Japanese identity.
        if (vintageIdentity &&
            "identityVerified" in vintageIdentity &&
            vintageIdentity.identityVerified === true &&
            "candidateProviderCardId" in vintageIdentity &&
            typeof vintageIdentity.candidateProviderCardId === "string" &&
            "candidateCollectorNumber" in vintageIdentity &&
            typeof vintageIdentity.candidateCollectorNumber === "string" &&
            typeof vintageIdentity.providerSetId === "string") {
          const verifiedArtwork = await resolveVerifiedVintageJapaneseArtwork({
            setId: vintageIdentity.providerSetId,
            collectorNumber: vintageIdentity.candidateCollectorNumber,
            providerCardId: vintageIdentity.candidateProviderCardId,
            diagnostics: vintageArtworkDiagnostics,
          });
          if (verifiedArtwork) {
            return NextResponse.json({
              ok: true,
              imageUrl: verifiedArtwork.imageUrl,
              provider: verifiedArtwork.provider,
              match: verifiedArtwork.match,
              regionalArtworkVerified: true,
              diagnostics: {
                discoveredJapaneseSetId,
                vintageIdentity: { ...vintageIdentity, artworkVerified: true },
                vintageArtwork: vintageArtworkDiagnostics,
              },
            });
          }
        }
        return NextResponse.json({
          ok: false,
          imageUrl: null,
          provider:
            "tcgdex-jp-set-scoped",
          reason:
            "no-confident-jp-set-scoped-match",
          diagnostics: {
            requestedName: name,
            canonicalName,
            language,
            requestedSet:
              setName || null,
            suppliedSetId,
            discoveredJapaneseSetId,
            resolverSetName:
              resolverSetName || null,
            requestedNumber:
              cardNumber || null,
            officialJapan: officialJapanDiagnostics,
            exactRegional: exactRegionalDiagnostics,
            catalogIdentity: await inspectJapaneseCatalogIdentity({
              setId: discoveredJapaneseSetId,
              cardNumber,
              englishName: canonicalName,
            }),
            vintageIdentity,
            vintageArtwork: vintageArtworkDiagnostics,
            pcgSearchVintage: {
              enabled: process.env.ENABLE_PCG_SEARCH_VINTAGE_ARTWORK === "true",
              candidate: `${(officialJapanSetId || "").toUpperCase()}-${(cardNumber || "").padStart(3, "0")}`,
              matched: false,
            },
          },
        });
      }
    }

    // -----------------------------------------
    // SIMPLIFIED CHINESE EXACT IMAGE RESOLVER
    // -----------------------------------------

    if (tcgdexLanguage === "zh-cn") {
      const cnSetIdentity =
        simplifiedChineseSetIdentity(
          resolverSetName
        );

      if (cnSetIdentity) {
        const simplifiedChineseResult =
          await resolveSimplifiedChineseImage({
            name: canonicalName,
            setName: resolverSetName,
            cardNumber,
            variant,
          });

        if (simplifiedChineseResult.match) {
          const simplifiedChinese =
            simplifiedChineseResult.match;

          return NextResponse.json({
            ok: true,
            imageUrl:
              simplifiedChinese.imageUrl,
            provider:
              simplifiedChinese.provider,
            match:
              simplifiedChinese.match,
            parsedIdentity: {
              originalName: name,
              canonicalName,
              variant,
              language,
              suppliedSetName:
                setName,
              resolverSetName,
              resolvedSetName:
                simplifiedChinese.match
                  .setName,
              resolvedSetId:
                simplifiedChinese.match
                  .setId,
              providerCardNumber:
                simplifiedChinese.match
                  .providerCardNumber,
            },
            cnDiagnostics: {
              simplifiedTcg:
                simplifiedChineseResult,
            },
          });
        }

        const priceChartingChineseResult =
          await resolvePriceChartingChineseImage({
            name: canonicalName,
            cardNumber,
            variant,
          });

        if (priceChartingChineseResult.match) {
          const priceChartingChinese =
            priceChartingChineseResult.match;

          return NextResponse.json({
            ok: true,
            imageUrl:
              priceChartingChinese.imageUrl,
            provider:
              priceChartingChinese.provider,
            match:
              priceChartingChinese.match,
            parsedIdentity: {
              originalName: name,
              canonicalName,
              variant,
              language,
              suppliedSetName:
                setName,
              resolverSetName,
              resolvedSetName:
                priceChartingChinese.match
                  .setName,
              resolvedSetId:
                priceChartingChinese.match
                  .setId,
            },
            cnDiagnostics: {
              simplifiedTcg:
                simplifiedChineseResult,
              priceCharting:
                priceChartingChineseResult,
            },
          });
        }

        // Critical safety rule: recognized Simplified Chinese sets never
        // fall through to global/localized collector-number matching.
        // Exact regional set + exact split collector identity must resolve,
        // otherwise MintRadar intentionally shows No Image.
        return NextResponse.json({
          ok: false,
          imageUrl: null,
          provider:
            "simplifiedtcg-cn-exact",
          reason:
            "no-confident-cn-exact-match",
          diagnostics: {
            requestedName: name,
            canonicalName,
            language,
            requestedSet:
              setName || null,
            resolverSetName:
              resolverSetName || null,
            requestedNumber:
              cardNumber || null,
            variant:
              variant || null,
            expectedSetId:
              cnSetIdentity.providerSetCode,
            simplifiedTcg:
              simplifiedChineseResult,
            priceCharting:
              priceChartingChineseResult,
          },
        });
      }
    }

    // -----------------------------------------
    // TCGDEX PRIMARY IMAGE RESOLVER
    // -----------------------------------------

    const tcgdexResult =
      await resolveTcgdexImage({
        name: canonicalName,
        setName: resolverSetName,
        cardNumber,
        language: tcgdexLanguage,
      });

    if (tcgdexResult.match) {
      return NextResponse.json({
        ok: true,
        imageUrl:
          tcgdexResult.match.imageUrl,
        provider:
          tcgdexResult.match.provider ||
          "tcgdex",
        match:
          tcgdexResult.match.match,
        parsedIdentity: {
          originalName: name,
          canonicalName,
          variant,
          language,
          suppliedSetName: setName,
          resolverSetName,
          resolvedSetName:
            tcgdexResult.match.match.setName || null,
        },
        tcgdexDiagnostics:
          tcgdexResult.diagnostics,
      });
    }

    const tcgdexDiagnostics =
      tcgdexResult.diagnostics;

    // PokemonTCG.io is primarily an English catalog. Never let a failed
    // localized lookup silently substitute English artwork for a JP/CN card.
    if (tcgdexLanguage !== "en") {
      return NextResponse.json({
        ok: false,
        imageUrl: null,
        provider: "tcgdex",
        reason: "no-confident-localized-match",
        diagnostics: {
          requestedName: name,
          canonicalName,
          variant,
          language,
          tcgdexLanguage,
          requestedSet: setName || null,
          resolverSetName: resolverSetName || null,
          requestedNumber: cardNumber || null,
        },
        tcgdexDiagnostics,
        exactRegionalDiagnostics,
      });
    }

    // -----------------------------------------
    // POKEMON TCG API FALLBACK
    // -----------------------------------------

    const apiKey =
      process.env.POKEMON_TCG_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          error:
            "Pokémon image fallback is not configured.",
        },
        { status: 503 }
      );
    }

    const safeName =
      escapeQueryValue(
        canonicalName
      );

    const queryAttempts: string[] = [];

    // Promo/subset collector numbers are not represented consistently
    // upstream, so try both the prefixed and numeric forms.
    for (
      const numberVariant of
      buildCollectorNumberVariants(
        cardNumber
      )
    ) {
      queryAttempts.push(
        `name:"${safeName}" number:"${escapeQueryValue(
          numberVariant
        )}"`
      );
    }

    // Keep the broad name lookup so local set/number scoring can recover
    // records where the prefix lives in the set rather than card.number.
    queryAttempts.push(
      `name:"${safeName}"`
    );

    const uniqueQueries =
      Array.from(
        new Set(queryAttempts)
      );

    let allCards: PokemonTcgCard[] = [];
    let lastUpstreamStatus:
      | number
      | undefined;
    let lastUpstreamError:
      | string
      | undefined;

    for (
      const query of uniqueQueries
    ) {
      const result =
        await runProviderQuery(
          query,
          apiKey
        );

      if (!result.ok) {
        lastUpstreamStatus =
          result.status;
        lastUpstreamError =
          result.error;
        continue;
      }

      allCards = dedupeCards([
        ...allCards,
        ...result.cards,
      ]);

      const rankedSoFar =
        allCards
          .map((card) => ({
            card,
            score: scoreCard(
              card,
              {
                name: canonicalName,
                setName: resolverSetName,
                cardNumber,
              }
            ),
          }))
          .filter(
            ({ card, score }) =>
              score >= 1000 &&
              Boolean(
                card.images?.large ||
                card.images?.small
              )
          )
          .sort(
            (a, b) =>
              b.score - a.score
          );

      const currentBest =
        rankedSoFar[0];

      // Exact name + exact collector number is already a very strong
      // match. If set similarity also contributes, there is no reason
      // to make another broad provider request.
      if (
        currentBest &&
        currentBest.score >= 1700
      ) {
        break;
      }
    }

    if (
      allCards.length === 0 &&
      (lastUpstreamStatus ||
        lastUpstreamError)
    ) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          provider:
            "pokemon-tcg-api",
          upstreamStatus:
            lastUpstreamStatus || null,
          error:
            lastUpstreamError || null,
          reason:
            "upstream-unavailable",
          tcgdexDiagnostics,
          exactRegionalDiagnostics,
        },
        { status: 502 }
      );
    }

    const ranked =
      allCards
        .map((card) => ({
          card,
          score: scoreCard(
            card,
            {
              name: canonicalName,
              setName: resolverSetName,
              cardNumber,
            }
          ),
        }))
        .filter(
          ({ card, score }) =>
            score >= 1000 &&
            Boolean(
              card.images?.large ||
              card.images?.small
            )
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

    const bestEntry = ranked[0];
    const secondEntry = ranked[1];

    if (!bestEntry) {
      const topRejectedCandidates =
        allCards
          .map((card) => ({
            card,
            score: scoreCard(
              card,
              {
                name: canonicalName,
                setName: resolverSetName,
                cardNumber,
              }
            ),
          }))
          .sort(
            (a, b) =>
              b.score - a.score
          )
          .slice(0, 8)
          .map(({ card, score }) => ({
            id: card.id || null,
            name: card.name || null,
            setName:
              card.set?.name || null,
            cardNumber:
              card.number || null,
            hasImage: Boolean(
              card.images?.large ||
              card.images?.small
            ),
            imageUrl:
              card.images?.large ||
              card.images?.small ||
              null,
            score,
          }));

      return NextResponse.json({
        ok: false,
        imageUrl: null,
        provider:
          "pokemon-tcg-api",
        reason:
          "no-confident-match",
        diagnostics: {
          requestedName: name,
          canonicalName,
          variant,
          requestedSet:
            setName || null,
          resolverSetName:
            resolverSetName || null,
          language,
          requestedNumber:
            cardNumber || null,
          candidatesChecked:
            allCards.length,
          topRejectedCandidates,
        },
        tcgdexDiagnostics,
        exactRegionalDiagnostics,
      });
    }

    // If no collector number was supplied and two printings are nearly
    // tied, do not guess which artwork belongs to the user's card.
    if (
      !cardNumber &&
      secondEntry &&
      bestEntry.score -
        secondEntry.score <
        100
    ) {
      return NextResponse.json({
        ok: false,
        imageUrl: null,
        provider:
          "pokemon-tcg-api",
        reason:
          "ambiguous-match",
        diagnostics: {
          requestedName: name,
          canonicalName,
          variant,
          requestedSet:
            setName || null,
          resolverSetName:
            resolverSetName || null,
          language,
          candidatesChecked:
            allCards.length,
        },
      });
    }

    const best = bestEntry.card;

    return NextResponse.json({
      ok: true,
      imageUrl:
        best.images?.large ||
        best.images?.small ||
        null,
      provider:
        "pokemon-tcg-api",
      match: {
        id: best.id || null,
        name: best.name || null,
        number:
          best.number || null,
        setId:
          best.set?.id || null,
        setName:
          best.set?.name || null,
      },
      diagnostics: {
        requestedName: name,
        canonicalName,
        variant,
        language,
        suppliedSetName:
          setName || null,
        resolverSetName:
          resolverSetName || null,
        resolvedSetName:
          best.set?.name || null,
        requestedNumber:
          cardNumber || null,
        candidatesChecked:
          allCards.length,
        score:
          bestEntry.score,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error";

    return NextResponse.json(
      {
        ok: false,
        imageUrl: null,
        provider:
          "pokemon-tcg-api",
        error: message,
      },
      { status: 502 }
    );
  }
}
