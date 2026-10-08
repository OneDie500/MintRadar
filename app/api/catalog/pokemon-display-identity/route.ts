import { NextRequest, NextResponse } from "next/server";

type TCGdexCardBrief = {
  id?: string | null;
  localId?: string | number | null;
  name?: string | null;
};

type TCGdexCardDetail = TCGdexCardBrief & {
  category?: string | null;
  dexId?: number[] | null;
  suffix?: string | null;
  trainerType?: string | null;
  energyType?: string | null;
  illustrator?: string | null;
  rarity?: string | null;
  regulationMark?: string | null;
  variants?: Record<string, boolean | null | undefined> | null;
  set?: {
    id?: string | null;
    name?: string | null;
    serie?: {
      id?: string | null;
    } | null;
  } | null;
};

type PokemonSpecies = {
  id?: number | null;
  name?: string | null;
  names?: Array<{
    language?: {
      name?: string | null;
    } | null;
    name?: string | null;
  }> | null;
};

const TCGDEX_BASE =
  "https://api.tcgdex.net/v2";

const POKEAPI_BASE =
  "https://pokeapi.co/api/v2";


// Conservative display-only translations for Japanese Trainer / Energy cards.
// These NEVER alter source identity, set identity, collector number, or artwork.
// Add only names whose English-facing label is known with confidence.
const JP_NON_POKEMON_DISPLAY_NAMES: Record<string, string> = {
  "おいしいおむすび": "Delicious Onigiri",
  "ぼうけんのランタン": "Adventure Lantern",
  "ポケモンキャッチャー": "Pokémon Catcher",
  "とくちゅうチョッキ": "Special Vest",
  "ヒガナの信頼": "Zinnia's Trust",
  "フウとランの修行": "Tate & Liza's Training",
  "ギリー": "Gilly",
  "MCの盛り上げ": "MC's Hype",
  "伝説の海溝": "Legendary Trench",
  "伝説の山頂": "Legendary Summit",
  "伝説の溶岩洞": "Legendary Lava Cave",
  "メガレックウザキャップ": "Mega Rayquaza Cap",
  "グロウ草エネルギー": "Grow Grass Energy",
  "ニトロ炎エネルギー": "Nitro Fire Energy",
  "バブル水エネルギー": "Bubble Water Energy",

  // M6a 30th Celebration commemorative Basic Energy display names.
  // Collector identities such as DAR remain untouched.
  "基本草エネルギー": "Basic Grass Energy",
  "基本炎エネルギー": "Basic Fire Energy",
  "基本水エネルギー": "Basic Water Energy",
  "基本雷エネルギー": "Basic Lightning Energy",
  "基本超エネルギー": "Basic Psychic Energy",
  "基本闘エネルギー": "Basic Fighting Energy",
  "基本悪エネルギー": "Basic Darkness Energy",
  "基本鋼エネルギー": "Basic Metal Energy",
};

type TCGdexEnglishCard = TCGdexCardDetail & {
  localId?: string | number | null;
  illustrator?: string | null;
  trainerType?: string | null;
  energyType?: string | null;
  effect?: string | null;
};

type TCGdexEnglishSet = {
  id?: string | null;
  name?: string | null;
  cards?: TCGdexCardBrief[] | null;
};

/*
 * Mega Evolution counterpart-family discovery.
 *
 * TCGdex's current English Mega Evolution set IDs use the zero-padded me##
 * family (me04, me05, ...), while Japanese releases use M# / M#S / M#L.
 * Derive that relationship instead of growing a hand-maintained set table.
 *
 * M1S and M1L are two Japanese halves of the same English me01 family.
 * The suffix therefore intentionally does not participate in the English ID.
 */
function derivedMegaEnglishSetId(japaneseSetId: string) {
  const normalized =
    japaneseSetId.trim().toUpperCase();

  const match =
    normalized.match(/^M(\d+)(?:[SL])?$/);

  if (!match) {
    return null;
  }

  const number = Number(match[1]);

  if (
    !Number.isInteger(number) ||
    number < 1
  ) {
    return null;
  }

  return `me${String(number).padStart(2, "0")}`;
}

/*
 * Return candidates rather than assuming provider casing/legacy aliases.
 * The derived zero-padded ID is always preferred.
 */
function englishSetCandidatesForJapaneseSet(
  japaneseSetId: string
) {
  const normalized =
    japaneseSetId.trim().toUpperCase();

  const derived =
    derivedMegaEnglishSetId(normalized);

  const candidates =
    new Set<string>();

  if (derived) {
    candidates.add(derived);

    const numberMatch =
      normalized.match(/^M(\d+)/);

    if (numberMatch) {
      const number = String(
        Number(numberMatch[1])
      );

      if (number !== "NaN") {
        candidates.add(`ME${number}`);
        candidates.add(`me${number}`);
      }
    }
  }

  return Array.from(candidates);
}

type ExactCounterpart = {
  englishSetId: string;
  englishCardNumber: string;
};

/*
 * Deterministic exceptions for cards whose JP/EN collector numbers differ.
 *
 * These are PRINT-identity bridges, not display translations:
 * the English name still comes from TCGdex's English card record.
 *
 * Keep this table intentionally narrow. Add an entry only when the exact
 * Japanese printing -> English printing relationship is independently proven.
 */
const EXACT_JP_EN_COUNTERPARTS: Record<string, ExactCounterpart> = {
  /*
   * M4 Ninja Spinner -> me04 Chaos Rising
   *
   * Verified print bridges for identities that cannot be proven uniquely from
   * TCGdex metadata alone. These are safety-net exceptions, not the primary
   * matching mechanism; the English display name is still fetched from the
   * exact English TCGdex record and category-checked before use.
   */
  "M4:073": { englishSetId: "me04", englishCardNumber: "078" }, // Great Haul Net
  "M4:73":  { englishSetId: "me04", englishCardNumber: "078" },
  "M4:074": { englishSetId: "me04", englishCardNumber: "083" }, // Transformation Tome
  "M4:74":  { englishSetId: "me04", englishCardNumber: "083" },
  "M4:079": { englishSetId: "me04", englishCardNumber: "075" }, // Ange Floette
  "M4:79":  { englishSetId: "me04", englishCardNumber: "075" },
  "M4:083": { englishSetId: "me04", englishCardNumber: "085" }, // Magnetic Metal Energy
  "M4:83":  { englishSetId: "me04", englishCardNumber: "085" },
  "M4:104": { englishSetId: "me04", englishCardNumber: "108" }, // Energy Retrieval
  "M4:107": { englishSetId: "me04", englishCardNumber: "115" }, // Tool Scrapper
  "M4:113": { englishSetId: "me04", englishCardNumber: "111" }, // Prism Tower

  /*
   * M5 Abyss Eye -> me05 Pitch Black
   *
   * These are verified PRINT-number relationships for Trainer / Energy cards.
   * We intentionally store only the counterpart number here. The displayed
   * English name is still fetched from the exact TCGdex English card record.
   *
   * Main-set non-Pokemon cards:
   * JP 070-081 are reordered in the English 084-card main set.
   */
  "M5:070": { englishSetId: "me05", englishCardNumber: "075" }, // Dark Bell
  "M5:70":  { englishSetId: "me05", englishCardNumber: "075" },

  "M5:071": { englishSetId: "me05", englishCardNumber: "073" }, // Antique Skull Fossil
  "M5:71":  { englishSetId: "me05", englishCardNumber: "073" },

  "M5:072": { englishSetId: "me05", englishCardNumber: "072" }, // Antique Armor Fossil
  "M5:72":  { englishSetId: "me05", englishCardNumber: "072" },

  "M5:073": { englishSetId: "me05", englishCardNumber: "082" }, // Tremendous Bomb
  "M5:73":  { englishSetId: "me05", englishCardNumber: "082" },

  "M5:074": { englishSetId: "me05", englishCardNumber: "074" }, // Backtrack Badge
  "M5:74":  { englishSetId: "me05", englishCardNumber: "074" },

  "M5:075": { englishSetId: "me05", englishCardNumber: "080" }, // Misty's Vitality
  "M5:75":  { englishSetId: "me05", englishCardNumber: "080" },

  "M5:076": { englishSetId: "me05", englishCardNumber: "077" }, // Gladion's Final Battle
  "M5:76":  { englishSetId: "me05", englishCardNumber: "077" },

  "M5:077": { englishSetId: "me05", englishCardNumber: "081" }, // Rust Syndicate Grunt
  "M5:77":  { englishSetId: "me05", englishCardNumber: "081" },

  "M5:078": { englishSetId: "me05", englishCardNumber: "078" }, // Gwynn
  "M5:78":  { englishSetId: "me05", englishCardNumber: "078" },

  "M5:079": { englishSetId: "me05", englishCardNumber: "076" }, // Fossil Quarry
  "M5:79":  { englishSetId: "me05", englishCardNumber: "076" },

  "M5:080": { englishSetId: "me05", englishCardNumber: "084" }, // Voltaic Lightning Energy
  "M5:80":  { englishSetId: "me05", englishCardNumber: "084" },

  "M5:081": { englishSetId: "me05", englishCardNumber: "083" }, // Shadowy Darkness Energy
  "M5:81":  { englishSetId: "me05", englishCardNumber: "083" },

  /*
   * M5 secret Trainer / Item counterparts.
   * Pokémon secret rares continue through the existing dexId path.
   */
  "M5:102": { englishSetId: "me05", englishCardNumber: "110" }, // Iron Defender
  "M5:103": { englishSetId: "me05", englishCardNumber: "107" }, // Energy Switch
  "M5:104": { englishSetId: "me05", englishCardNumber: "105" }, // Crushing Hammer
  "M5:105": { englishSetId: "me05", englishCardNumber: "106" }, // Dark Bell
  "M5:106": { englishSetId: "me05", englishCardNumber: "113" }, // Tremendous Bomb
  "M5:107": { englishSetId: "me05", englishCardNumber: "104" }, // Brave Bangle
  "M5:108": { englishSetId: "me05", englishCardNumber: "111" }, // Misty's Vitality
  "M5:109": { englishSetId: "me05", englishCardNumber: "108" }, // Gladion's Final Battle
  "M5:110": { englishSetId: "me05", englishCardNumber: "112" }, // Rust Syndicate Grunt
  "M5:111": { englishSetId: "me05", englishCardNumber: "109" }, // Gwynn
  "M5:116": { englishSetId: "me05", englishCardNumber: "118" }, // Gladion's Final Battle SIR
  "M5:117": { englishSetId: "me05", englishCardNumber: "119" }, // Gwynn SIR
};

function collectorNumberBase(value: string) {
  return clean(value)
    .replace(/^#/, "")
    .split("/")[0]
    .trim();
}

async function resolveExactMappedEnglishCounterpart(
  localizedCard: TCGdexCardDetail,
  setId: string,
  cardNumber: string,
  language: string
) {
  if (
    language.trim().toUpperCase() !== "JP" ||
    !setId ||
    !cardNumber ||
    !localizedCard.category ||
    localizedCard.category === "Pokemon"
  ) {
    return null;
  }

  const normalizedSetId =
    setId.trim().toUpperCase();

  const jpNumber =
    collectorNumberBase(cardNumber);

  const mapping =
    EXACT_JP_EN_COUNTERPARTS[
      `${normalizedSetId}:${jpNumber}`
    ];

  if (!mapping) {
    return null;
  }

  const englishCandidates =
    Array.from(
      new Set([
        mapping.englishCardNumber,
        String(
          Number(
            mapping.englishCardNumber
          )
        ),
      ])
    ).filter(
      (value) =>
        value &&
        value !== "NaN"
    );

  for (const englishNumber of englishCandidates) {
    const englishId =
      `${mapping.englishSetId}-${englishNumber}`;

    const detail =
      await fetchJson<TCGdexEnglishCard>(
        `${TCGDEX_BASE}/en/cards/${encodeURIComponent(
          englishId
        )}`
      );

    if (
      !detail?.name ||
      detail.category !==
        localizedCard.category ||
      englishCardHasJapaneseText(
        detail.name
      )
    ) {
      continue;
    }

    return {
      name: detail.name,
      englishSetId:
        mapping.englishSetId,
      sourceLocalId:
        detail.localId ??
        mapping.englishCardNumber,
      score: 1000,
      reasons: [
        "verified-print-counterpart",
      ],
    };
  }

  return null;
}

async function fetchEnglishSetCards(setId: string) {
  const set =
    await fetchJson<TCGdexEnglishSet>(
      `${TCGDEX_BASE}/en/sets/${encodeURIComponent(setId)}`
    );

  return Array.isArray(set?.cards)
    ? set.cards
    : [];
}

function normalizedComparableText(value: string | null | undefined) {
  return clean(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function englishCardHasJapaneseText(value: string | null | undefined) {
  return !!value && /[\u3040-\u9fff]/.test(value);
}


function normalizedRarity(value: string | null | undefined) {
  const normalized = normalizedComparableText(value)
    .replace(/\b(super rare|secret rare)\b/g, "ultra rare")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

function normalizedRegulationMark(value: string | null | undefined) {
  return clean(value ?? "").toUpperCase();
}

function activeVariantKeys(
  value: Record<string, boolean | null | undefined> | null | undefined
) {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key.toLowerCase())
    .sort();
}

function sameActiveVariants(
  a: Record<string, boolean | null | undefined> | null | undefined,
  b: Record<string, boolean | null | undefined> | null | undefined
) {
  const left = activeVariantKeys(a);
  const right = activeVariantKeys(b);

  if (!left.length || !right.length) {
    return false;
  }

  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function resolveEnglishCounterpart(
  localizedCard: TCGdexCardDetail,
  setId: string,
  cardNumber: string,
  language: string
) {
  if (
    language.trim().toUpperCase() !== "JP" ||
    !setId ||
    !cardNumber ||
    !localizedCard.category ||
    localizedCard.category === "Pokemon"
  ) {
    return null;
  }

  const normalizedSetId =
    setId.trim().toUpperCase();

  const englishSetCandidates =
    englishSetCandidatesForJapaneseSet(
      normalizedSetId
    );

  if (!englishSetCandidates.length) {
    return null;
  }

  let englishSetId: string | null = null;
  let englishBriefs: TCGdexCardBrief[] = [];

  for (
    const candidateSetId of
    englishSetCandidates
  ) {
    const candidateCards =
      await fetchEnglishSetCards(
        candidateSetId
      );

    if (!candidateCards.length) {
      continue;
    }

    englishSetId = candidateSetId;
    englishBriefs = candidateCards;
    break;
  }

  if (
    !englishSetId ||
    !englishBriefs.length
  ) {
    return null;
  }

  /*
   * We deliberately do NOT assume JP #N == EN #N.
   *
   * For Trainers/Energy, use the strongest non-language identity signals
   * available from the two TCGdex records:
   *   1. exact category
   *   2. exact trainer/energy subtype
   *   3. exact illustrator
   *   4. collector-number agreement only as a last-resort tie breaker
   *
   * A candidate must be uniquely supported before we expose its English name.
   */
  const candidates: TCGdexEnglishCard[] = [];

  for (const brief of englishBriefs) {
    if (!brief?.id) {
      continue;
    }

    const detail =
      await fetchJson<TCGdexEnglishCard>(
        `${TCGDEX_BASE}/en/cards/${encodeURIComponent(
          brief.id
        )}`
      );

    if (!detail) {
      continue;
    }

    if (
      detail.category !==
      localizedCard.category
    ) {
      continue;
    }

    if (
      detail.name &&
      englishCardHasJapaneseText(
        detail.name
      )
    ) {
      continue;
    }

    candidates.push(detail);
  }

  if (!candidates.length) {
    return null;
  }

  const jpTrainerType =
    normalizedComparableText(
      localizedCard.trainerType
    );
  const jpEnergyType =
    normalizedComparableText(
      localizedCard.energyType
    );

  const scored = candidates
    .map((candidate) => {
      let score = 0;
      const reasons: string[] = [];

      if (
        localizedCard.category ===
          "Trainer" &&
        jpTrainerType &&
        normalizedComparableText(
          candidate.trainerType
        ) === jpTrainerType
      ) {
        score += 30;
        reasons.push("trainerType");
      }

      if (
        localizedCard.category ===
          "Energy" &&
        jpEnergyType &&
        normalizedComparableText(
          candidate.energyType
        ) === jpEnergyType
      ) {
        score += 30;
        reasons.push("energyType");
      }

      const jpIllustrator =
        normalizedComparableText(
          (localizedCard as TCGdexCardDetail & {
            illustrator?: string | null;
          }).illustrator
        );

      const enIllustrator =
        normalizedComparableText(
          candidate.illustrator
        );

      if (
        jpIllustrator &&
        enIllustrator &&
        jpIllustrator ===
          enIllustrator
      ) {
        score += 50;
        reasons.push("illustrator");
      }

      const jpRarity =
        normalizedRarity(
          localizedCard.rarity
        );

      const enRarity =
        normalizedRarity(
          candidate.rarity
        );

      if (
        jpRarity &&
        enRarity &&
        jpRarity === enRarity
      ) {
        score += 35;
        reasons.push("rarity");
      }

      const jpRegulationMark =
        normalizedRegulationMark(
          localizedCard.regulationMark
        );

      const enRegulationMark =
        normalizedRegulationMark(
          candidate.regulationMark
        );

      if (
        jpRegulationMark &&
        enRegulationMark &&
        jpRegulationMark ===
          enRegulationMark
      ) {
        score += 20;
        reasons.push("regulationMark");
      }

      if (
        sameActiveVariants(
          localizedCard.variants,
          candidate.variants
        )
      ) {
        score += 15;
        reasons.push("variants");
      }

      const jpNumber =
        normalizedComparableText(
          cardNumber
        );

      const enNumber =
        normalizedComparableText(
          candidate.localId == null
            ? ""
            : String(candidate.localId)
        );

      if (
        jpNumber &&
        enNumber &&
        jpNumber === enNumber
      ) {
        score += 5;
        reasons.push("collector-number");
      }

      return {
        candidate,
        score,
        reasons,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score
    );

  const best = scored[0];
  const second = scored[1];

  if (!best || best.score < 70) {
    return null;
  }

  // Never choose between two equally supported English cards.
  if (
    second &&
    second.score === best.score
  ) {
    return null;
  }

  // Illustrator is the primary cross-language print identity.
  // Without it, a Trainer/Energy match is only acceptable when the
  // subtype itself uniquely identifies the candidate.
  const hasIllustratorReason =
    best.reasons.includes(
      "illustrator"
    );

  const hasSubtypeReason =
    best.reasons.includes(
      "trainerType"
    ) ||
    best.reasons.includes(
      "energyType"
    );

  const hasPrintEvidence =
    best.reasons.includes(
      "rarity"
    ) ||
    best.reasons.includes(
      "regulationMark"
    ) ||
    best.reasons.includes(
      "variants"
    );

  /*
   * Universal V2 safety gate:
   * - illustrator remains the strongest cross-language print identity;
   * - otherwise require subtype PLUS print evidence;
   * - the winner must already be unique (tie rejection above).
   *
   * Collector number alone can never authorize a translation.
   */
  if (
    !hasIllustratorReason &&
    !(
      hasSubtypeReason &&
      hasPrintEvidence
    )
  ) {
    return null;
  }

  return {
    name:
      best.candidate.name ??
      null,
    englishSetId,
    sourceLocalId:
      best.candidate.localId ??
      null,
    score: best.score,
    reasons: best.reasons,
  };
}


function japaneseNonPokemonDisplayName(
  localizedCard: TCGdexCardDetail
) {
  const sourceName = clean(localizedCard.name ?? null);

  if (!sourceName) {
    return null;
  }

  if (
    localizedCard.category !== "Trainer" &&
    localizedCard.category !== "Energy"
  ) {
    return null;
  }

  return JP_NON_POKEMON_DISPLAY_NAMES[sourceName] || null;
}

/*
 * Universal Japanese Pokémon display fallback.
 *
 * Preferred path remains localized TCGdex dexId -> PokéAPI. When upstream
 * TCGdex omits dexId, resolve the printed Japanese species name against
 * PokéAPI's localized species names. This is display-only: source set,
 * collector number, artwork, and localized card identity remain untouched.
 */
const JP_POKEMON_FORM_DISPLAY_NAMES: Record<string, string> = {
  "アローラ ナッシー": "Alolan Exeggutor",
};

type PokemonSpeciesList = {
  results?: Array<{
    name?: string | null;
    url?: string | null;
  }> | null;
};

type JapaneseSpeciesIndexEntry = {
  dexId: number;
  englishName: string;
};

let japaneseSpeciesIndexPromise:
  | Promise<Map<string, JapaneseSpeciesIndexEntry>>
  | null = null;

function japanesePokemonBaseName(
  localizedCard: TCGdexCardDetail
) {
  let sourceName = clean(localizedCard.name ?? null);

  if (!sourceName) {
    return "";
  }

  sourceName = sourceName
    .replace(/(VMAX|VSTAR|BREAK|LV\.X|GX|EX|ex|V)\s*$/i, "")
    .trim();

  sourceName = sourceName.replace(/^メガ\s*/, "").trim();

  return sourceName;
}

function pokemonSpeciesEnglishName(
  species: PokemonSpecies
) {
  const localizedEnglishName =
    species.names?.find(
      (entry) =>
        entry.language?.name === "en"
    )?.name;

  if (localizedEnglishName?.trim()) {
    return localizedEnglishName.trim();
  }

  if (!species.name?.trim()) {
    return null;
  }

  return species.name
    .split("-")
    .map(
      (part) =>
        part.charAt(0).toUpperCase() +
        part.slice(1)
    )
    .join(" ");
}

function pokemonSpeciesJapaneseNames(
  species: PokemonSpecies
) {
  return Array.from(
    new Set(
      (species.names ?? [])
        .filter((entry) => {
          const language =
            entry.language?.name ?? "";

          return (
            language === "ja" ||
            language === "ja-Hrkt"
          );
        })
        .map((entry) => clean(entry.name ?? null))
        .filter(Boolean)
    )
  );
}

async function buildJapaneseSpeciesIndex() {
  const index =
    new Map<string, JapaneseSpeciesIndexEntry>();

  const speciesList =
    await fetchJson<PokemonSpeciesList>(
      `${POKEAPI_BASE}/pokemon-species?limit=2000`
    );

  const resources =
    Array.isArray(speciesList?.results)
      ? speciesList.results
      : [];

  const batchSize = 40;

  for (
    let start = 0;
    start < resources.length;
    start += batchSize
  ) {
    const batch =
      resources.slice(start, start + batchSize);

    const speciesBatch =
      await Promise.all(
        batch.map(async (resource) => {
          if (!resource?.url) {
            return null;
          }

          return fetchJson<PokemonSpecies>(
            resource.url
          );
        })
      );

    for (const species of speciesBatch) {
      if (
        !species ||
        !Number.isInteger(species.id) ||
        !species.id ||
        species.id <= 0
      ) {
        continue;
      }

      const englishName =
        pokemonSpeciesEnglishName(species);

      if (!englishName) {
        continue;
      }

      for (
        const japaneseName of
        pokemonSpeciesJapaneseNames(species)
      ) {
        const existing =
          index.get(japaneseName);

        if (
          existing &&
          existing.dexId !== species.id
        ) {
          index.delete(japaneseName);
          continue;
        }

        index.set(japaneseName, {
          dexId: species.id,
          englishName,
        });
      }
    }
  }

  return index;
}

async function japaneseSpeciesIndex() {
  if (!japaneseSpeciesIndexPromise) {
    japaneseSpeciesIndexPromise =
      buildJapaneseSpeciesIndex().catch(
        (error) => {
          japaneseSpeciesIndexPromise = null;
          throw error;
        }
      );
  }

  return japaneseSpeciesIndexPromise;
}

async function resolveJapanesePokemonDisplayName(
  localizedCard: TCGdexCardDetail,
  language: string
) {
  if (
    language.trim().toUpperCase() !== "JP" ||
    localizedCard.category !== "Pokemon"
  ) {
    return null;
  }

  const baseName =
    japanesePokemonBaseName(localizedCard);

  if (!baseName) {
    return null;
  }

  const verifiedFormName =
    JP_POKEMON_FORM_DISPLAY_NAMES[baseName];

  if (verifiedFormName) {
    return {
      name: verifiedFormName,
      dexId: null as number | null,
      method:
        "jp-verified-form-display-fallback",
    };
  }

  try {
    const index =
      await japaneseSpeciesIndex();

    const resolved =
      index.get(baseName);

    if (!resolved) {
      return null;
    }

    return {
      name: resolved.englishName,
      dexId: resolved.dexId,
      method:
        "jp-pokeapi-localized-species-index",
    };
  } catch {
    return null;
  }
}

function pokemonDisplaySuffix(
  localizedCard: TCGdexCardDetail
) {
  const explicit = clean(localizedCard.suffix ?? null);

  if (explicit) {
    const normalized = explicit.toUpperCase();

    if (normalized === "EX") {
      // Modern Japanese "ex" and legacy "EX" are visually distinct.
      // The source card name tells us which casing the printed identity uses.
      return /ex\s*$/i.test(clean(localizedCard.name ?? null)) &&
        !/EX\s*$/.test(clean(localizedCard.name ?? null))
        ? "ex"
        : "EX";
    }

    if (normalized === "GX") return "GX";
    if (normalized === "V") return "V";
    if (normalized === "VMAX") return "VMAX";
    if (normalized === "VSTAR") return "VSTAR";
    if (normalized === "BREAK") return "BREAK";
    if (normalized === "LV.X") return "LV.X";

    return explicit;
  }

  const sourceName = clean(localizedCard.name ?? null);

  // Safe fallback when the provider omits suffix but the localized printed
  // name itself carries a well-known card designation.
  const match = sourceName.match(
    /(VMAX|VSTAR|BREAK|LV\.X|GX|EX|ex|V)\s*$/i
  );

  if (!match) {
    return null;
  }

  const raw = match[1];

  if (raw.toLowerCase() === "ex") {
    return /ex\s*$/.test(sourceName) &&
      !/EX\s*$/.test(sourceName)
      ? "ex"
      : "EX";
  }

  return raw.toUpperCase();
}

function pokemonDisplayPrefix(
  localizedCard: TCGdexCardDetail
) {
  const sourceName = clean(localizedCard.name ?? null);

  // Japanese MEGA-era names carry メガ in the printed card name while
  // PokéAPI resolves only the base species. Preserve that display identity.
  return sourceName.startsWith("メガ") ? "Mega " : "";
}

function composeEnglishPokemonDisplayName(
  speciesName: string,
  localizedCard: TCGdexCardDetail
) {
  const prefix = pokemonDisplayPrefix(localizedCard);
  const suffix = pokemonDisplaySuffix(localizedCard);

  return `${prefix}${speciesName}${suffix ? ` ${suffix}` : ""}`.trim();
}

function clean(value: string | null) {
  return (value || "").trim();
}

function tcgdexLanguage(
  language: string
) {
  const normalized =
    language.trim().toUpperCase();

  if (normalized === "JP") {
    return "ja";
  }

  if (normalized === "CN-TW") {
    return "zh-tw";
  }

  if (normalized === "CN") {
    return "zh-cn";
  }

  return "en";
}

async function fetchJson<T>(
  url: string
): Promise<T | null> {
  try {
    const response =
      await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function resolveLocalizedCard(
  name: string,
  setId: string,
  cardNumber: string,
  language: string
) {
  const sourceLanguage =
    tcgdexLanguage(language);

  // Best path: use the exact LOCALIZED card identity.
  // This is safe because setId/cardNumber are only used inside the card's
  // own source language. We never reuse a JP/CN regional ID in EN.
  if (setId && cardNumber) {
    const exactId =
      `${setId}-${cardNumber}`;

    const exact =
      await fetchJson<TCGdexCardDetail>(
        `${TCGDEX_BASE}/${sourceLanguage}/cards/${encodeURIComponent(
          exactId
        )}`
      );

    if (
      exact?.name &&
      exact.name === name
    ) {
      return exact;
    }
  }

  // Fallback for rows whose stored set/card formatting differs slightly:
  // search only in the source language, then require an exact localized name.
  const candidates =
    await fetchJson<TCGdexCardBrief[]>(
      `${TCGDEX_BASE}/${sourceLanguage}/cards?name=${encodeURIComponent(
        name
      )}`
    );

  if (!Array.isArray(candidates)) {
    return null;
  }

  const exactNameCandidates =
    candidates.filter(
      (candidate) =>
        candidate.name === name &&
        candidate.id
    );

  // Prefer a candidate whose localId agrees with our source card number.
  const preferred =
    exactNameCandidates.find(
      (candidate) =>
        cardNumber &&
        String(
          candidate.localId ?? ""
        ) === cardNumber
    ) ||
    exactNameCandidates[0];

  if (!preferred?.id) {
    return null;
  }

  return fetchJson<TCGdexCardDetail>(
    `${TCGDEX_BASE}/${sourceLanguage}/cards/${encodeURIComponent(
      preferred.id
    )}`
  );
}

async function resolveEnglishPokemonName(
  localizedCard: TCGdexCardDetail
) {
  if (
    localizedCard.category !==
      "Pokemon" ||
    !Array.isArray(
      localizedCard.dexId
    ) ||
    localizedCard.dexId.length === 0
  ) {
    return null;
  }

  const dexId =
    localizedCard.dexId.find(
      (value) =>
        Number.isInteger(value) &&
        value > 0
    );

  if (!dexId) {
    return null;
  }

  const species =
    await fetchJson<PokemonSpecies>(
      `${POKEAPI_BASE}/pokemon-species/${dexId}`
    );

  if (!species) {
    return null;
  }

  const englishName =
    species.names?.find(
      (entry) =>
        entry.language?.name ===
        "en"
    )?.name;

  // PokéAPI's canonical resource name is English-like, but the localized
  // English name field is the preferred display value.
  if (englishName?.trim()) {
    return englishName.trim();
  }

  if (species.name?.trim()) {
    return species.name
      .split("-")
      .map(
        (part) =>
          part.charAt(0).toUpperCase() +
          part.slice(1)
      )
      .join(" ");
  }

  return null;
}

export async function GET(
  request: NextRequest
) {
  const params =
    request.nextUrl.searchParams;

  const name =
    clean(params.get("name"));

  const setName =
    clean(params.get("setName"));

  const setId =
    clean(params.get("setId"));

  const cardNumber =
    clean(params.get("cardNumber"));

  const language =
    clean(params.get("language")) ||
    "EN";

  if (!name) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing card name.",
      },
      {
        status: 400,
      }
    );
  }

  if (
    language.toUpperCase() ===
    "EN"
  ) {
    return NextResponse.json({
      ok: true,
      cardName: name,
      setName:
        setName || null,
      method:
        "already-english",
    });
  }

  const localizedCard =
    await resolveLocalizedCard(
      name,
      setId,
      cardNumber,
      language
    );

  if (!localizedCard) {
    return NextResponse.json({
      ok: true,
      cardName: name,
      setName:
        setName || null,
      method:
        "preserve-source-no-localized-card",
    });
  }

  const englishPokemonName =
    await resolveEnglishPokemonName(
      localizedCard
    );

  if (englishPokemonName) {
    return NextResponse.json({
      ok: true,
      cardName:
        composeEnglishPokemonDisplayName(
          englishPokemonName,
          localizedCard
        ),
      // Keep the regional source set name. We are translating display only;
      // we do not invent an English release identity.
      setName:
        setName ||
        localizedCard.set?.name ||
        null,
      method:
        "tcgdex-dexid-to-pokeapi-species-with-card-identity",
      dexId:
        localizedCard.dexId?.[0] ||
        null,
      suffix:
        pokemonDisplaySuffix(localizedCard),
    });
  }

  const japanesePokemonFallback =
    await resolveJapanesePokemonDisplayName(
      localizedCard,
      language
    );

  if (japanesePokemonFallback) {
    return NextResponse.json({
      ok: true,
      cardName:
        composeEnglishPokemonDisplayName(
          japanesePokemonFallback.name,
          localizedCard
        ),
      setName:
        setName ||
        localizedCard.set?.name ||
        null,
      method:
        japanesePokemonFallback.method,
      dexId:
        japanesePokemonFallback.dexId,
      suffix:
        pokemonDisplaySuffix(localizedCard),
    });
  }

  const exactMappedEnglishCounterpart =
    await resolveExactMappedEnglishCounterpart(
      localizedCard,
      setId,
      cardNumber,
      language
    );

  const englishCounterpart =
    exactMappedEnglishCounterpart ??
    await resolveEnglishCounterpart(
      localizedCard,
      setId,
      cardNumber,
      language
    );

  if (englishCounterpart?.name) {
    return NextResponse.json({
      ok: true,
      cardName:
        englishCounterpart.name,
      setName:
        setName ||
        localizedCard.set?.name ||
        null,
      method:
        exactMappedEnglishCounterpart
          ? "tcgdex-verified-jp-en-print-counterpart"
          : "tcgdex-exact-jp-en-counterpart",
      englishSetId:
        englishCounterpart.englishSetId,
      englishCardNumber:
        englishCounterpart.sourceLocalId,
      matchScore:
        englishCounterpart.score,
      matchReasons:
        englishCounterpart.reasons,
    });
  }

  const englishNonPokemonName =
    language.toUpperCase() === "JP"
      ? japaneseNonPokemonDisplayName(
          localizedCard
        )
      : null;

  if (englishNonPokemonName) {
    return NextResponse.json({
      ok: true,
      cardName: englishNonPokemonName,
      setName:
        setName ||
        localizedCard.set?.name ||
        null,
      method:
        localizedCard.category === "Energy"
          ? "jp-energy-display-map"
          : "jp-trainer-display-map",
    });
  }

  // Unknown Trainer / Energy / unresolved identities remain source-language.
  // Never substitute a different English card merely because a regional
  // collector ID happens to collide.
  return NextResponse.json({
    ok: true,
    cardName: name,
    setName:
      setName ||
      localizedCard.set?.name ||
      null,
    method:
      "preserve-source-non-species",
    counterpartFamilyCandidates:
      language.toUpperCase() === "JP"
        ? englishSetCandidatesForJapaneseSet(
            setId
          )
        : [],
  });
}
