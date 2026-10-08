import { createClient } from "@supabase/supabase-js";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

type CatalogSetRow = {
  external_id: string;
  data_source: "tcgdex";
  language: CatalogLanguage;
  name: string;
  category: "Pokemon";
  code: string;
  card_count: number;
  released_at: string | null;
  set_type: string | null;
  series_id: string | null;
  logo_url: string | null;
  symbol_url: string | null;
  external_updated_at: string;
};

type CardRow = {
  external_id: string;
  data_source: "tcgdex";
  language: CatalogLanguage;
  name: string;
  set_name: string;
  card_number: string;
  image_url: string;
  category: "Pokemon";
  rarity: string | null;
  edition: string | null;
  finish: string | null;
  canonical_name: string | null;
  canonical_external_id: string | null;
  canonical_language: "EN" | null;
  canonical_confidence: number | null;
  external_updated_at: string;
};

const ROOT = process.cwd();
const CACHE_DIR = join(
  ROOT,
  ".cache",
  "tcgdex-cards-database"
);
const DATA_DIR = join(CACHE_DIR, "data");
const ASIA_DATA_DIR = join(
  CACHE_DIR,
  "data-asia"
);

type CatalogLanguage =
  | "EN"
  | "JP"
  | "CN-TW"
  | "CN";


type CardIdentity = {
  externalId: string;
  name: string;
  category: string | null;
  dexIds: number[];
  illustrator: string | null;
  suffix: string | null;
  stage: string | null;
  trainerType: string | null;
  energyType: string | null;
  regulationMark: string | null;
  rarity: string | null;
  variantKey: string;
  // Printed-card evidence used for cross-language Pokémon identity. These
  // language-independent fields are additive evidence only; existing safety
  // gates and production thresholds still apply.
  hp: number | null;
  types: string[];
  weaknesses: string[];
  resistances: string[];
  retreat: number | null;
  attackFingerprint: string[];
  modifiers: IdentityModifiers;
};

type IdentityModifiers = {
  exLower: boolean;
  exUpper: boolean;
  gx: boolean;
  v: boolean;
  vmax: boolean;
  vstar: boolean;
  break: boolean;
  legend: boolean;
  radiant: boolean;
  mega: boolean;
  modernMegaEx: boolean;
  legacyMegaEX: boolean;
  alolan: boolean;
  galarian: boolean;
  dark: boolean;
  teamRocket: boolean;
  spG: boolean;
  prismStar: boolean;
};

const englishIdentities: CardIdentity[] = [];

type CnGemDiagnosticRow = {
  setId: string;
  setName: string;
  localId: string;
  sourceName: string;
  identity: CardIdentity;
  canonicalExternalId: string | null;
  canonicalName: string | null;
  confidence: number | null;
};

const cnGemDiagnosticRows: CnGemDiagnosticRow[] = [];
const cnGemSetNames = new Map<string, string>();

type CnSetDiscoveryRow = {
  setId: string;
  setName: string;
  seriesId: string | null;
  cardCount: number;
  releasedAt: string | null;
};

type CnGemSetAuditMeta = {
  setId: string;
  setName: string;
  rawCardFiles: number;
  zhCnNamedCards: number;
};

const cnSetDiscoveryRows = new Map<string, CnSetDiscoveryRow>();
const cnGemSetAuditMeta = new Map<string, CnGemSetAuditMeta>();

// Read-only supplemental Gem Pack source audit. This intentionally does NOT
// create cardRows, canonical promotions, or Supabase writes. The goal is to
// verify that an external physical-print catalog can fill TCGdex's set-shell
// gap before we trust it in production.
type CnGemSupplementalSetProbe = {
  setId: string;
  expectedAlias: string;
  sourceUrl: string;
  tcgdexName: string | null;
  tcgdexCardCount: number | null;
  tcgdexReleasedAt: string | null;
  sourceCardCount: number | null;
  sourceReleasedAt: string | null;
  sourceReachable: boolean;
  hasPhysicalNumbers: boolean;
  hasChineseNames: boolean;
  hasEnglishNames: boolean;
  hasRarity: boolean;
  hasIllustrator: boolean;
  hasNationalDex: boolean;
  hasImageEvidence: boolean;
  notes: string[];
};

const cnGemSupplementalSetProbes: CnGemSupplementalSetProbe[] = [];

function gemPackVolumeFromSetId(setId: string): number | null {
  const match = setId.match(/^CBB(\d+)C$/i);
  return match ? Number(match[1]) : null;
}

function isCnGemPackSetId(setId: string) {
  // TCGdex models Simplified Chinese Gem Packs as CBB<number>C.
  // Use the stable source set ID rather than translated/localized display text.
  return /^CBB\d+C$/i.test(setId);
}

function isCnGemPackSetName(name: string) {
  // Diagnostic fallback only. The production-safe Gem audit keys from set ID.
  return /gem\s*pack|宝石包|寶石包/i.test(name);
}

// Diagnostic-only evidence collected from matches the existing family resolver
// already considers safe. This NEVER participates in canonical matching.
type FamilyPositionSample = {
  sourceSetId: string;
  sourceExternalId: string;
  sourceLocalId: string;
  englishExternalId: string;
  englishSetId: string;
  englishLocalId: string;
  confidence: number;
};

const familyPositionSamples: FamilyPositionSample[] = [];

type FamilySequenceCandidate = {
  externalId: string;
  name: string;
  englishNumber: number | null;
  score: number;
  strong: number;
  signals: string[];
};

type FamilySequenceObservation = {
  sourceSetId: string;
  sourceExternalId: string;
  sourceLanguage: CatalogLanguage;
  sourceLocalId: string;
  sourceName: string;
  sourceNumber: number | null;
  sourceCategory: string | null;
  canonicalExternalId: string | null;
  canonicalConfidence: number | null;
  candidates: FamilySequenceCandidate[];
};

const familySequenceObservations = new Map<string, FamilySequenceObservation>();


// Explicit cross-language counterpart mappings for sets where TCGdex models the
// Japanese and English releases as different card-number systems. These mappings
// are intentionally source-external-id scoped so they cannot affect unrelated sets.
const EXPLICIT_ENGLISH_COUNTERPARTS = new Map<string, string>([
  // Keep this mechanism for genuinely exceptional cross-language printings.
  // M6a / 30th Celebration currently has no forced card-level counterparts:
  // the set-family resolver gets first chance to resolve the release naturally.
]);

// Cross-language release families. When a source set is known to correspond
// to one or more English releases, search those English releases first before
// allowing the global matcher to consider unrelated printings.
const ENGLISH_SET_FAMILIES = new Map<string, string[]>([
  // 30th Celebration: proven family, including Classic Collection.
  ["M6a", ["30th", "30th-c"]],

  // Sword & Shield Battle Styles was assembled from Japan's paired
  // Single Strike Master / Rapid Strike Master releases.
  ["S5I", ["swsh5"]],
  ["S5R", ["swsh5"]],
]);


const ASIA_LANGUAGES: {
  sourceKey: string;
  language: Exclude<CatalogLanguage, "EN">;
}[] = [
  {
    sourceKey: "ja",
    language: "JP",
  },
  {
    sourceKey: "zh-tw",
    language: "CN-TW",
  },
  {
    sourceKey: "zh-cn",
    language: "CN",
  },
];

loadEnvFile(join(ROOT, ".env.local"));

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local."
  );
}

const supabase = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

async function main() {
  console.log(
    "\nMintRadar Pokémon catalog sync\n"
  );

  refreshRepository();

  const now = new Date().toISOString();
  const setRows: CatalogSetRow[] = [];
  const cardRows: CardRow[] = [];

  const seriesFolders = readdirSync(DATA_DIR)
    .map((name) => ({
      name,
      path: join(DATA_DIR, name),
    }))
    .filter((item) =>
      statSync(item.path).isDirectory()
    );

  for (const seriesFolder of seriesFolders) {
    const seriesFile = join(
      DATA_DIR,
      `${seriesFolder.name}.ts`
    );

    const seriesId = existsSync(seriesFile)
      ? readStringProperty(
          parseDefaultObject(seriesFile),
          "id"
        )
      : null;

    const setFiles = readdirSync(
      seriesFolder.path
    )
      .filter(
        (name) => extname(name) === ".ts"
      )
      .sort();

    for (const setFile of setFiles) {
      const setPath = join(
        seriesFolder.path,
        setFile
      );

      const setObject =
        parseDefaultObject(setPath);

      const setId =
        readStringProperty(setObject, "id");

      if (!setId) {
        continue;
      }

      const setName =
        readEnglishProperty(
          setObject,
          "name"
        ) || setId;

      const folderName =
        basename(setFile, ".ts");

      const cardsFolder = join(
        seriesFolder.path,
        folderName
      );

      const cardFiles = existsSync(cardsFolder)
        ? readdirSync(cardsFolder)
            .filter(
              (name) =>
                extname(name) === ".ts"
            )
            .sort()
        : [];

      const cardCount =
        cardFiles.length ||
        readNestedNumberProperty(
          setObject,
          "cardCount",
          "total"
        ) ||
        readNestedNumberProperty(
          setObject,
          "cardCount",
          "official"
        ) ||
        0;

      const releasedAt =
        normalizeDate(
          readStringProperty(
            setObject,
            "releaseDate"
          )
        );

      const assetBase = seriesId
        ? `https://assets.tcgdex.net/en/${seriesId}/${setId}`
        : null;

      setRows.push({
        external_id: setId,
        data_source: "tcgdex",
        language: "EN",
        name: setName,
        category: "Pokemon",
        code: setId,
        card_count: cardCount,
        released_at: releasedAt,
        set_type: null,
        series_id: seriesId,
        logo_url: assetBase
          ? `${assetBase}/logo.webp`
          : null,
        symbol_url: seriesId
          ? `https://assets.tcgdex.net/univ/${seriesId}/${setId}/symbol.webp`
          : null,
        external_updated_at: now,
      });

      for (const cardFile of cardFiles) {
        const cardPath = join(
          cardsFolder,
          cardFile
        );

        const cardObject =
          parseDefaultObject(cardPath);

        if (!cardObject) {
          continue;
        }

        const localId =
          basename(cardFile, ".ts");

        const cardName =
          readEnglishProperty(
            cardObject,
            "name"
          );

        if (!cardName) {
          continue;
        }

        const variant =
          readVariant(cardObject);

        cardRows.push({
          external_id:
            `${setId}-${localId}`,
          data_source: "tcgdex",
          language: "EN",
          name: cardName,
          set_name: setName,
          card_number: localId,
          image_url: assetBase
            ? `${assetBase}/${localId}/high.webp`
            : "",
          category: "Pokemon",
          rarity:
            readStringProperty(
              cardObject,
              "rarity"
            ),
          edition: variant.edition,
          finish: variant.finish,
          canonical_name: cardName,
          canonical_external_id: `${setId}-${localId}`,
          canonical_language: "EN",
          canonical_confidence: 100,
          external_updated_at: now,
        });

        englishIdentities.push(
          buildCardIdentity(
            cardObject,
            `${setId}-${localId}`,
            cardName
          )
        );
      }

      console.log(
        `${setName}: ${cardFiles.length} cards`
      );
    }
  }

  if (existsSync(ASIA_DATA_DIR)) {
    console.log(
      "\nDiscovering TCGdex Asian catalog..."
    );

    const asiaSeriesFolders =
      readdirSync(ASIA_DATA_DIR)
        .map((name) => ({
          name,
          path: join(
            ASIA_DATA_DIR,
            name
          ),
        }))
        .filter((item) =>
          statSync(item.path)
            .isDirectory()
        );

    let asiaSetRows = 0;
    let asiaCardRows = 0;

    for (
      const seriesFolder
      of asiaSeriesFolders
    ) {
      const seriesFile = join(
        ASIA_DATA_DIR,
        `${seriesFolder.name}.ts`
      );

      const seriesId =
        existsSync(seriesFile)
          ? readStringProperty(
              parseDefaultObject(
                seriesFile
              ),
              "id"
            )
          : seriesFolder.name;

      const setFiles =
        readdirSync(
          seriesFolder.path
        )
          .filter(
            (name) =>
              extname(name) ===
              ".ts"
          )
          .sort();

      for (
        const setFile
        of setFiles
      ) {
        const setPath = join(
          seriesFolder.path,
          setFile
        );

        const setObject =
          parseDefaultObject(
            setPath
          );

        const setId =
          readStringProperty(
            setObject,
            "id"
          );

        if (!setId) {
          continue;
        }

        const folderName =
          basename(
            setFile,
            ".ts"
          );

        const cardsFolder =
          join(
            seriesFolder.path,
            folderName
          );

        const cardFiles =
          existsSync(cardsFolder)
            ? readdirSync(
                cardsFolder
              )
                .filter(
                  (name) =>
                    extname(
                      name
                    ) === ".ts"
                )
                .sort()
            : [];

        const cardCount =
          cardFiles.length ||
          readNestedNumberProperty(
            setObject,
            "cardCount",
            "total"
          ) ||
          readNestedNumberProperty(
            setObject,
            "cardCount",
            "official"
          ) ||
          0;

        for (
          const {
            sourceKey,
            language,
          } of ASIA_LANGUAGES
        ) {
          const setName =
            readLocalizedProperty(
              setObject,
              "name",
              sourceKey
            );

          if (!setName) {
            continue;
          }

          const releasedAt =
            normalizeDate(
              readLocalizedProperty(
                setObject,
                "releaseDate",
                sourceKey
              )
            );

          if (language === "CN") {
            cnSetDiscoveryRows.set(`${seriesId ?? "unknown"}::${setId}`, {
              setId,
              setName,
              seriesId,
              cardCount,
              releasedAt,
            });

            // Register Gem Pack membership at the SET level. Do not wait for a
            // card to expose a zh-cn name: some TCGdex Asian products can have
            // localized set metadata even when individual card localization is
            // represented differently. This is diagnostic-only.
            if (isCnGemPackSetId(setId) || isCnGemPackSetName(setName)) {
              cnGemSetNames.set(setId, setName);
              cnGemSetAuditMeta.set(setId, {
                setId,
                setName,
                rawCardFiles: cardFiles.length,
                zhCnNamedCards: 0,
              });
            }
          }

          setRows.push({
            external_id: setId,
            data_source:
              "tcgdex",
            language,
            name: setName,
            category:
              "Pokemon",
            code: setId,
            card_count:
              cardCount,
            released_at:
              releasedAt,
            set_type: null,
            series_id:
              seriesId,
            logo_url: null,
            symbol_url: null,
            external_updated_at:
              now,
          });

          asiaSetRows += 1;

          for (
            const cardFile
            of cardFiles
          ) {
            const cardPath =
              join(
                cardsFolder,
                cardFile
              );

            const cardObject =
              parseDefaultObject(
                cardPath
              );

            if (!cardObject) {
              continue;
            }

            const cardName =
              readLocalizedProperty(
                cardObject,
                "name",
                sourceKey
              );

            if (!cardName) {
              continue;
            }

            const localId =
              basename(
                cardFile,
                ".ts"
              );

            const variant =
              readVariant(
                cardObject
              );

            // Read-only S5R identity probe. This runs inside the exact Asian
            // import path that successfully discovers CN-TW S5R cards.
            if (
              setId === "S5R" &&
              language === "CN-TW" &&
              ["050", "051", "055", "056"].includes(localId)
            ) {
              const probeIdentity = buildCardIdentity(
                cardObject,
                `${setId}-${localId}`,
                cardName
              );

              console.log(
                `\n=== INLINE S5R RAW IDENTITY PROBE ${language}::${setId}-${localId} ===`
              );
              console.log(`name=${cardName}`);
              console.log(
                `identity=${JSON.stringify({
                  category: probeIdentity.category,
                  dexIds: probeIdentity.dexIds,
                  illustrator: probeIdentity.illustrator,
                  suffix: probeIdentity.suffix,
                  stage: probeIdentity.stage,
                  trainerType: probeIdentity.trainerType,
                  energyType: probeIdentity.energyType,
                  regulationMark: probeIdentity.regulationMark,
                  rarity: probeIdentity.rarity,
                  variantKey: probeIdentity.variantKey,
                  modifiers: probeIdentity.modifiers,
                })}`
              );
              console.log(
                `raw=${JSON.stringify(
                  objectLiteralToDiagnosticValue(cardObject),
                  null,
                  2
                )}`
              );
              console.log(
                `=== END INLINE S5R RAW IDENTITY PROBE ${language}::${setId}-${localId} ===\n`
              );
            }

            const sourceIdentity = buildCardIdentity(
              cardObject,
              `${setId}-${localId}`,
              cardName
            );

            const canonical =
              resolveCanonicalEnglishIdentity(
                sourceIdentity,
                englishIdentities
              );

            if (
              language === "CN" &&
              (isCnGemPackSetId(setId) || isCnGemPackSetName(setName))
            ) {
              const gemMeta = cnGemSetAuditMeta.get(setId);
              if (gemMeta) {
                gemMeta.zhCnNamedCards += 1;
              }
              cnGemDiagnosticRows.push({
                setId,
                setName,
                localId,
                sourceName: cardName,
                identity: sourceIdentity,
                canonicalExternalId: canonical?.externalId ?? null,
                canonicalName: canonical?.name ?? null,
                confidence: canonical?.confidence ?? null,
              });
            }

            recordFamilyPositionSample(
              setId,
              localId,
              canonical
            );

            recordFamilySequenceObservation(
              setId,
              language,
              localId,
              cardName,
              buildCardIdentity(
                cardObject,
                `${setId}-${localId}`,
                cardName
              ),
              canonical,
              englishIdentities
            );

            cardRows.push({
              external_id:
                `${setId}-${localId}`,
              data_source:
                "tcgdex",
              language,
              name: cardName,
              set_name:
                setName,
              card_number:
                localId,
              image_url: "",
              category:
                "Pokemon",
              rarity:
                readStringProperty(
                  cardObject,
                  "rarity"
                ),
              edition:
                variant.edition,
              finish:
                variant.finish,
              canonical_name:
                canonical?.name ?? null,
              canonical_external_id:
                canonical?.externalId ?? null,
              canonical_language:
                canonical ? "EN" : null,
              canonical_confidence:
                canonical?.confidence ?? null,
              external_updated_at:
                now,
            });

            asiaCardRows += 1;
          }
        }
      }
    }

    console.log(
      `Asian catalog prepared: ${asiaSetRows} localized sets and ${asiaCardRows} localized cards.`
    );
  } else {
    console.warn(
      "TCGdex data-asia directory was not found; EN sync will continue normally."
    );
  }


  await prepareCnSupplementalGapFill(setRows, cardRows, now);

  printCnSetDiscoveryDiagnostics();
  printCnGemPackDiagnostics();
  await printCnGemSupplementalSourceAudit();
  printFamilyPositionDiagnostics();
  printFamilySequenceDiagnostics();
  printFamilyMonotonicPathDiagnostics();
  printSafeFamilySequenceResolverDiagnostics();
  printSequenceConfidenceDiagnostics();
  printBattleStyleDiagnostics();

  const productionSequencePromotions =
    buildProductionFamilySequencePromotions();

  applyProductionFamilySequencePromotions(
    cardRows,
    productionSequencePromotions
  );

  await fillOfficialJapaneseImages(cardRows);

  const m6aDebugRows = cardRows.filter(
    (row) =>
      row.language === "JP" &&
      row.external_id.startsWith("M6a-")
  );

  console.log(
    `\n=== M6a JP PREPARED ROWS: ${m6aDebugRows.length} ===`
  );

  for (const row of m6aDebugRows) {
    if (
      ["015", "075", "115", "125", "144"].includes(
        row.card_number
      )
    ) {
      console.log(
        `${row.external_id} | ${row.name} | canonical=${row.canonical_external_id ?? "null"} | canonicalName=${row.canonical_name ?? "null"} | confidence=${row.canonical_confidence ?? "null"} | image=${row.image_url || "EMPTY"}`
      );
    }
  }

  console.log("=== END M6a DEBUG ===\n");

  const dedupedSetRows =
    dedupeCatalogRows(
      setRows,
      "catalog_sets"
    );

  const dedupedCardRows =
    dedupeCatalogRows(
      cardRows,
      "cards"
    );

  console.log(
    `\nPrepared ${dedupedSetRows.length} unique sets and ${dedupedCardRows.length} unique cards.`
  );

  if (
    dedupedSetRows.length !==
    setRows.length
  ) {
    console.log(
      `catalog_sets: removed ${setRows.length - dedupedSetRows.length} duplicate source identities before upsert.`
    );
  }

  if (
    dedupedCardRows.length !==
    cardRows.length
  ) {
    console.log(
      `cards: removed ${cardRows.length - dedupedCardRows.length} duplicate source identities before upsert.`
    );
  }

  const pokemonSyncDryRun =
    process.env.POKEMON_SYNC_DRY_RUN === "1";

  if (pokemonSyncDryRun) {
    console.log(
      "\n=== POKÉMON SYNC GLOBAL DRY RUN ==="
    );
    console.log(
      `Supabase writes BLOCKED: catalog_sets=${dedupedSetRows.length}, cards=${dedupedCardRows.length}.`
    );
    console.log(
      "Diagnostics, source reads, matching, CN gap-fill auditing, and cache generation completed normally."
    );
    console.log(
      "Set POKEMON_SYNC_DRY_RUN=0 (or remove it) only when you intentionally want the prepared rows upserted."
    );
    console.log(
      "=== END GLOBAL DRY RUN ===\n"
    );
    return;
  }

  await upsertBatches(
    "catalog_sets",
    dedupedSetRows,
    250
  );

  await upsertBatches(
    "cards",
    dedupedCardRows,
    200
  );

  console.log(
    "\nPokémon catalog sync complete. MintRadar can now serve Pokémon from Supabase without waiting on api.tcgdex.net.\n"
  );
}


// Optional Japanese artwork enrichment. This does not change card identity,
// canonical matching, CN imports, or the existing Supabase write controls.
// Enable with JP_IMAGE_ENABLED=1; default set allowlist is M6a.
async function fillOfficialJapaneseImages(cardRows: CardRow[]) {
  if (process.env.JP_IMAGE_ENABLED !== "1") {
    console.log("JP official image enrichment disabled (JP_IMAGE_ENABLED=1 to enable).");
    return;
  }

  const allowedSets = new Set(
    (process.env.JP_IMAGE_SET_IDS ?? "M6a")
      .split(",").map((value) => value.trim().toUpperCase()).filter(Boolean)
  );
  const maxNetwork = Math.max(0, Math.min(500, Number(process.env.JP_IMAGE_MAX_NETWORK ?? "40") || 0));
  const cacheDir = join(ROOT, ".cache", "pokemon-jp-official-images");
  mkdirSync(cacheDir, { recursive: true });
  const base = "https://www.pokemon-card.com";
  const candidates = cardRows.filter(
    (row) => row.language === "JP" && allowedSets.has(row.external_id.slice(0, -(row.card_number.length + 1)).toUpperCase())
  );
  let network = 0;
  let cacheHits = 0;
  let resolved = 0;
  let skipped = 0;
  let stopped = false;
  let lastRequestAt = 0;
  const searchCache = new Map<string, OfficialJpSearchCard[]>();
  const detailCache = new Map<string, string>();

  async function request(url: string): Promise<Response | null> {
    if (stopped || network >= maxNetwork) return null;
    const wait = Math.max(0, 1000 - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    network += 1;
    lastRequestAt = Date.now();
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json, text/html;q=0.9" },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 429 || response.status === 403) {
        stopped = true;
        console.warn(`JP image lookup stopped after HTTP ${response.status}.`);
        return null;
      }
      return response.ok ? response : null;
    } catch {
      return null;
    }
  }

  async function search(name: string): Promise<OfficialJpSearchCard[]> {
    if (searchCache.has(name)) return searchCache.get(name)!;
    const url = new URL("/card-search/resultAPI.php", base);
    url.searchParams.set("keyword", name);
    url.searchParams.set("sm_and_keyword", "true");
    url.searchParams.set("regulation", "all");
    const response = await request(url.toString());
    if (!response) return [];
    try {
      const data = await response.json() as {
        result?: number;
        cardList?: OfficialJpSearchCard[];
        maxPage?: number;
      };
      // Never treat a truncated first page as exhaustive. For M6a we only
      // accept candidates actually returned and verified, never infer IDs.
      const cards = data.result === 1 && Array.isArray(data.cardList)
        ? data.cardList.filter((card) => typeof card.cardID === "string" && typeof card.cardThumbFile === "string")
        : [];
      searchCache.set(name, cards);
      return cards;
    } catch {
      return [];
    }
  }

  async function detail(id: string): Promise<string> {
    if (detailCache.has(id)) return detailCache.get(id)!;
    const response = await request(`${base}/card-search/details.php/card/${encodeURIComponent(id)}/regu/all`);
    if (!response) return "";
    const html = await response.text();
    detailCache.set(id, html);
    return html;
  }

  for (const row of candidates) {
    const setId = row.external_id.slice(0, -(row.card_number.length + 1));
    const key = `${setId}-${row.card_number}`;
    const cacheFile = join(cacheDir, `${encodeURIComponent(key)}.json`);
    if (existsSync(cacheFile)) {
      try {
        const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as {
          imageUrl?: string; setId?: string; number?: string;
        };
        if (cached.setId === setId && cached.number === row.card_number &&
            typeof cached.imageUrl === "string" &&
            isOfficialJpImage(cached.imageUrl, setId)) {
          row.image_url = cached.imageUrl;
          cacheHits += 1;
          resolved += 1;
          continue;
        }
      } catch { /* Corrupt cache: resolve again. */ }
    }
    if (stopped || network >= maxNetwork) { skipped += 1; continue; }
    const results = await search(row.name);
    const sameSet = results.filter((card) =>
      card.cardThumbFile.includes(`/large/${setId}/`) && /^\d+$/.test(card.cardID)
    );
    let chosen = "";
    for (const card of sameSet) {
      const html = await detail(card.cardID);
      if (!html) continue;
      const actualSet = /regulation_logo_1\/([^/"']+)\.gif/i.exec(html)?.[1];
      // The official detail page prints e.g. &nbsp;015&nbsp;/&nbsp;103&nbsp;.
      const printed = /(?:&nbsp;|\s)+(\d{1,4})(?:&nbsp;|\s)*\/(?:&nbsp;|\s)*\d{1,4}(?:&nbsp;|\s)/i.exec(html)?.[1];
      if (actualSet?.toUpperCase() !== setId.toUpperCase() ||
          !printed || Number(printed) !== Number(row.card_number)) continue;
      const imagePath = /<img\b[^>]*\bsrc=["']([^"']*\/assets\/images\/card_images\/large\/[^"']+)["']/i.exec(html)?.[1];
      if (!imagePath) continue;
      const imageUrl = new URL(imagePath, base).toString();
      if (!isOfficialJpImage(imageUrl, setId) ||
          new URL(imageUrl).pathname !== card.cardThumbFile) continue;
      chosen = imageUrl;
      break;
    }
    if (chosen) {
      row.image_url = chosen;
      writeFileSync(cacheFile, JSON.stringify({ setId, number: row.card_number, imageUrl: chosen }, null, 2));
      resolved += 1;
    } else {
      skipped += 1;
    }
  }
  console.log(`JP official images: eligible=${candidates.length}, resolved=${resolved}, cacheHits=${cacheHits}, unresolved=${skipped}, networkRequests=${network}/${maxNetwork}${stopped ? ", stopped by server" : ""}.`);
}

type OfficialJpSearchCard = {
  cardID: string;
  cardThumbFile: string;
  cardNameAltText?: string;
};

function isOfficialJpImage(url: string, setId: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://www.pokemon-card.com" &&
      parsed.pathname.startsWith(`/assets/images/card_images/large/${setId}/`) &&
      /\.jpe?g$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

// CN supplemental gap-fill, intentionally isolated from the existing Gem Pack
// read-only audit. Default mode is cache-only + dry-run.
async function prepareCnSupplementalGapFill(
  setRows: CatalogSetRow[],
  cardRows: CardRow[],
  now: string
) {
  const enabled = process.env.CN_GAP_FILL_ENABLED === "1";
  if (!enabled) {
    console.log("CN gap-fill disabled (CN_GAP_FILL_ENABLED=1 to audit).");
    return;
  }

  const allowNetwork = process.env.CN_GAP_FILL_NETWORK === "1";
  const allowWrites = process.env.CN_GAP_FILL_WRITE === "1";
  const apiKey = process.env.PIKAQIAN_API_KEY?.trim();
  const cacheDir = join(ROOT, ".cache", "pikaqian-cn-gap-fill");
  mkdirSync(cacheDir, { recursive: true });

  // Require an explicit allowlist; never import every CN set automatically.
  const requested = new Set(
    (process.env.CN_GAP_FILL_SET_IDS ?? "CSV9.5C")
      .split(",")
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean)
  );
  const nativeIds = new Set(
    cardRows.filter((row) => row.language === "CN")
      .map((row) => row.external_id.toUpperCase())
  );
  const candidateSets = setRows.filter(
    (row) => row.language === "CN" &&
      requested.has(row.external_id.toUpperCase()) &&
      !cardRows.some(
        (card) => card.language === "CN" &&
          card.set_name === row.name
      )
  );

  console.log(
    `CN gap-fill: sets=${candidateSets.length}, network=${allowNetwork}, write=${allowWrites}`
  );

  if (allowNetwork && !apiKey) {
    throw new Error("CN_GAP_FILL_NETWORK=1 requires PIKAQIAN_API_KEY.");
  }

  type PQCard = {
    id: string;
    card_set_id: string;
    card_number: string;
    name: string;
    local_name?: string | null;
    rarity?: string | null;
    rarity_label?: string | null;
    image_url?: string | null;
    variant?: string | null;
  };

  for (const set of candidateSets) {
    const sourceSetId = set.external_id.toLowerCase();
    const records: PQCard[] = [];
    let cursor: string | null = null;
    let page = 0;
    let complete = true;
    const seenCursors = new Set<string>();

    do {
      const cacheKey = cursor
        ? Buffer.from(cursor).toString("hex").slice(0, 100)
        : "first";
      const cachePath = join(
        cacheDir, `${sourceSetId}-page-${page}-${cacheKey}.json`
      );
      let payload: {
        data?: PQCard[];
        pagination?: { next_cursor?: string | null };
      };

      if (existsSync(cachePath)) {
        payload = JSON.parse(readFileSync(cachePath, "utf8"));
      } else if (allowNetwork) {
        const url =
          `https://api.pikaqian.com/v1/cards?set_id=${encodeURIComponent(sourceSetId)}&page_size=100` +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
        const response = await fetch(url, {
          headers: {
            "X-API-Key": apiKey!,
            Accept: "application/json",
            "User-Agent": "MintRadar-CN-Gap-Audit/1.0",
          },
        });
        if (!response.ok) {
          complete = false;
          console.warn(
            `CN gap-fill ${set.external_id} page ${page}: HTTP ${response.status}; stopping set`
          );
          break;
        }
        payload = await response.json() as typeof payload;
        const { writeFileSync } = await import("node:fs");
        writeFileSync(cachePath, JSON.stringify(payload, null, 2), "utf8");
      } else {
        complete = false;
        console.log(
          `CN gap-fill ${set.external_id}: cache miss ${cachePath}; no network request`
        );
        break;
      }

      if (!Array.isArray(payload.data)) {
        complete = false;
        console.warn(`CN gap-fill ${set.external_id}: invalid list response`);
        break;
      }
      records.push(...payload.data);
      const next = payload.pagination?.next_cursor ?? null;
      if (next && seenCursors.has(next)) {
        complete = false;
        console.warn(`CN gap-fill ${set.external_id}: repeated cursor`);
        break;
      }
      if (next) seenCursors.add(next);
      cursor = next;
      page += 1;
      if (page >= 100 && cursor) {
        complete = false;
        console.warn(`CN gap-fill ${set.external_id}: pagination safety limit`);
        break;
      }
    } while (cursor);

    const valid: CardRow[] = [];
    const physicalIds = new Set<string>();
    let rejected = 0;
    for (const card of records) {
      const localId = String(card.card_number ?? "").trim();
      const sourceName = String(card.local_name ?? "").trim();
      const englishName = String(card.name ?? "").trim();
      const actualSet = String(card.card_set_id ?? "").trim().toUpperCase();
      // A local Chinese name and exact physical set ID are mandatory.
      if (
        actualSet !== set.external_id.toUpperCase() ||
        !/^[A-Z0-9][A-Z0-9./-]*$/i.test(localId) ||
        !sourceName ||
        !/[\u3400-\u9fff]/u.test(sourceName) ||
        !englishName
      ) {
        rejected += 1;
        continue;
      }
      const externalId = `${set.external_id}-${localId}`;
      if (physicalIds.has(externalId.toUpperCase())) {
        rejected += 1;
        continue;
      }
      physicalIds.add(externalId.toUpperCase());
      if (nativeIds.has(externalId.toUpperCase())) continue;

      // The supplemental provider's English name is useful for search/display,
      // but is NOT a verified English printing. Never fabricate a canonical ID.
      valid.push({
        external_id: externalId,
        data_source: "tcgdex",
        language: "CN",
        name: sourceName,
        set_name: set.name,
        card_number: localId,
        image_url: typeof card.image_url === "string" ? card.image_url : "",
        category: "Pokemon",
        rarity: card.rarity_label ?? card.rarity ?? null,
        edition: null,
        finish: card.variant ?? null,
        canonical_name: englishName,
        canonical_external_id: null,
        canonical_language: null,
        canonical_confidence: null,
        external_updated_at: now,
      });
    }

    console.log(
      `CN gap-fill ${set.external_id}: fetched=${records.length} valid=${valid.length} rejected=${rejected} complete=${complete} expectedBase=${set.card_count}`
    );
    console.log(
      `  sample=${valid.slice(0, 5).map(
        (row) => `${row.external_id} ${row.name} (${row.canonical_name})`
      ).join(" | ")}`
    );

    // Never partially import an incomplete list. Writes are an explicit opt-in.
    if (!complete || valid.length === 0 || !allowWrites) {
      console.log(`  DRY RUN / SKIPPED: no supplemental cards added.`);
      continue;
    }

    // Guard against suspiciously small lists. Official set count may exclude
    // secret rares, so compare as a minimum coverage signal, not exact equality.
    if (set.card_count > 0 && records.length < set.card_count * 0.8) {
      console.warn(`  SKIPPED: source coverage below 80% of set count.`);
      continue;
    }

    cardRows.push(...valid);
    console.log(`  STAGED ${valid.length} CN cards for existing batch upsert.`);
  }
}

async function printCnGemSupplementalSourceAudit() {
  const enabled =
    process.env.PIKAQIAN_GEM_AUDIT_ENABLED === "1";

  if (!enabled) {
    console.log(
      "\nCN Gem Pack PikaQian audit disabled (PIKAQIAN_GEM_AUDIT_ENABLED=1 to enable)."
    );
    return;
  }

  console.log("\n=== CN GEM PACK PIKAQIAN AUDIT (READ-ONLY / QUOTA-SAFE) ===");
  console.log(
    "Source: PikaQian API | SAFE MODE: no PikaQian rows are written to Supabase."
  );

  const apiKeyValue = process.env.PIKAQIAN_API_KEY?.trim();
  if (!apiKeyValue) {
    console.log("PIKAQIAN_API_KEY missing from .env.local; skipping.");
    return;
  }
  const apiKey: string = apiKeyValue;

  const cacheDir = join(ROOT, ".cache", "pikaqian-gem-audit");
  mkdirSync(cacheDir, { recursive: true });

  // Known Gem Pack IDs already proven by the previous audit. Keep discovery
  // bounded so we do not spend quota probing arbitrary future set IDs.
  const knownGemSetIds = [
    "cbb1c",
    "cbb2c",
    "cbb3c",
    "cbb4c",
    "cbb5c",
    "cbb6c",
  ];

  const discovered = new Set<string>([
    ...knownGemSetIds,
    ...Array.from(cnGemSetAuditMeta.keys())
      .filter(isCnGemPackSetId)
      .map((x) => x.toLowerCase()),
  ]);

  const requestedDetailLimit = Number(
    process.env.PIKAQIAN_AUDIT_DETAIL_LIMIT ?? "30"
  );
  const detailNetworkLimit = Number.isFinite(requestedDetailLimit)
    ? Math.max(0, Math.min(60, Math.floor(requestedDetailLimit)))
    : 30;

  const PIKAQIAN_REQUEST_DELAY_MS = 1250;
  const PIKAQIAN_MAX_429_RETRIES = 6;
  const PIKAQIAN_429_BASE_DELAY_MS = 5000;
  const MAX_429_WAIT_MS = 60_000;

  let lastPikaQianNetworkRequestAt = 0;
  let quotaExhausted = false;
  let quotaMessage: string | null = null;
  let cacheHits = 0;
  let networkReads = 0;
  let detailNetworkReads = 0;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  function isMonthlyQuotaBody(body: string) {
    return /monthly\s+quota\s+exceeded/i.test(body);
  }

  async function cached<T>(
    name: string,
    url: string,
    kind: "metadata" | "list" | "detail"
  ): Promise<{ value: T; hit: boolean }> {
    const path = join(cacheDir, name);

    if (existsSync(path)) {
      cacheHits += 1;
      return {
        value: JSON.parse(readFileSync(path, "utf8")) as T,
        hit: true,
      };
    }

    if (quotaExhausted) {
      throw new Error(
        `PikaQian network disabled for this run: ${quotaMessage ?? "monthly quota exhausted"}`
      );
    }

    if (kind === "detail" && detailNetworkReads >= detailNetworkLimit) {
      throw new Error("DETAIL_NETWORK_BUDGET_EXHAUSTED");
    }

    for (
      let attempt = 0;
      attempt <= PIKAQIAN_MAX_429_RETRIES;
      attempt += 1
    ) {
      const elapsed = Date.now() - lastPikaQianNetworkRequestAt;
      const pacingWait = Math.max(
        0,
        PIKAQIAN_REQUEST_DELAY_MS - elapsed
      );

      if (pacingWait > 0) {
        await sleep(pacingWait);
      }

      lastPikaQianNetworkRequestAt = Date.now();
      networkReads += 1;

      if (kind === "detail") {
        detailNetworkReads += 1;
      }

      const response = await fetch(url, {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
          "User-Agent": "MintRadar-Catalog-Audit/3.0",
        },
      });

      const body = await response.text();

      if (response.ok) {
        const value = JSON.parse(body) as T;
        const { writeFileSync } = await import("node:fs");
        writeFileSync(
          path,
          JSON.stringify(value, null, 2),
          "utf8"
        );
        return { value, hit: false };
      }

      if (response.status === 429 && isMonthlyQuotaBody(body)) {
        quotaExhausted = true;
        quotaMessage = "Monthly quota exceeded";
        throw new Error(
          `HTTP 429: monthly quota exceeded; all remaining PikaQian network requests disabled for this run.`
        );
      }

      if (
        response.status === 429 &&
        attempt < PIKAQIAN_MAX_429_RETRIES
      ) {
        const retryAfterHeader =
          response.headers.get("retry-after");
        let serverDelay = 0;

        if (retryAfterHeader) {
          const numericRetryAfter =
            Number(retryAfterHeader);

          if (
            Number.isFinite(numericRetryAfter) &&
            numericRetryAfter >= 0 &&
            numericRetryAfter <= 300
          ) {
            serverDelay =
              numericRetryAfter * 1000;
          } else {
            const retryAt =
              Date.parse(retryAfterHeader);

            if (Number.isFinite(retryAt)) {
              serverDelay = Math.max(
                0,
                retryAt - Date.now()
              );
            }
          }
        }

        const exponentialDelay =
          PIKAQIAN_429_BASE_DELAY_MS *
          Math.pow(2, attempt);

        const waitMs = Math.min(
          MAX_429_WAIT_MS,
          Math.max(
            serverDelay,
            exponentialDelay
          )
        );

        console.warn(
          `PikaQian HTTP 429; waiting ${Math.ceil(
            waitMs / 1000
          )}s before retry ${attempt + 1}/${PIKAQIAN_MAX_429_RETRIES}` +
            (retryAfterHeader
              ? ` (Retry-After: ${retryAfterHeader})`
              : "") +
            "..."
        );

        await sleep(waitMs);
        continue;
      }

      throw new Error(
        `HTTP ${response.status}: ${body.slice(0, 240)}`
      );
    }

    throw new Error(
      `PikaQian retry budget exhausted for ${url}`
    );
  }

  type PQSet = {
    id: string;
    name: string;
    local_name?: string | null;
    release_date?: string | null;
    language?: string | null;
  };

  type PQList = {
    id: string;
    card_set_id: string;
    card_number: string;
    name: string;
    local_name?: string | null;
    card_type?: string | null;
    rarity?: string | null;
    rarity_label?: string | null;
    element?: string | null;
    variant?: string | null;
    image_url?: string | null;
  };

  type PQDetail = PQList & {
    pokemon_id?: number | null;
    hp?: number | null;
    weaknesses?: Array<{
      type?: string | null;
      local_type?: string | null;
      value?: string | null;
    }>;
    resistances?: Array<{
      type?: string | null;
      local_type?: string | null;
      value?: string | null;
    }>;
    retreat_cost?: number | null;
    attacks?: Array<{
      damage?: string | number | null;
      cost?: string[];
      local_cost?: string[];
    }>;
    regulation_mark?: string | null;
    illustrators?: string[];
  };

  const normType = (
    value: string | null | undefined
  ) => {
    const raw = value?.trim() ?? "";
    if (!raw) return "";

    const map: Record<string, string> = {
      grass: "Grass",
      fire: "Fire",
      water: "Water",
      lightning: "Lightning",
      psychic: "Psychic",
      fighting: "Fighting",
      darkness: "Darkness",
      metal: "Metal",
      colorless: "Colorless",
      dragon: "Dragon",
      fairy: "Fairy",
      草: "Grass",
      火: "Fire",
      水: "Water",
      雷: "Lightning",
      超: "Psychic",
      斗: "Fighting",
      恶: "Darkness",
      惡: "Darkness",
      钢: "Metal",
      鋼: "Metal",
      无色: "Colorless",
      無色: "Colorless",
      龙: "Dragon",
      龍: "Dragon",
      妖: "Fairy",
    };

    return map[raw.toLowerCase()] ?? map[raw] ?? raw;
  };

  const identity = (card: PQDetail): CardIdentity => {
    const suffix =
      /(?:^|[\s-])(ex|EX|GX|VMAX|VSTAR|V)$/u.exec(
        card.name.trim()
      )?.[1] ?? null;

    const typed = (
      values:
        | PQDetail["weaknesses"]
        | PQDetail["resistances"]
    ) =>
      (values ?? [])
        .map((item) => {
          const type = normType(
            item.type ?? item.local_type
          );
          return type
            ? `${type}:${(item.value ?? "")
                .trim()
                .replace(/^x(?=\d)/i, "×")}`
            : null;
        })
        .filter(
          (item): item is string =>
            Boolean(item)
        )
        .sort();

    return {
      externalId:
        `${card.card_set_id.toUpperCase()}-` +
        card.card_number.replace(/\s+/g, "-"),
      name: card.name,
      category: card.card_type ?? null,
      dexIds: Number.isFinite(card.pokemon_id)
        ? [Number(card.pokemon_id)]
        : [],
      illustrator:
        card.illustrators?.[0] ?? null,
      suffix,
      stage: null,
      trainerType: null,
      energyType: null,
      regulationMark:
        card.regulation_mark ?? null,
      rarity:
        card.rarity_label ??
        card.rarity ??
        null,
      variantKey: card.variant
        ? `type:${card.variant.toLowerCase()}`
        : "",
      hp: Number.isFinite(card.hp)
        ? Number(card.hp)
        : null,
      types: card.element
        ? [normType(card.element)]
        : [],
      weaknesses: typed(card.weaknesses),
      resistances: typed(card.resistances),
      retreat: Number.isFinite(
        card.retreat_cost
      )
        ? Number(card.retreat_cost)
        : null,
      attackFingerprint:
        (card.attacks ?? []).map(
          (attack) =>
            `damage:${attack.damage ?? ""}|cost:${(
              attack.cost ??
              attack.local_cost ??
              []
            )
              .map(normType)
              .join("+")}`
        ),
      modifiers: buildIdentityModifiers(
        card.name,
        suffix
      ),
    };
  };

  function deterministicSample<T>(
    values: T[],
    count: number
  ) {
    if (values.length <= count) {
      return [...values];
    }

    const indexes = new Set<number>();
    for (let i = 0; i < count; i += 1) {
      const index = Math.round(
        (i * (values.length - 1)) /
          Math.max(1, count - 1)
      );
      indexes.add(index);
    }

    return Array.from(indexes)
      .sort((a, b) => a - b)
      .map((index) => values[index]);
  }

  const setIds = Array.from(discovered).sort(
    (a, b) =>
      a.localeCompare(
        b,
        undefined,
        { numeric: true }
      )
  );

  const samplePerSet =
    setIds.length > 0
      ? Math.max(
          1,
          Math.floor(
            detailNetworkLimit /
              setIds.length
          )
        )
      : 0;

  let grandPhysical = 0;
  let grandImages = 0;
  let grandSampled = 0;
  let grandMatched = 0;
  let grandUnresolved = 0;
  let grandSkippedDetails = 0;

  console.log(
    `Detail network budget=${detailNetworkLimit} total; target≈${samplePerSet} uncached detail requests per set.`
  );

  for (const id of setIds) {
    let setMeta: PQSet | null = null;

    try {
      const setResult =
        await cached<PQSet>(
          `${id}-set.json`,
          `https://api.pikaqian.com/v1/sets/${id}`,
          "metadata"
        );
      setMeta = setResult.value;
    } catch (error) {
      console.warn(
        `\n${id.toUpperCase()} set metadata unavailable: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }

    const cards: PQList[] = [];
    let cursor: string | null = null;
    let page = 0;
    let listComplete = true;

    do {
      const token: string = cursor
        ? cursor
            .replace(/[^a-z0-9]/gi, "")
            .slice(-24)
        : "first";

      const url: string =
        `https://api.pikaqian.com/v1/cards?set_id=${id}&page_size=100` +
        (cursor
          ? `&cursor=${encodeURIComponent(cursor)}`
          : "");

      try {
        const pageResult: {
          value: {
            data?: PQList[];
            pagination?: {
              next_cursor?: string | null;
            };
          };
          hit: boolean;
        } = await cached<{
          data?: PQList[];
          pagination?: {
            next_cursor?: string | null;
          };
        }>(
          `${id}-page-${page}-${token}.json`,
          url,
          "list"
        );

        cards.push(
          ...(pageResult.value.data ?? [])
        );
        cursor =
          pageResult.value.pagination
            ?.next_cursor ?? null;
        page += 1;

        if (page > 100) {
          throw new Error(
            "pagination safety stop"
          );
        }
      } catch (error) {
        listComplete = false;
        console.warn(
          `  ${id.toUpperCase()} list page ${page} unavailable: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`
        );
        break;
      }
    } while (cursor);

    const names = new Set<string>();
    const physical = new Set<string>();
    const duplicates = new Set<string>();
    let images = 0;

    for (const card of cards) {
      const key =
        `${card.card_set_id}:${card.card_number}`;

      if (physical.has(key)) {
        duplicates.add(key);
      }

      physical.add(key);
      names.add(card.name);

      if (card.image_url) {
        images += 1;
      }
    }

    grandPhysical += cards.length;
    grandImages += images;

    const preferredSamples =
      deterministicSample(
        cards,
        Math.max(
          5,
          samplePerSet
        )
      );

    let sampled = 0;
    let matched = 0;
    let unresolved = 0;
    let skippedDetails = 0;
    const samples: string[] = [];

    for (const card of preferredSamples) {
      let detail: PQDetail | null = null;

      try {
        const detailResult =
          await cached<PQDetail>(
            `${id}-card-${card.id}.json`,
            `https://api.pikaqian.com/v1/cards/${card.id}`,
            "detail"
          );
        detail = detailResult.value;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        skippedDetails += 1;

        if (
          message ===
          "DETAIL_NETWORK_BUDGET_EXHAUSTED"
        ) {
          continue;
        }

        if (
          quotaExhausted ||
          /network disabled/i.test(message)
        ) {
          continue;
        }

        console.warn(
          `  ${id} ${card.card_number} detail skipped: ${message}`
        );
        continue;
      }

      if (!detail) {
        continue;
      }

      sampled += 1;

      const canonical =
        resolveCanonicalEnglishIdentity(
          identity(detail),
          englishIdentities
        );

      if (canonical) {
        matched += 1;
      } else {
        unresolved += 1;
      }

      if (samples.length < 5) {
        samples.push(
          `${card.card_number} ${card.name}/${card.local_name ?? "null"} ` +
            `${card.rarity_label ?? card.rarity ?? ""} -> ` +
            (canonical
              ? `${canonical.externalId} (${canonical.confidence})`
              : "UNRESOLVED")
        );
      }
    }

    grandSampled += sampled;
    grandMatched += matched;
    grandUnresolved += unresolved;
    grandSkippedDetails += skippedDetails;

    console.log(
      `\n${id.toUpperCase()} | ${
        setMeta?.name ?? "metadata unavailable"
      } | ${
        setMeta?.local_name ?? "null"
      } | ${
        setMeta?.release_date ?? "null"
      }`
    );
    console.log(
      `  physical=${cards.length} uniqueNames=${names.size} images=${images}/${cards.length} duplicates=${duplicates.size} listComplete=${listComplete}`
    );
    console.log(
      `  detailAudit sampled=${sampled} matched=${matched} unresolved=${unresolved} skipped=${skippedDetails}`
    );

    for (const sample of samples) {
      console.log(`  sample ${sample}`);
    }
  }

  console.log(
    `\nPikaQian Gem audit summary: sets=${setIds.length} physical=${grandPhysical} images=${grandImages} detailSampled=${grandSampled} matched=${grandMatched} unresolved=${grandUnresolved} detailSkipped=${grandSkippedDetails} cacheReads=${cacheHits} networkReads=${networkReads} detailNetworkReads=${detailNetworkReads}/${detailNetworkLimit}`
  );

  if (quotaExhausted) {
    console.log(
      `PikaQian network stopped early: ${quotaMessage ?? "monthly quota exhausted"}. Cached data was still used normally.`
    );
  }

  console.log(
    "SAFE MODE: PikaQian records were NOT added to cardRows and were NOT upserted."
  );
}

function refreshRepository() {
  mkdirSync(
    join(ROOT, ".cache"),
    { recursive: true }
  );

  if (
    existsSync(
      join(CACHE_DIR, ".git")
    )
  ) {
    console.log(
      "Refreshing TCGdex database mirror..."
    );

    execFileSync(
      "git",
      [
        "-C",
        CACHE_DIR,
        "fetch",
        "--depth",
        "1",
        "origin",
        "master",
      ],
      { stdio: "inherit" }
    );

    execFileSync(
      "git",
      [
        "-C",
        CACHE_DIR,
        "reset",
        "--hard",
        "origin/master",
      ],
      { stdio: "inherit" }
    );

    return;
  }

  if (existsSync(CACHE_DIR)) {
    rmSync(
      CACHE_DIR,
      {
        recursive: true,
        force: true,
      }
    );
  }

  console.log(
    "Cloning TCGdex database mirror..."
  );

  execFileSync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "https://github.com/tcgdex/cards-database.git",
      CACHE_DIR,
    ],
    { stdio: "inherit" }
  );
}

function parseDefaultObject(
  filePath: string
): ts.ObjectLiteralExpression | null {
  const sourceText =
    readFileSync(filePath, "utf8");

  const sourceFile =
    ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS
    );

  let found:
    ts.ObjectLiteralExpression | null =
      null;

  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement)
    ) {
      continue;
    }

    for (
      const declaration of
      statement.declarationList.declarations
    ) {
      if (
        declaration.initializer &&
        ts.isObjectLiteralExpression(
          declaration.initializer
        )
      ) {
        found = declaration.initializer;
        break;
      }
    }

    if (found) {
      break;
    }
  }

  return found;
}

function propertyName(
  property: ts.ObjectLiteralElementLike
) {
  if (!property.name) {
    return null;
  }

  if (
    ts.isIdentifier(property.name) ||
    ts.isStringLiteral(property.name) ||
    ts.isNumericLiteral(property.name)
  ) {
    return property.name.text;
  }

  return null;
}

function getPropertyInitializer(
  object:
    | ts.ObjectLiteralExpression
    | null,
  name: string
): ts.Expression | null {
  if (!object) {
    return null;
  }

  for (const property of object.properties) {
    if (
      !ts.isPropertyAssignment(property)
    ) {
      continue;
    }

    if (
      propertyName(property) === name
    ) {
      return property.initializer;
    }
  }

  return null;
}

function expressionString(
  expression:
    | ts.Expression
    | null
): string | null {
  if (!expression) {
    return null;
  }

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(
      expression
    )
  ) {
    return expression.text;
  }

  return null;
}

function expressionNumber(
  expression:
    | ts.Expression
    | null
): number | null {
  if (
    expression &&
    ts.isNumericLiteral(expression)
  ) {
    return Number(expression.text);
  }

  return null;
}

function readStringProperty(
  object:
    | ts.ObjectLiteralExpression
    | null,
  name: string
) {
  return expressionString(
    getPropertyInitializer(
      object,
      name
    )
  );
}

function readLocalizedProperty(
  object:
    | ts.ObjectLiteralExpression
    | null,
  name: string,
  languageKey: string
) {
  const value =
    getPropertyInitializer(
      object,
      name
    );

  const direct =
    expressionString(value);

  if (direct) {
    return direct;
  }

  if (
    value &&
    ts.isObjectLiteralExpression(
      value
    )
  ) {
    return expressionString(
      getPropertyInitializer(
        value,
        languageKey
      )
    );
  }

  return null;
}

function readEnglishProperty(
  object:
    | ts.ObjectLiteralExpression
    | null,
  name: string
) {
  const value =
    getPropertyInitializer(
      object,
      name
    );

  const direct =
    expressionString(value);

  if (direct) {
    return direct;
  }

  if (
    value &&
    ts.isObjectLiteralExpression(value)
  ) {
    const english =
      expressionString(
        getPropertyInitializer(
          value,
          "en"
        )
      );

    if (english) {
      return english;
    }

    for (
      const property of value.properties
    ) {
      if (
        ts.isPropertyAssignment(property)
      ) {
        const fallback =
          expressionString(
            property.initializer
          );

        if (fallback) {
          return fallback;
        }
      }
    }
  }

  return null;
}

function readNestedNumberProperty(
  object:
    | ts.ObjectLiteralExpression
    | null,
  parent: string,
  child: string
) {
  const parentValue =
    getPropertyInitializer(
      object,
      parent
    );

  if (
    !parentValue ||
    !ts.isObjectLiteralExpression(
      parentValue
    )
  ) {
    return null;
  }

  return expressionNumber(
    getPropertyInitializer(
      parentValue,
      child
    )
  );
}

function normalizeDate(
  value: string | null
) {
  if (!value) {
    return null;
  }

  const match =
    value.match(
      /^\d{4}-\d{2}-\d{2}$/
    );

  return match
    ? value
    : null;
}

function readVariant(
  object:
    | ts.ObjectLiteralExpression
    | null
): {
  edition: string | null;
  finish: string | null;
} {
  const variants =
    getPropertyInitializer(
      object,
      "variants"
    );

  if (
    !variants ||
    !ts.isArrayLiteralExpression(
      variants
    )
  ) {
    return {
      edition: null,
      finish: null,
    };
  }

  const variantStrings =
    new Set<string>();

  for (
    const element of variants.elements
  ) {
    if (
      !ts.isObjectLiteralExpression(
        element
      )
    ) {
      continue;
    }

    for (
      const field of [
        "type",
        "subtype",
      ]
    ) {
      const value =
        readStringProperty(
          element,
          field
        );

      if (value) {
        variantStrings.add(
          value.toLowerCase()
        );
      }
    }

    const stamp =
      getPropertyInitializer(
        element,
        "stamp"
      );

    if (
      stamp &&
      ts.isArrayLiteralExpression(stamp)
    ) {
      for (
        const stampItem of
        stamp.elements
      ) {
        const value =
          expressionString(
            stampItem
          );

        if (value) {
          variantStrings.add(
            value.toLowerCase()
          );
        }
      }
    }
  }

  const edition =
    variantStrings.has(
      "1st-edition"
    )
      ? "1st Edition"
      : null;

  let finish:
    string | null = null;

  if (
    variantStrings.has("holo")
  ) {
    finish = "Holo";
  } else if (
    variantStrings.has("reverse")
  ) {
    finish = "Reverse Holo";
  } else if (
    variantStrings.has("normal")
  ) {
    finish = "Non-Holo";
  }

  return {
    edition,
    finish,
  };
}


function readNumberProperty(
  object: ts.ObjectLiteralExpression | null,
  name: string
): number | null {
  return expressionNumber(getPropertyInitializer(object, name));
}

function normalizedTypedValueArray(
  object: ts.ObjectLiteralExpression | null,
  name: string
): string[] {
  const value = getPropertyInitializer(object, name);
  if (!value || !ts.isArrayLiteralExpression(value)) return [];

  const parts: string[] = [];
  for (const element of value.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    const type = readStringProperty(element, "type");
    const amount = readStringProperty(element, "value");
    if (!type) continue;

    // TCGdex localizations use both ASCII x and the multiplication sign ×
    // for weakness multipliers (for example x2 vs ×2). They describe the
    // same printed value, so normalize before cross-language comparison.
    const normalizedAmount = (amount ?? "")
      .trim()
      .replace(/^x(?=\d)/i, "×");

    parts.push(`${type}:${normalizedAmount}`);
  }
  return parts.sort();
}

function normalizedAttackFingerprint(
  object: ts.ObjectLiteralExpression | null
): string[] {
  const value = getPropertyInitializer(object, "attacks");
  if (!value || !ts.isArrayLiteralExpression(value)) return [];

  const attacks: string[] = [];
  for (const element of value.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;

    const damageInitializer = getPropertyInitializer(element, "damage");
    const numericDamage = expressionNumber(damageInitializer);
    const stringDamage = expressionString(damageInitializer);
    const damage = numericDamage !== null ? String(numericDamage) : stringDamage ?? "";
    const cost = readStringArrayProperty(element, "cost");

    // Preserve attack order and energy order; both are language-independent
    // properties of the printed attack. Names/effect text are deliberately ignored.
    attacks.push(`damage:${damage}|cost:${cost.join("+")}`);
  }
  return attacks;
}

function readStringArrayProperty(
  object: ts.ObjectLiteralExpression | null,
  name: string
): string[] {
  const value = getPropertyInitializer(object, name);
  if (!value || !ts.isArrayLiteralExpression(value)) return [];
  return value.elements
    .map((item) => expressionString(item))
    .filter((item): item is string => Boolean(item));
}

function readNumberArrayProperty(
  object: ts.ObjectLiteralExpression | null,
  name: string
): number[] {
  const value = getPropertyInitializer(object, name);
  if (!value || !ts.isArrayLiteralExpression(value)) return [];
  return value.elements
    .map((item) => expressionNumber(item))
    .filter((item): item is number => Number.isFinite(item));
}

function normalizedVariantKey(object: ts.ObjectLiteralExpression | null) {
  const variants = getPropertyInitializer(object, "variants");

  if (!variants || !ts.isArrayLiteralExpression(variants)) {
    return "";
  }

  const parts = new Set<string>();

  for (const element of variants.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      continue;
    }

    for (const field of ["type", "subtype"]) {
      const value = readStringProperty(element, field);
      if (value) {
        parts.add(`${field}:${value.trim().toLowerCase()}`);
      }
    }

    const stamp = getPropertyInitializer(element, "stamp");
    if (stamp && ts.isArrayLiteralExpression(stamp)) {
      for (const stampItem of stamp.elements) {
        const value = expressionString(stampItem);
        if (value) {
          parts.add(`stamp:${value.trim().toLowerCase()}`);
        }
      }
    }
  }

  return Array.from(parts).sort().join("|");
}

function buildIdentityModifiers(
  name: string,
  suffix: string | null
): IdentityModifiers {
  const trimmed = name.trim();
  const suffixValue = (suffix ?? "").trim();

  // IMPORTANT: modern lowercase "ex" and legacy uppercase "EX" are different
  // mechanics. TCGdex sometimes writes legacy cards as "Name-EX", so support
  // both a space and hyphen before EX/ex while preserving case.
  const japaneseNameEndingWith = (mechanic: string) =>
    new RegExp(
      `[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}]${mechanic}$`,
      "u"
    ).test(trimmed);

  // Printed-name mechanic case is authoritative. Do not use a case-insensitive
  // Japanese regex here: JavaScript's /i Unicode matching can case-fold the
  // ASCII mechanic suffix ("ex" / "EX") even when the Japanese characters
  // themselves have no case.
  const nameExLower =
    /(?:^|[\s-])ex$/u.test(trimmed) ||
    japaneseNameEndingWith("ex");

  const nameExUpper =
    /(?:^|[\s-])EX$/u.test(trimmed) ||
    japaneseNameEndingWith("EX");

  // If the literal printed name tells us which mechanic this is, it outranks
  // contradictory TCGdex suffix metadata. Only fall back to suffix when the
  // printed name itself does not explicitly end in ex/EX.
  const literalExTail =
    trimmed.endsWith("ex")
      ? "ex"
      : trimmed.endsWith("EX")
        ? "EX"
        : null;

  const nameHasExplicitEx =
    literalExTail !== null ||
    nameExLower ||
    nameExUpper;

  const exLower = nameHasExplicitEx
    ? literalExTail === "ex" ||
      (literalExTail === null && nameExLower && !nameExUpper)
    : suffixValue === "ex";

  const exUpper = nameHasExplicitEx
    ? literalExTail === "EX" ||
      (literalExTail === null && nameExUpper && !nameExLower)
    : suffixValue === "EX";

  const gx =
    /(?:^|[\s-])GX$/u.test(trimmed) ||
    japaneseNameEndingWith("GX") ||
    suffixValue.toUpperCase() === "GX";

  const vmax =
    /(?:^|[\s-])VMAX$/u.test(trimmed) ||
    japaneseNameEndingWith("VMAX") ||
    suffixValue.toUpperCase() === "VMAX";

  const vstar =
    /(?:^|[\s-])VSTAR$/u.test(trimmed) ||
    japaneseNameEndingWith("VSTAR") ||
    suffixValue.toUpperCase() === "VSTAR";

  const v =
    !vmax &&
    !vstar &&
    (/(?:^|[\s-])V$/u.test(trimmed) ||
      japaneseNameEndingWith("V") ||
      suffixValue === "V");

  const breakCard =
    /BREAK$/u.test(trimmed) ||
    suffixValue.toUpperCase() === "BREAK";

  const legend =
    /LEGEND$/u.test(trimmed) ||
    suffixValue.toUpperCase() === "LEGEND";

  const radiant = /^(?:かがやく|Radiant\s+)/iu.test(trimmed);

  // Keep modern Mega ex separate from the legacy "M ___ EX" mechanic.
  // Both are "Mega" thematically, but they are NOT interchangeable card identities.
  const modernMegaEx =
    exLower &&
    (/^メガ/u.test(trimmed) || /^Mega\s+/u.test(trimmed));

  const legacyMegaEX =
    exUpper &&
    /^M\s+.+(?:\s|-)?EX$/u.test(trimmed);

  const mega =
    modernMegaEx ||
    legacyMegaEX ||
    /^メガ/u.test(trimmed) ||
    /^Mega\s+/u.test(trimmed);

  const alolan = /^(?:アローラ\s*|Alolan\s+)/iu.test(trimmed);
  const galarian = /^(?:ガラル\s*|Galarian\s+)/iu.test(trimmed);
  const dark = /^(?:わるい|Dark\s+)/u.test(trimmed);
  const teamRocket =
    /^(?:ロケット団の|Team Rocket['’]s\s+)/iu.test(trimmed);

  const spG =
    /G$/u.test(trimmed) &&
    !gx &&
    !legend &&
    !galarian;

  const prismStar = /(?:◇|Prism Star)/iu.test(trimmed);

  return {
    exLower,
    exUpper,
    gx,
    v,
    vmax,
    vstar,
    break: breakCard,
    legend,
    radiant,
    mega,
    modernMegaEx,
    legacyMegaEX,
    alolan,
    galarian,
    dark,
    teamRocket,
    spG,
    prismStar,
  };
}

function identityModifiersCompatible(
  source: IdentityModifiers,
  candidate: IdentityModifiers
) {
  const keys: Array<keyof IdentityModifiers> = [
    "exLower",
    "exUpper",
    "gx",
    "v",
    "vmax",
    "vstar",
    "break",
    "legend",
    "radiant",
    "mega",
    "modernMegaEx",
    "legacyMegaEX",
    "alolan",
    "galarian",
    "dark",
    "teamRocket",
    "spG",
    "prismStar",
  ];

  // These are identity-defining mechanics/forms, not fuzzy scoring hints.
  // Compatibility is deliberately symmetrical: a source cannot gain OR lose
  // one of these identities when crossing to its English counterpart.
  //
  // Examples rejected here:
  //   modern "Genesect ex" -> legacy "Genesect-EX"
  //   modern "Mega Rayquaza ex" -> legacy "M Rayquaza EX"
  //   plain "Darkrai" -> "Darkrai ◇"
  //   "Team Rocket's Meowth" -> "Alolan Meowth"
  return keys.every((key) => source[key] === candidate[key]);
}

function expressionToDiagnosticValue(
  expression: ts.Expression
): unknown {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }

  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text);
  }

  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }

  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  if (expression.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.map((element) =>
      expressionToDiagnosticValue(element as ts.Expression)
    );
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return objectLiteralToDiagnosticValue(expression);
  }

  // Diagnostic-only fallback. Some parsed AST nodes do not retain a source-file
  // context, so calling getText() can throw. Preserve the syntax kind instead of
  // allowing a read-only probe to abort the production sync.
  return `[unhandled:${ts.SyntaxKind[expression.kind] ?? expression.kind}]`;
}

function objectLiteralToDiagnosticValue(
  object: ts.ObjectLiteralExpression
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;

    const name = propertyName(property);
    if (!name) continue;

    result[name] = expressionToDiagnosticValue(
      property.initializer
    );
  }

  return result;
}

function buildCardIdentity(
  object: ts.ObjectLiteralExpression | null,
  externalId: string,
  name: string
): CardIdentity {
  return {
    externalId,
    name,
    category: readStringProperty(object, "category"),
    dexIds: readNumberArrayProperty(object, "dexId").sort((a, b) => a - b),
    illustrator: readStringProperty(object, "illustrator"),
    suffix: readStringProperty(object, "suffix"),
    stage: readStringProperty(object, "stage"),
    trainerType: readStringProperty(object, "trainerType"),
    energyType: readStringProperty(object, "energyType"),
    regulationMark: readStringProperty(object, "regulationMark"),
    rarity: readStringProperty(object, "rarity"),
    variantKey: normalizedVariantKey(object),
    hp: readNumberProperty(object, "hp"),
    types: readStringArrayProperty(object, "types").sort(),
    weaknesses: normalizedTypedValueArray(object, "weaknesses"),
    resistances: normalizedTypedValueArray(object, "resistances"),
    retreat: readNumberProperty(object, "retreat"),
    attackFingerprint: normalizedAttackFingerprint(object),
    modifiers: buildIdentityModifiers(
      name,
      readStringProperty(object, "suffix")
    ),
  };
}

type CanonicalMatch = {
  externalId: string;
  name: string;
  confidence: number;
};

function sameNumberSet(a: number[], b: number[]) {
  return a.length > 0 &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

function resolveExplicitEnglishCounterpart(
  source: CardIdentity,
  candidates: CardIdentity[]
): CanonicalMatch | null {
  const targetExternalId =
    EXPLICIT_ENGLISH_COUNTERPARTS.get(source.externalId);

  if (!targetExternalId) {
    return null;
  }

  const target = candidates.find(
    (candidate) => candidate.externalId === targetExternalId
  );

  if (!target) {
    console.warn(
      `Explicit English counterpart ${targetExternalId} for ${source.externalId} was not found; leaving canonical identity unresolved.`
    );
    return null;
  }

  // Even explicit set mappings must obey the global identity/mechanic guardrails.
  // This prevents a bad map entry from crossing ex/EX, GX, VMAX, VSTAR, etc.
  if (!identityModifiersCompatible(source.modifiers, target.modifiers)) {
    console.warn(
      `Explicit English counterpart ${source.externalId} -> ${targetExternalId} failed identity modifier compatibility; leaving unresolved.`
    );
    return null;
  }

  return {
    externalId: target.externalId,
    name: target.name,
    confidence: 100,
  };
}

function sourceSetId(externalId: string) {
  const separator = externalId.indexOf("-");
  return separator === -1
    ? externalId
    : externalId.slice(0, separator);
}

function candidateBelongsToEnglishSet(
  candidateExternalId: string,
  englishSetId: string
) {
  return candidateExternalId.startsWith(`${englishSetId}-`);
}

type BattleStyle = "single" | "rapid";

function expectedBattleStyleForSourceSet(
  sourceExternalId: string
): BattleStyle | null {
  const setId = sourceSetId(sourceExternalId);
  if (setId === "S5I") return "single";
  if (setId === "S5R") return "rapid";
  return null;
}

function explicitBattleStyleFromEnglishName(
  name: string
): BattleStyle | null {
  if (/\bSingle Strike\b/i.test(name)) return "single";
  if (/\bRapid Strike\b/i.test(name)) return "rapid";
  return null;
}

function battleStyleFamilyCompatible(
  source: CardIdentity,
  candidate: CardIdentity
) {
  const expected = expectedBattleStyleForSourceSet(source.externalId);
  if (!expected) return true;

  const candidateStyle =
    explicitBattleStyleFromEnglishName(candidate.name);

  // Neutral English cards remain eligible. Only an explicitly opposite
  // Battle Style is rejected.
  return candidateStyle === null || candidateStyle === expected;
}

function resolveScoredEnglishIdentity(
  source: CardIdentity,
  candidates: CardIdentity[]
): CanonicalMatch | null {
  const scored: Array<{ card: CardIdentity; score: number; strong: number }> = [];

  for (const card of candidates) {
    if (source.category && card.category && source.category !== card.category) continue;

    if (!identityModifiersCompatible(source.modifiers, card.modifiers)) {
      continue;
    }

    if (!battleStyleFamilyCompatible(source, card)) {
      continue;
    }

    let score = 0;
    let strong = 0;

    if (sameNumberSet(source.dexIds, card.dexIds)) {
      score += 55;
      strong += 2;
    } else if (source.dexIds.length > 0 || card.dexIds.length > 0) {
      continue;
    }

    if (source.illustrator && card.illustrator && source.illustrator === card.illustrator) {
      score += 28;
      strong += 2;
    }
    if (source.suffix && card.suffix && source.suffix === card.suffix) {
      score += 10;
      strong += 1;
    }
    if (source.stage && card.stage && source.stage === card.stage) score += 7;
    if (source.trainerType && card.trainerType && source.trainerType === card.trainerType) {
      score += 18;
      strong += 1;
    }
    if (source.energyType && card.energyType && source.energyType === card.energyType) {
      score += 18;
      strong += 1;
    }
    if (source.regulationMark && card.regulationMark && source.regulationMark === card.regulationMark) score += 5;
    if (source.rarity && card.rarity && source.rarity === card.rarity) score += 5;
    if (source.variantKey && card.variantKey && source.variantKey === card.variantKey) score += 4;

    // Validated cross-language Pokémon identity evidence. Exact HP/type/attack
    // structure can establish which printed card design this is even when an
    // Asian localization omits dexIds/rarity. This does NOT distinguish regular
    // art from alternate/secret printings: identical English printings remain
    // tied here and are left for release-sequence corroboration.
    if (source.category === "Pokemon" && card.category === "Pokemon") {
      const printed = diagnosticPrintedCardEvidence(source, card);
      score += printed.score;
      strong += printed.strong;
    }

    // Keep the existing production floor. Printed evidence strengthens the
    // evidence pool; it does not weaken the threshold or modifier safety gates.
    if (score >= 78 && strong >= 3) scored.push({ card, score, strong });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;

  const second = scored[1];
  if (second && second.score === best.score) return null;

  return {
    externalId: best.card.externalId,
    name: best.card.name,
    confidence: Math.min(99, best.score),
  };
}

function sameStringArray(a: string[], b: string[]) {
  return a.length > 0 &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

function diagnosticPrintedCardEvidence(
  source: CardIdentity,
  candidate: CardIdentity
) {
  let score = 0;
  let strong = 0;
  const signals: string[] = [];

  if (source.hp !== null && candidate.hp !== null) {
    if (source.hp === candidate.hp) { score += 20; strong += 1; signals.push("hp:+20/+1"); }
    else signals.push(`hp-mismatch:${source.hp}->${candidate.hp}`);
  }

  if (source.types.length > 0 && candidate.types.length > 0) {
    if (sameStringArray(source.types, candidate.types)) { score += 24; strong += 1; signals.push("types:+24/+1"); }
    else signals.push(`types-mismatch:${source.types.join("+")}->${candidate.types.join("+")}`);
  }

  if (source.weaknesses.length > 0 && candidate.weaknesses.length > 0) {
    if (sameStringArray(source.weaknesses, candidate.weaknesses)) { score += 12; signals.push("weakness:+12"); }
    else signals.push("weakness-mismatch");
  }

  if (source.resistances.length > 0 || candidate.resistances.length > 0) {
    if (sameStringArray(source.resistances, candidate.resistances)) { score += 8; signals.push("resistance:+8"); }
    else signals.push("resistance-mismatch");
  }

  if (source.retreat !== null && candidate.retreat !== null) {
    if (source.retreat === candidate.retreat) { score += 8; signals.push("retreat:+8"); }
    else signals.push(`retreat-mismatch:${source.retreat}->${candidate.retreat}`);
  }

  if (source.attackFingerprint.length > 0 && candidate.attackFingerprint.length > 0) {
    if (sameStringArray(source.attackFingerprint, candidate.attackFingerprint)) {
      score += 36; strong += 2; signals.push("attacks:+36/+2");
    } else {
      signals.push("attacks-mismatch");
    }
  }

  return { score, strong, signals };
}

function diagnoseFamilyMiss(
  source: CardIdentity,
  candidates: CardIdentity[]
) {
  const sourceSet = sourceSetId(source.externalId);

  // Keep this diagnostic intentionally narrow so normal sync output stays readable.
  if (sourceSet !== "S5I" && sourceSet !== "S5R") {
    return;
  }

  const familySetIds = ENGLISH_SET_FAMILIES.get(sourceSet);
  if (!familySetIds) {
    return;
  }

  const familyCandidates = candidates.filter((candidate) =>
    familySetIds.some((setId) =>
      candidateBelongsToEnglishSet(candidate.externalId, setId)
    )
  );

  const rows = familyCandidates.map((card) => {
    const compatible = identityModifiersCompatible(
      source.modifiers,
      card.modifiers
    );

    let score = 0;
    let strong = 0;
    const signals: string[] = [];

    if (source.category && card.category && source.category !== card.category) {
      return {
        card,
        compatible,
        score: -999,
        strong: 0,
        signals: [`category-mismatch:${source.category}->${card.category}`],
      };
    }

    if (!compatible) {
      return {
        card,
        compatible,
        score: -998,
        strong: 0,
        signals: ["modifier-mismatch"],
      };
    }

    if (!battleStyleFamilyCompatible(source, card)) {
      return {
        card,
        compatible,
        score: -996,
        strong: 0,
        signals: ["battle-style-mismatch"],
      };
    }

    if (source.dexIds.length > 0 && card.dexIds.length > 0) {
      const sameDex =
        source.dexIds.length === card.dexIds.length &&
        source.dexIds.every((value, index) => value === card.dexIds[index]);

      if (!sameDex) {
        return {
          card,
          compatible,
          score: -997,
          strong: 0,
          signals: ["dex-mismatch"],
        };
      }

      score += 55;
      strong += 2;
      signals.push("dex:+55/+2");
    }

    if (
      source.illustrator &&
      card.illustrator &&
      source.illustrator === card.illustrator
    ) {
      score += 28;
      strong += 2;
      signals.push("illustrator:+28/+2");
    }

    if (source.suffix && card.suffix && source.suffix === card.suffix) {
      score += 10;
      strong += 1;
      signals.push("suffix:+10/+1");
    }

    if (source.stage && card.stage && source.stage === card.stage) {
      score += 7;
      signals.push("stage:+7");
    }

    if (
      source.trainerType &&
      card.trainerType &&
      source.trainerType === card.trainerType
    ) {
      score += 18;
      strong += 1;
      signals.push("trainerType:+18/+1");
    }

    if (
      source.energyType &&
      card.energyType &&
      source.energyType === card.energyType
    ) {
      score += 18;
      strong += 1;
      signals.push("energyType:+18/+1");
    }

    if (
      source.regulationMark &&
      card.regulationMark &&
      source.regulationMark === card.regulationMark
    ) {
      score += 5;
      signals.push("regulation:+5");
    }

    if (source.rarity && card.rarity && source.rarity === card.rarity) {
      score += 5;
      signals.push("rarity:+5");
    }

    if (source.variantKey && card.variantKey && source.variantKey === card.variantKey) {
      score += 4;
      signals.push("variant:+4");
    }

    const printed = diagnosticPrintedCardEvidence(source, card);
    return {
      card, compatible, score, strong, signals,
      diagnosticScore: score + printed.score,
      diagnosticStrong: strong + printed.strong,
      diagnosticSignals: printed.signals,
    };
  });

  const viable = rows
    .filter((row) => row.score >= 0)
    .sort((a, b) =>
      (b.diagnosticScore ?? b.score) - (a.diagnosticScore ?? a.score) ||
      (b.diagnosticStrong ?? b.strong) - (a.diagnosticStrong ?? a.strong)
    )
    .slice(0, 5);

  console.warn(
    `\nFAMILY MISS ${source.externalId} (${source.name}) [${source.category ?? "unknown"}]`
  );
  console.warn(
    `  Source modifiers: ${JSON.stringify(source.modifiers)}`
  );
  console.warn(
    `  Source identity: ${JSON.stringify({
      dexIds: source.dexIds,
      illustrator: source.illustrator,
      suffix: source.suffix,
      stage: source.stage,
      trainerType: source.trainerType,
      energyType: source.energyType,
      regulationMark: source.regulationMark,
      rarity: source.rarity,
      variant: source.variantKey,
      hp: source.hp,
      types: source.types,
      weaknesses: source.weaknesses,
      resistances: source.resistances,
      retreat: source.retreat,
      attackFingerprint: source.attackFingerprint,
    })}`
  );

  if (viable.length === 0) {
    const rejected = rows
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    console.warn("  No compatible family candidates. Closest rejected:");
    for (const row of rejected) {
      console.warn(
        `    ${row.card.externalId} (${row.card.name}) score=${row.score} strong=${row.strong} reasons=${row.signals.join(",")}`
      );
    }
    return;
  }

  console.warn("  Top compatible family candidates:");
  for (const row of viable) {
    console.warn(
      `    ${row.card.externalId} (${row.card.name}) productionScore=${row.score} productionStrong=${row.strong} diagnosticScore=${row.diagnosticScore ?? row.score} diagnosticStrong=${row.diagnosticStrong ?? row.strong} productionSignals=${row.signals.join(",") || "none"} printedSignals=${row.diagnosticSignals?.join(",") || "none"}`
    );
    console.warn(
      `      Candidate identity: ${JSON.stringify({
        dexIds: row.card.dexIds,
        illustrator: row.card.illustrator,
        suffix: row.card.suffix,
        stage: row.card.stage,
        trainerType: row.card.trainerType,
        energyType: row.card.energyType,
        regulationMark: row.card.regulationMark,
        rarity: row.card.rarity,
        variant: row.card.variantKey,
        hp: row.card.hp,
        types: row.card.types,
        weaknesses: row.card.weaknesses,
        resistances: row.card.resistances,
        retreat: row.card.retreat,
        attackFingerprint: row.card.attackFingerprint,
      })}`
    );
  }
}

function resolveCanonicalEnglishIdentity(
  source: CardIdentity,
  candidates: CardIdentity[]
): CanonicalMatch | null {
  const explicit = resolveExplicitEnglishCounterpart(source, candidates);
  if (explicit) {
    return explicit;
  }

  const familySetIds =
    ENGLISH_SET_FAMILIES.get(sourceSetId(source.externalId));

  if (familySetIds) {
    const familyCandidates = candidates.filter((candidate) =>
      familySetIds.some((setId) =>
        candidateBelongsToEnglishSet(candidate.externalId, setId)
      )
    );

    const familyMatch = resolveScoredEnglishIdentity(
      source,
      familyCandidates
    );

    if (familyMatch) {
      return familyMatch;
    }

    diagnoseFamilyMiss(source, candidates);
  }

  return resolveScoredEnglishIdentity(source, candidates);
}

function splitExternalId(
  externalId: string
): { setId: string; localId: string } | null {
  const separator = externalId.lastIndexOf("-");
  if (separator <= 0 || separator >= externalId.length - 1) {
    return null;
  }

  return {
    setId: externalId.slice(0, separator),
    localId: externalId.slice(separator + 1),
  };
}

function numericLocalId(localId: string) {
  return /^\d+$/.test(localId)
    ? Number(localId)
    : null;
}

function recordFamilyPositionSample(
  sourceSet: string,
  sourceLocalId: string,
  canonical: CanonicalMatch | null
) {
  if (
    (sourceSet !== "S5I" && sourceSet !== "S5R") ||
    !canonical
  ) {
    return;
  }

  const target = splitExternalId(canonical.externalId);
  if (!target || target.setId !== "swsh5") {
    return;
  }

  // Only learn from matches already accepted by the untouched production
  // resolver. Position is evidence we are studying, never evidence used here.
  familyPositionSamples.push({
    sourceSetId: sourceSet,
    sourceExternalId: `${sourceSet}-${sourceLocalId}`,
    sourceLocalId,
    englishExternalId: canonical.externalId,
    englishSetId: target.setId,
    englishLocalId: target.localId,
    confidence: canonical.confidence,
  });
}

function printCnSetDiscoveryDiagnostics() {
  console.log(
    "\n=== SIMPLIFIED CHINESE SET DISCOVERY (read-only; no matching or writes changed) ==="
  );

  const rows = Array.from(cnSetDiscoveryRows.values()).sort((a, b) =>
    (a.seriesId ?? "").localeCompare(b.seriesId ?? "") ||
    a.setId.localeCompare(b.setId, undefined, { numeric: true }) ||
    a.setName.localeCompare(b.setName)
  );

  if (rows.length === 0) {
    console.log("No Simplified Chinese (CN / zh-cn) localized sets were discovered.");
    console.log("=== END SIMPLIFIED CHINESE SET DISCOVERY ===\n");
    return;
  }

  const bySeries = new Map<string, CnSetDiscoveryRow[]>();
  for (const row of rows) {
    const key = row.seriesId ?? "(no-series-id)";
    const bucket = bySeries.get(key) ?? [];
    bucket.push(row);
    bySeries.set(key, bucket);
  }

  console.log(
    `Discovered ${rows.length} Simplified Chinese localized sets across ${bySeries.size} series.`
  );

  for (const [seriesId, seriesRows] of bySeries) {
    console.log(`\n[series=${seriesId}] ${seriesRows.length} sets`);
    for (const row of seriesRows) {
      console.log(
        `  ${row.setId.padEnd(12)} | ${row.setName} | cards=${row.cardCount} | released=${row.releasedAt ?? "unknown"}`
      );
    }
  }

  console.log("\n=== END SIMPLIFIED CHINESE SET DISCOVERY ===\n");
}

function printCnGemPackDiagnostics() {
  console.log("\n=== CN GEM PACK CARD AUDIT (read-only; no Gem-specific promotions) ===");

  if (cnGemSetNames.size === 0) {
    console.log("No Simplified Chinese CBB<number>C Gem Pack sets were detected.");
    console.log("=== END CN GEM PACK CARD AUDIT ===\n");
    return;
  }

  const setIds = Array.from(cnGemSetNames.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );
  console.log(`Detected ${setIds.length} CN Gem Pack set(s): ${setIds.join(", ")}`);

  let total = 0;
  let matched = 0;
  let unmatched = 0;

  for (const setId of setIds) {
    const rows = cnGemDiagnosticRows
      .filter((row) => row.setId === setId)
      .sort((a, b) => a.localId.localeCompare(b.localId, undefined, { numeric: true }));
    const resolved = rows.filter((row) => row.canonicalExternalId !== null);
    const unresolved = rows.filter((row) => row.canonicalExternalId === null);

    total += rows.length;
    matched += resolved.length;
    unmatched += unresolved.length;

    const meta = cnGemSetAuditMeta.get(setId);
    console.log(`\nCN::${setId} | ${cnGemSetNames.get(setId)}`);
    console.log(
      `rawCardFiles=${meta?.rawCardFiles ?? "unknown"} ` +
      `zhCnNamedCards=${meta?.zhCnNamedCards ?? rows.length} ` +
      `auditedCards=${rows.length} globallyCanonicalized=${resolved.length} unresolved=${unresolved.length}`
    );

    if ((meta?.rawCardFiles ?? 0) > 0 && rows.length === 0) {
      console.log(
        "  DIAGNOSTIC: set exists and has raw card files, but none exposed a zh-cn card name. " +
        "Inspect the raw Gem card localization keys before changing canonical matching."
      );
    }

    for (const row of rows) {
      const identity = row.identity;
      console.log(`\n  ${setId}-${row.localId} | ${row.sourceName}`);
      console.log(
        `    currentCanonical=${row.canonicalExternalId ?? "null"}` +
        `${row.canonicalName ? ` (${row.canonicalName})` : ""}` +
        ` confidence=${row.confidence ?? "null"}`
      );
      console.log(
        `    fingerprint=${JSON.stringify({
          category: identity.category,
          dexIds: identity.dexIds,
          illustrator: identity.illustrator,
          suffix: identity.suffix,
          stage: identity.stage,
          trainerType: identity.trainerType,
          energyType: identity.energyType,
          regulationMark: identity.regulationMark,
          rarity: identity.rarity,
          variantKey: identity.variantKey,
          hp: identity.hp,
          types: identity.types,
          weaknesses: identity.weaknesses,
          resistances: identity.resistances,
          retreat: identity.retreat,
          attackFingerprint: identity.attackFingerprint,
          modifiers: identity.modifiers,
        })}`
      );
    }
  }

  const rate = total > 0 ? ((matched / total) * 100).toFixed(1) : "0.0";
  console.log(
    `\nCN Gem Pack card audit summary: sets=${setIds.length} cards=${total} ` +
    `globallyCanonicalized=${matched} unresolved=${unmatched} matchRate=${rate}%`
  );
  console.log(
    "NOTE: This report measures the existing global matcher only. " +
    "It does not add Gem-specific set-family, sequence, or canonical promotions."
  );
  console.log("=== END CN GEM PACK CARD AUDIT ===\n");
}
function printFamilyPositionDiagnostics() {
  const targetSets = ["S5I", "S5R"];

  console.log(
    "\n=== FAMILY POSITION DIAGNOSTIC (read-only; does not affect matching) ==="
  );

  for (const sourceSet of targetSets) {
    const samples = familyPositionSamples
      .filter((sample) => sample.sourceSetId === sourceSet)
      .map((sample) => ({
        ...sample,
        sourceNumber: numericLocalId(sample.sourceLocalId),
        englishNumber: numericLocalId(sample.englishLocalId),
      }))
      .filter(
        (sample): sample is typeof sample & {
          sourceNumber: number;
          englishNumber: number;
        } =>
          sample.sourceNumber !== null &&
          sample.englishNumber !== null
      )
      .sort((a, b) => a.sourceNumber - b.sourceNumber);

    console.log(
      `\n${sourceSet} -> swsh5: ${samples.length} already-confident numeric matches`
    );

    if (samples.length === 0) {
      console.log("  No numeric evidence available.");
      continue;
    }

    const deltas = new Map<number, number>();
    for (const sample of samples) {
      const delta = sample.englishNumber - sample.sourceNumber;
      deltas.set(delta, (deltas.get(delta) ?? 0) + 1);

      console.log(
        `  ${sample.sourceExternalId.padEnd(9)} -> ${sample.englishExternalId.padEnd(10)} ` +
          `delta=${delta >= 0 ? "+" : ""}${delta} confidence=${sample.confidence}`
      );
    }

    const rankedDeltas = Array.from(deltas.entries())
      .sort((a, b) => b[1] - a[1] || a[0] - b[0]);

    console.log("  Delta frequencies:");
    for (const [delta, count] of rankedDeltas.slice(0, 12)) {
      console.log(
        `    ${delta >= 0 ? "+" : ""}${delta}: ${count}`
      );
    }

    // Build contiguous runs where BOTH source and English numbering advance by 1.
    // These runs reveal stable release segments without assuming a single global offset.
    const runs: typeof samples[] = [];
    let currentRun: typeof samples = [];

    for (const sample of samples) {
      const previous = currentRun[currentRun.length - 1];

      if (
        !previous ||
        (
          sample.sourceNumber === previous.sourceNumber + 1 &&
          sample.englishNumber === previous.englishNumber + 1
        )
      ) {
        currentRun.push(sample);
      } else {
        if (currentRun.length > 0) {
          runs.push(currentRun);
        }
        currentRun = [sample];
      }
    }

    if (currentRun.length > 0) {
      runs.push(currentRun);
    }

    const meaningfulRuns = runs
      .filter((run) => run.length >= 2)
      .sort((a, b) => b.length - a.length);

    console.log("  Contiguous source/English runs (length >= 2):");
    if (meaningfulRuns.length === 0) {
      console.log("    none");
    } else {
      for (const run of meaningfulRuns) {
        const first = run[0];
        const last = run[run.length - 1];
        const firstDelta = first.englishNumber - first.sourceNumber;
        const sameDelta = run.every(
          (sample) =>
            sample.englishNumber - sample.sourceNumber === firstDelta
        );

        console.log(
          `    ${sourceSet}-${first.sourceLocalId}..${last.sourceLocalId}` +
            ` -> swsh5-${first.englishLocalId}..${last.englishLocalId}` +
            ` length=${run.length}` +
            (sameDelta
              ? ` delta=${firstDelta >= 0 ? "+" : ""}${firstDelta}`
              : "")
        );
      }
    }
  }

  console.log(
    "\n=== END FAMILY POSITION DIAGNOSTIC ===\n"
  );
}


function scoreFamilySequenceCandidate(
  source: CardIdentity,
  card: CardIdentity
): FamilySequenceCandidate | null {
  if (
    source.category &&
    card.category &&
    source.category !== card.category
  ) {
    return null;
  }

  if (!identityModifiersCompatible(source.modifiers, card.modifiers)) {
    return null;
  }

  if (!battleStyleFamilyCompatible(source, card)) {
    return null;
  }

  let score = 0;
  let strong = 0;
  const signals: string[] = [];

  if (source.dexIds.length > 0 && card.dexIds.length > 0) {
    if (!sameNumberSet(source.dexIds, card.dexIds)) {
      return null;
    }
    score += 55;
    strong += 2;
    signals.push("dex:+55/+2");
  }

  if (
    source.illustrator &&
    card.illustrator &&
    source.illustrator === card.illustrator
  ) {
    score += 28;
    strong += 2;
    signals.push("illustrator:+28/+2");
  }

  if (
    source.suffix &&
    card.suffix &&
    source.suffix === card.suffix
  ) {
    score += 10;
    strong += 1;
    signals.push("suffix:+10/+1");
  }

  if (
    source.stage &&
    card.stage &&
    source.stage === card.stage
  ) {
    score += 7;
    signals.push("stage:+7");
  }

  if (
    source.trainerType &&
    card.trainerType &&
    source.trainerType === card.trainerType
  ) {
    score += 18;
    strong += 1;
    signals.push("trainerType:+18/+1");
  }

  if (
    source.energyType &&
    card.energyType &&
    source.energyType === card.energyType
  ) {
    score += 18;
    strong += 1;
    signals.push("energyType:+18/+1");
  }

  if (
    source.regulationMark &&
    card.regulationMark &&
    source.regulationMark === card.regulationMark
  ) {
    score += 5;
    signals.push("regulation:+5");
  }

  if (
    source.rarity &&
    card.rarity &&
    source.rarity === card.rarity
  ) {
    score += 5;
    signals.push("rarity:+5");
  }

  if (
    source.variantKey &&
    card.variantKey &&
    source.variantKey === card.variantKey
  ) {
    score += 4;
    signals.push("variant:+4");
  }

  // Same validated Pokémon-only printed-card evidence used by the family
  // resolver. This is intentionally additive rather than a new bypass: the
  // modifier/Battle Style gates above still apply, and identical alternate
  // printings remain tied so sequence structure must choose the printing.
  if (source.category === "Pokemon" && card.category === "Pokemon") {
    const printed = diagnosticPrintedCardEvidence(source, card);
    score += printed.score;
    strong += printed.strong;
    signals.push(...printed.signals.map((signal) => `printed:${signal}`));
  }

  const target = splitExternalId(card.externalId);

  return {
    externalId: card.externalId,
    name: card.name,
    englishNumber:
      target?.setId === "swsh5"
        ? numericLocalId(target.localId)
        : null,
    score,
    strong,
    signals,
  };
}

function recordFamilySequenceObservation(
  sourceSet: string,
  sourceLanguage: CatalogLanguage,
  sourceLocalId: string,
  sourceName: string,
  source: CardIdentity,
  canonical: CanonicalMatch | null,
  candidates: CardIdentity[]
) {
  if (sourceSet !== "S5I" && sourceSet !== "S5R") {
    return;
  }

  const familySetIds = ENGLISH_SET_FAMILIES.get(sourceSet);
  if (!familySetIds) {
    return;
  }

  const familyCandidates = candidates
    .filter((candidate) =>
      familySetIds.some((setId) =>
        candidateBelongsToEnglishSet(candidate.externalId, setId)
      )
    )
    .map((candidate) =>
      scoreFamilySequenceCandidate(source, candidate)
    )
    .filter(
      (candidate): candidate is FamilySequenceCandidate =>
        candidate !== null &&
        candidate.englishNumber !== null
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.strong - a.strong ||
        (a.englishNumber ?? Number.MAX_SAFE_INTEGER) -
          (b.englishNumber ?? Number.MAX_SAFE_INTEGER)
    );

  // Keep each localization independent. A JP observation must never be
  // reused to promote a CN-TW or CN row that happens to share the same ID.
  const sourceExternalId = `${sourceSet}-${sourceLocalId}`;
  const key = `${sourceLanguage}::${sourceExternalId}`;
  const observation: FamilySequenceObservation = {
    sourceSetId: sourceSet,
    sourceExternalId,
    sourceLanguage,
    sourceLocalId,
    sourceName,
    sourceNumber: numericLocalId(sourceLocalId),
    sourceCategory: source.category,
    canonicalExternalId: canonical?.externalId ?? null,
    canonicalConfidence: canonical?.confidence ?? null,
    candidates: familyCandidates.slice(0, 8),
  };

  const existing = familySequenceObservations.get(key);
  if (!existing) {
    familySequenceObservations.set(key, observation);
    return;
  }

  const existingTop = existing.candidates[0];
  const incomingTop = observation.candidates[0];

  if (
    incomingTop &&
    (
      !existingTop ||
      incomingTop.score > existingTop.score ||
      (
        incomingTop.score === existingTop.score &&
        incomingTop.strong > existingTop.strong
      )
    )
  ) {
    familySequenceObservations.set(key, observation);
  }
}

function printFamilySequenceDiagnostics() {
  console.log(
    "\n=== FAMILY SEQUENCE DIAGNOSTIC (read-only; does not affect matching) ==="
  );

  for (const sourceSet of ["S5I", "S5R"]) {
    const observations = Array.from(
      familySequenceObservations.values()
    )
      .filter(
        (observation) =>
          observation.sourceSetId === sourceSet &&
          observation.sourceNumber !== null
      )
      .sort(
        (a, b) =>
          (a.sourceNumber ?? 0) - (b.sourceNumber ?? 0)
      );

    console.log(
      `\n${sourceSet} -> swsh5: ${observations.length} deduped source cards`
    );

    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index];

      if (observation.canonicalExternalId) {
        continue;
      }

      const previous = observations[index - 1];
      const next = observations[index + 1];

      const previousEnglish = previous?.canonicalExternalId
        ? splitExternalId(previous.canonicalExternalId)
        : null;
      const nextEnglish = next?.canonicalExternalId
        ? splitExternalId(next.canonicalExternalId)
        : null;

      const previousNumber =
        previousEnglish?.setId === "swsh5"
          ? numericLocalId(previousEnglish.localId)
          : null;
      const nextNumber =
        nextEnglish?.setId === "swsh5"
          ? numericLocalId(nextEnglish.localId)
          : null;

      const bridgeCandidates = observation.candidates.filter(
        (candidate) =>
          candidate.englishNumber !== null &&
          (
            previousNumber === null ||
            candidate.englishNumber > previousNumber
          ) &&
          (
            nextNumber === null ||
            candidate.englishNumber < nextNumber
          )
      );

      const exactBridgeCandidates = observation.candidates.filter(
        (candidate) =>
          candidate.englishNumber !== null &&
          previousNumber !== null &&
          nextNumber !== null &&
          nextNumber === previousNumber + 2 &&
          candidate.englishNumber === previousNumber + 1
      );

      console.log(
        `\n  UNRESOLVED ${observation.sourceExternalId} (${observation.sourceName})`
      );
      console.log(
        `    neighbor anchors: prev=${
          previous?.canonicalExternalId ?? "none"
        } next=${next?.canonicalExternalId ?? "none"}`
      );

      if (exactBridgeCandidates.length === 1) {
        const candidate = exactBridgeCandidates[0];
        console.log(
          `    EXACT CONSECUTIVE BRIDGE: ${candidate.externalId} (${candidate.name}) ` +
            `score=${candidate.score} strong=${candidate.strong}`
        );
      } else if (bridgeCandidates.length === 1) {
        const candidate = bridgeCandidates[0];
        console.log(
          `    UNIQUE ORDERED BRIDGE: ${candidate.externalId} (${candidate.name}) ` +
            `score=${candidate.score} strong=${candidate.strong}`
        );
      } else if (bridgeCandidates.length > 1) {
        console.log(
          `    ordered bridge candidates: ${bridgeCandidates.length}`
        );
      } else {
        console.log("    ordered bridge candidates: none");
      }

      const top = observation.candidates.slice(0, 5);
      if (top.length === 0) {
        console.log("    compatible family candidates: none");
        continue;
      }

      console.log("    top compatible family candidates:");
      for (const candidate of top) {
        const ordered =
          bridgeCandidates.some(
            (item) => item.externalId === candidate.externalId
          );

        console.log(
          `      ${candidate.externalId} (${candidate.name}) ` +
            `score=${candidate.score} strong=${candidate.strong}` +
            `${ordered ? " ORDER-OK" : ""} ` +
            `signals=${candidate.signals.join(",") || "none"}`
        );
      }
    }

    // Detect simple source gaps bounded by already accepted canonical anchors.
    console.log(`\n  ${sourceSet} anchored one-card gaps:`);
    let gapCount = 0;

    for (let index = 1; index < observations.length - 1; index += 1) {
      const previous = observations[index - 1];
      const current = observations[index];
      const next = observations[index + 1];

      if (
        current.canonicalExternalId ||
        !previous.canonicalExternalId ||
        !next.canonicalExternalId
      ) {
        continue;
      }

      const prevTarget = splitExternalId(previous.canonicalExternalId);
      const nextTarget = splitExternalId(next.canonicalExternalId);

      if (
        prevTarget?.setId !== "swsh5" ||
        nextTarget?.setId !== "swsh5"
      ) {
        continue;
      }

      const prevNumber = numericLocalId(prevTarget.localId);
      const nextNumber = numericLocalId(nextTarget.localId);

      if (
        prevNumber === null ||
        nextNumber === null ||
        nextNumber !== prevNumber + 2
      ) {
        continue;
      }

      const expectedNumber = prevNumber + 1;
      const candidate = current.candidates.find(
        (item) => item.englishNumber === expectedNumber
      );

      if (!candidate) {
        continue;
      }

      gapCount += 1;
      console.log(
        `    ${previous.sourceExternalId} -> ${previous.canonicalExternalId} | ` +
          `${current.sourceExternalId} -> ${candidate.externalId} (${candidate.name}) | ` +
          `${next.sourceExternalId} -> ${next.canonicalExternalId} ` +
          `[candidate score=${candidate.score} strong=${candidate.strong}]`
      );
    }

    if (gapCount === 0) {
      console.log("    none");
    }
  }

  console.log(
    "\n=== END FAMILY SEQUENCE DIAGNOSTIC ===\n"
  );
}


type MonotonicPathNode = {
  observation: FamilySequenceObservation;
  candidate: FamilySequenceCandidate;
  candidateIndex: number;
};

type MonotonicPathState = {
  value: number;
  previousIndex: number | null;
};

function familyPathCandidateValue(
  observation: FamilySequenceObservation,
  candidate: FamilySequenceCandidate
) {
  // Diagnostic ranking only. Existing card evidence remains dominant.
  // This value is NEVER fed back into canonical matching.
  let value = candidate.score + candidate.strong * 8;

  // Reward the candidate the untouched production resolver already accepted.
  if (observation.canonicalExternalId === candidate.externalId) {
    value += 120;
  }

  return value;
}

function buildBestStrictlyIncreasingFamilyPath(
  observations: FamilySequenceObservation[]
) {
  const usable = observations
    .filter(
      (observation) =>
        observation.sourceNumber !== null &&
        observation.candidates.some(
          (candidate) => candidate.englishNumber !== null
        )
    )
    .sort(
      (a, b) =>
        (a.sourceNumber ?? 0) - (b.sourceNumber ?? 0)
    );

  const layers: MonotonicPathNode[][] = usable.map(
    (observation) =>
      observation.candidates
        .filter(
          (candidate) => candidate.englishNumber !== null
        )
        .map((candidate, candidateIndex) => ({
          observation,
          candidate,
          candidateIndex,
        }))
  );

  const states: MonotonicPathState[][] = [];

  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const layer = layers[layerIndex];
    const layerStates: MonotonicPathState[] = [];

    for (let candidateIndex = 0; candidateIndex < layer.length; candidateIndex += 1) {
      const node = layer[candidateIndex];
      const candidateNumber = node.candidate.englishNumber;
      const nodeValue = familyPathCandidateValue(
        node.observation,
        node.candidate
      );

      let bestValue = nodeValue;
      let bestPreviousIndex: number | null = null;

      if (layerIndex > 0) {
        const previousLayer = layers[layerIndex - 1];
        const previousStates = states[layerIndex - 1];

        for (
          let previousIndex = 0;
          previousIndex < previousLayer.length;
          previousIndex += 1
        ) {
          const previousNode = previousLayer[previousIndex];
          const previousNumber =
            previousNode.candidate.englishNumber;

          if (
            candidateNumber === null ||
            previousNumber === null ||
            candidateNumber <= previousNumber
          ) {
            continue;
          }

          const sourceGap =
            (node.observation.sourceNumber ?? 0) -
            (previousNode.observation.sourceNumber ?? 0);
          const englishGap =
            candidateNumber - previousNumber;

          // Sequence coherence bonus:
          // exact equal-sized movement is strongest; near movement gets
          // progressively less. Diagnostic only.
          const gapDifference = Math.abs(englishGap - sourceGap);
          const sequenceBonus =
            gapDifference === 0
              ? 45
              : gapDifference === 1
                ? 30
                : gapDifference <= 3
                  ? 18
                  : gapDifference <= 8
                    ? 8
                    : 0;

          const total =
            previousStates[previousIndex].value +
            nodeValue +
            sequenceBonus;

          if (total > bestValue) {
            bestValue = total;
            bestPreviousIndex = previousIndex;
          }
        }
      }

      layerStates.push({
        value: bestValue,
        previousIndex: bestPreviousIndex,
      });
    }

    states.push(layerStates);
  }

  if (layers.length === 0) {
    return {
      usable,
      path: [] as MonotonicPathNode[],
      score: 0,
    };
  }

  const lastLayerIndex = layers.length - 1;
  let bestLastIndex = 0;

  for (
    let index = 1;
    index < states[lastLayerIndex].length;
    index += 1
  ) {
    if (
      states[lastLayerIndex][index].value >
      states[lastLayerIndex][bestLastIndex].value
    ) {
      bestLastIndex = index;
    }
  }

  const reversed: MonotonicPathNode[] = [];
  let currentIndex: number | null = bestLastIndex;

  for (
    let layerIndex = lastLayerIndex;
    layerIndex >= 0 && currentIndex !== null;
    layerIndex -= 1
  ) {
    reversed.push(layers[layerIndex][currentIndex]);
    currentIndex =
      states[layerIndex][currentIndex].previousIndex;
  }

  return {
    usable,
    path: reversed.reverse(),
    score: states[lastLayerIndex][bestLastIndex].value,
  };
}

function printFamilyMonotonicPathDiagnostics() {
  console.log(
    "\n=== FAMILY MONOTONIC PATH DIAGNOSTIC (read-only; does not affect matching) ==="
  );

  for (const sourceSet of ["S5I", "S5R"]) {
    const observations = Array.from(
      familySequenceObservations.values()
    ).filter(
      (observation) =>
        observation.sourceSetId === sourceSet
    );

    const result =
      buildBestStrictlyIncreasingFamilyPath(observations);

    console.log(
      `\n${sourceSet} -> swsh5 BEST STRICTLY-INCREASING PATH`
    );
    console.log(
      `  observations=${result.usable.length} pathCards=${result.path.length} diagnosticValue=${result.score}`
    );

    if (result.path.length === 0) {
      console.log("  No path available.");
      continue;
    }

    let previous: MonotonicPathNode | null = null;
    let exactStepCount = 0;
    let nearStepCount = 0;
    let productionAgreement = 0;
    let productionDisagreement = 0;

    for (const node of result.path) {
      const sourceNumber =
        node.observation.sourceNumber ?? 0;
      const englishNumber =
        node.candidate.englishNumber ?? 0;

      let stepLabel = "START";

      if (previous) {
        const previousSource =
          previous.observation.sourceNumber ?? 0;
        const previousEnglish =
          previous.candidate.englishNumber ?? 0;

        const sourceGap = sourceNumber - previousSource;
        const englishGap = englishNumber - previousEnglish;
        const difference = Math.abs(englishGap - sourceGap);

        if (difference === 0) {
          exactStepCount += 1;
          stepLabel = `EXACT-STEP src+${sourceGap}/en+${englishGap}`;
        } else if (difference <= 3) {
          nearStepCount += 1;
          stepLabel = `NEAR-STEP src+${sourceGap}/en+${englishGap}`;
        } else {
          stepLabel = `JUMP src+${sourceGap}/en+${englishGap}`;
        }
      }

      let productionLabel = "";
      if (node.observation.canonicalExternalId) {
        if (
          node.observation.canonicalExternalId ===
          node.candidate.externalId
        ) {
          productionAgreement += 1;
          productionLabel = " PROD-AGREE";
        } else {
          productionDisagreement += 1;
          productionLabel =
            ` PROD-DISAGREE(${node.observation.canonicalExternalId})`;
        }
      }

      const top = node.observation.candidates[0];
      const margin =
        top && top.externalId === node.candidate.externalId
          ? (
              node.observation.candidates[1]
                ? top.score -
                  node.observation.candidates[1].score
                : top.score
            )
          : null;

      const rank =
        node.observation.candidates.findIndex(
          (candidate) =>
            candidate.externalId === node.candidate.externalId
        ) + 1;

      console.log(
        `  ${node.observation.sourceExternalId.padEnd(9)} ` +
          `-> ${node.candidate.externalId.padEnd(10)} ` +
          `${node.candidate.name} ` +
          `[rank=${rank} score=${node.candidate.score} strong=${node.candidate.strong}` +
          `${margin !== null ? ` topMargin=${margin}` : ""}] ` +
          `${stepLabel}${productionLabel}`
      );

      previous = node;
    }

    console.log("  Path summary:");
    console.log(
      `    exactSteps=${exactStepCount} nearSteps=${nearStepCount}`
    );
    console.log(
      `    productionAgreement=${productionAgreement} productionDisagreement=${productionDisagreement}`
    );

    // Surface suspicious path choices: anything not rank 1, or any choice
    // conflicting with an already-approved production match.
    const suspicious = result.path.filter((node) => {
      const rank =
        node.observation.candidates.findIndex(
          (candidate) =>
            candidate.externalId === node.candidate.externalId
        ) + 1;

      return (
        rank !== 1 ||
        (
          node.observation.canonicalExternalId !== null &&
          node.observation.canonicalExternalId !==
            node.candidate.externalId
        )
      );
    });

    console.log("  Suspicious/non-top path choices:");
    if (suspicious.length === 0) {
      console.log("    none");
    } else {
      for (const node of suspicious) {
        const rank =
          node.observation.candidates.findIndex(
            (candidate) =>
              candidate.externalId === node.candidate.externalId
          ) + 1;

        console.log(
          `    ${node.observation.sourceExternalId} -> ` +
            `${node.candidate.externalId} (${node.candidate.name}) ` +
            `rank=${rank} score=${node.candidate.score} strong=${node.candidate.strong}` +
            (
              node.observation.canonicalExternalId
                ? ` production=${node.observation.canonicalExternalId}`
                : ""
            )
        );
      }
    }
  }

  console.log(
    "\n=== END FAMILY MONOTONIC PATH DIAGNOSTIC ===\n"
  );
}


type SafeSequenceProposal = {
  observation: FamilySequenceObservation;
  candidate: FamilySequenceCandidate;
  rank: number;
  reason: string;
  leftNeighbor: FamilySequenceObservation | null;
  rightNeighbor: FamilySequenceObservation | null;
};

function candidateRank(
  observation: FamilySequenceObservation,
  externalId: string
) {
  const index = observation.candidates.findIndex(
    (candidate) => candidate.externalId === externalId
  );
  return index >= 0 ? index + 1 : null;
}

function bestEligibleSequenceCandidate(
  observation: FamilySequenceObservation
) {
  const eligible = observation.candidates.filter(
    (candidate) =>
      candidate.englishNumber !== null &&
      candidate.strong >= 2 &&
      candidate.score >= 40
  );

  if (eligible.length === 0) {
    return null;
  }

  const best = eligible[0];
  const tied = eligible.filter(
    (candidate) =>
      candidate.score === best.score &&
      candidate.strong === best.strong
  );

  return {
    best,
    tied,
  };
}

function printSafeFamilySequenceResolverDiagnostics() {
  console.log(
    "\n=== SAFE FAMILY SEQUENCE RESOLVER DIAGNOSTIC (read-only; does not affect matching) ==="
  );
  console.log(
    "Rules: production canonical wins; mechanics gate already applied; candidate must score>=40 and strong>=2; sequence may break identity ties but cannot create identity from position alone."
  );

  for (const sourceSet of ["S5I", "S5R"]) {
    const observations = Array.from(
      familySequenceObservations.values()
    )
      .filter(
        (observation) =>
          observation.sourceSetId === sourceSet &&
          observation.sourceNumber !== null
      )
      .sort(
        (a, b) =>
          (a.sourceNumber ?? 0) - (b.sourceNumber ?? 0)
      );

    const eligibleBySource = new Map<
      string,
      ReturnType<typeof bestEligibleSequenceCandidate>
    >();

    for (const observation of observations) {
      eligibleBySource.set(
        observation.sourceExternalId,
        bestEligibleSequenceCandidate(observation)
      );
    }

    const proposals: SafeSequenceProposal[] = [];
    const rejected: string[] = [];

    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index];

      // Existing production match remains authoritative.
      if (observation.canonicalExternalId) {
        continue;
      }

      const eligible =
        eligibleBySource.get(observation.sourceExternalId) ?? null;

      if (!eligible) {
        rejected.push(
          `${observation.sourceExternalId}: no candidate reaches score>=40 + strong>=2`
        );
        continue;
      }

      const { best, tied } = eligible;

      // Unique identity winner: sequence is only corroboration, not the reason.
      if (tied.length === 1) {
        const rank =
          candidateRank(observation, best.externalId) ?? 1;

        proposals.push({
          observation,
          candidate: best,
          rank,
          reason: "UNIQUE-IDENTITY",
          leftNeighbor:
            index > 0 ? observations[index - 1] : null,
          rightNeighbor:
            index + 1 < observations.length
              ? observations[index + 1]
              : null,
        });
        continue;
      }

      // Tied identity evidence: allow sequence to choose ONLY if exactly one tied
      // candidate is compatible with strong neighboring identity candidates.
      const leftObservation =
        index > 0 ? observations[index - 1] : null;
      const rightObservation =
        index + 1 < observations.length
          ? observations[index + 1]
          : null;

      const leftEligible = leftObservation
        ? eligibleBySource.get(leftObservation.sourceExternalId) ?? null
        : null;
      const rightEligible = rightObservation
        ? eligibleBySource.get(rightObservation.sourceExternalId) ?? null
        : null;

      // Neighbor bounds are only trusted when the neighbor has a unique eligible
      // identity winner OR an existing production canonical.
      const leftNumber = (() => {
        if (!leftObservation) return null;

        if (leftObservation.canonicalExternalId) {
          const parsed = splitExternalId(
            leftObservation.canonicalExternalId
          );
          return parsed?.setId === "swsh5"
            ? numericLocalId(parsed.localId)
            : null;
        }

        if (
          leftEligible &&
          leftEligible.tied.length === 1
        ) {
          return leftEligible.best.englishNumber;
        }

        return null;
      })();

      const rightNumber = (() => {
        if (!rightObservation) return null;

        if (rightObservation.canonicalExternalId) {
          const parsed = splitExternalId(
            rightObservation.canonicalExternalId
          );
          return parsed?.setId === "swsh5"
            ? numericLocalId(parsed.localId)
            : null;
        }

        if (
          rightEligible &&
          rightEligible.tied.length === 1
        ) {
          return rightEligible.best.englishNumber;
        }

        return null;
      })();

      const orderedTies = tied.filter((candidate) => {
        const number = candidate.englishNumber;
        if (number === null) return false;

        if (leftNumber !== null && number <= leftNumber) {
          return false;
        }

        if (rightNumber !== null && number >= rightNumber) {
          return false;
        }

        return true;
      });

      if (
        orderedTies.length === 1 &&
        (leftNumber !== null || rightNumber !== null)
      ) {
        const candidate = orderedTies[0];
        proposals.push({
          observation,
          candidate,
          rank:
            candidateRank(
              observation,
              candidate.externalId
            ) ?? 1,
          reason:
            leftNumber !== null && rightNumber !== null
              ? "TIE-BROKEN-BY-TWO-SIDED-SEQUENCE"
              : "TIE-BROKEN-BY-ONE-SIDED-SEQUENCE",
          leftNeighbor: leftObservation,
          rightNeighbor: rightObservation,
        });
      } else {
        rejected.push(
          `${observation.sourceExternalId}: identity tie remains (${tied
            .map((candidate) => candidate.externalId)
            .join(", ")})`
        );
      }
    }

    console.log(`\n${sourceSet} SAFE PROPOSALS`);

    if (proposals.length === 0) {
      console.log("  none");
    }

    let uniqueIdentityCount = 0;
    let sequenceTieBreakCount = 0;

    for (const proposal of proposals) {
      if (proposal.reason === "UNIQUE-IDENTITY") {
        uniqueIdentityCount += 1;
      } else {
        sequenceTieBreakCount += 1;
      }

      const left = proposal.leftNeighbor;
      const right = proposal.rightNeighbor;

      console.log(
        `  ${proposal.observation.sourceExternalId.padEnd(9)} -> ` +
          `${proposal.candidate.externalId.padEnd(10)} ` +
          `${proposal.candidate.name} ` +
          `[rank=${proposal.rank} score=${proposal.candidate.score} strong=${proposal.candidate.strong}] ` +
          `${proposal.reason}`
      );

      if (proposal.reason !== "UNIQUE-IDENTITY") {
        console.log(
          `    neighbors: left=${
            left?.canonicalExternalId ??
            left?.sourceExternalId ??
            "none"
          } right=${
            right?.canonicalExternalId ??
            right?.sourceExternalId ??
            "none"
          }`
        );
      }
    }

    console.log("  Summary:");
    console.log(
      `    safeProposals=${proposals.length} uniqueIdentity=${uniqueIdentityCount} sequenceTieBreaks=${sequenceTieBreakCount} rejected=${rejected.length}`
    );

    console.log("  Rejected / still ambiguous:");
    if (rejected.length === 0) {
      console.log("    none");
    } else {
      for (const line of rejected) {
        console.log(`    ${line}`);
      }
    }
  }

  console.log(
    "\n=== END SAFE FAMILY SEQUENCE RESOLVER DIAGNOSTIC ===\n"
  );
}


type SequenceConfidenceRow = {
  observation: FamilySequenceObservation;
  candidate: FamilySequenceCandidate;
  rank: number;
  confidencePoints: number;
  tier: "HIGH" | "MEDIUM" | "LOW";
  reasons: string[];
  canonicalAgreement: boolean | null;
};

function sequenceConfidenceForCandidate(
  observation: FamilySequenceObservation,
  candidate: FamilySequenceCandidate,
  observations: FamilySequenceObservation[],
  index: number
): SequenceConfidenceRow {
  const reasons: string[] = [];
  let points = 0;

  const rank =
    candidateRank(observation, candidate.externalId) ?? 999;

  // Identity evidence.
  if (candidate.strong >= 4) {
    points += 34;
    reasons.push("identity-strong>=4:+34");
  } else if (candidate.strong === 3) {
    points += 27;
    reasons.push("identity-strong=3:+27");
  } else if (candidate.strong === 2) {
    points += 18;
    reasons.push("identity-strong=2:+18");
  }

  if (candidate.score >= 90) {
    points += 24;
    reasons.push("identity-score>=90:+24");
  } else if (candidate.score >= 70) {
    points += 18;
    reasons.push("identity-score>=70:+18");
  } else if (candidate.score >= 50) {
    points += 12;
    reasons.push("identity-score>=50:+12");
  } else if (candidate.score >= 40) {
    points += 7;
    reasons.push("identity-score>=40:+7");
  }

  if (rank === 1) {
    points += 10;
    reasons.push("candidate-rank1:+10");
  } else if (rank === 2) {
    points += 4;
    reasons.push("candidate-rank2:+4");
  }

  const second = observation.candidates.find(
    (other) => other.externalId !== candidate.externalId
  );
  const margin = second
    ? candidate.score - second.score
    : candidate.score;

  if (rank === 1 && margin >= 20) {
    points += 12;
    reasons.push("identity-margin>=20:+12");
  } else if (rank === 1 && margin >= 7) {
    points += 7;
    reasons.push("identity-margin>=7:+7");
  } else if (rank === 1 && margin > 0) {
    points += 3;
    reasons.push("identity-margin>0:+3");
  } else if (rank === 1 && margin === 0) {
    reasons.push("identity-tie:+0");
  }

  const number = candidate.englishNumber;

  const getTrustedNeighborNumber = (
    neighbor: FamilySequenceObservation | undefined
  ) => {
    if (!neighbor) return null;

    if (neighbor.canonicalExternalId) {
      const parsed = splitExternalId(neighbor.canonicalExternalId);
      if (parsed?.setId === "swsh5") {
        return numericLocalId(parsed.localId);
      }
    }

    const eligible = bestEligibleSequenceCandidate(neighbor);
    if (eligible && eligible.tied.length === 1) {
      return eligible.best.englishNumber;
    }

    return null;
  };

  const leftObservation =
    index > 0 ? observations[index - 1] : undefined;
  const rightObservation =
    index + 1 < observations.length
      ? observations[index + 1]
      : undefined;

  const leftNumber = getTrustedNeighborNumber(leftObservation);
  const rightNumber = getTrustedNeighborNumber(rightObservation);

  let leftOrder = false;
  let rightOrder = false;

  if (number !== null && leftNumber !== null && number > leftNumber) {
    leftOrder = true;
  }

  if (number !== null && rightNumber !== null && number < rightNumber) {
    rightOrder = true;
  }

  if (leftOrder && rightOrder) {
    points += 22;
    reasons.push("two-sided-order:+22");
  } else if (leftOrder || rightOrder) {
    points += 11;
    reasons.push("one-sided-order:+11");
  }

  // Stronger continuity bonus when adjacent source positions map to nearby
  // English positions. This is corroboration only.
  if (
    number !== null &&
    leftObservation &&
    leftNumber !== null &&
    observation.sourceNumber !== null &&
    leftObservation.sourceNumber !== null
  ) {
    const sourceGap =
      observation.sourceNumber - leftObservation.sourceNumber;
    const englishGap = number - leftNumber;
    const difference = Math.abs(englishGap - sourceGap);

    if (difference === 0) {
      points += 10;
      reasons.push("left-exact-step:+10");
    } else if (difference <= 2) {
      points += 6;
      reasons.push("left-near-step:+6");
    }
  }

  if (
    number !== null &&
    rightObservation &&
    rightNumber !== null &&
    observation.sourceNumber !== null &&
    rightObservation.sourceNumber !== null
  ) {
    const sourceGap =
      rightObservation.sourceNumber - observation.sourceNumber;
    const englishGap = rightNumber - number;
    const difference = Math.abs(englishGap - sourceGap);

    if (difference === 0) {
      points += 10;
      reasons.push("right-exact-step:+10");
    } else if (difference <= 2) {
      points += 6;
      reasons.push("right-near-step:+6");
    }
  }

  let canonicalAgreement: boolean | null = null;
  if (observation.canonicalExternalId) {
    canonicalAgreement =
      observation.canonicalExternalId === candidate.externalId;

    if (canonicalAgreement) {
      points += 30;
      reasons.push("production-agreement:+30");
    } else {
      points -= 100;
      reasons.push("PRODUCTION-DISAGREEMENT:-100");
    }
  }

  const tier: SequenceConfidenceRow["tier"] =
    points >= 75 ? "HIGH" : points >= 55 ? "MEDIUM" : "LOW";

  return {
    observation,
    candidate,
    rank,
    confidencePoints: points,
    tier,
    reasons,
    canonicalAgreement,
  };
}

function printSequenceConfidenceDiagnostics() {
  console.log(
    "\n=== SEQUENCE CONFIDENCE CALIBRATION (read-only; does not affect matching) ==="
  );
  console.log(
    "Calibration only: HIGH>=75, MEDIUM>=55, LOW<55. Production matches are used only as validation signals."
  );

  for (const sourceSet of ["S5I", "S5R"]) {
    const observations = Array.from(
      familySequenceObservations.values()
    )
      .filter(
        (observation) =>
          observation.sourceSetId === sourceSet &&
          observation.sourceNumber !== null
      )
      .sort(
        (a, b) =>
          (a.sourceNumber ?? 0) - (b.sourceNumber ?? 0)
      );

    const rows: SequenceConfidenceRow[] = [];

    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index];
      const eligible = bestEligibleSequenceCandidate(observation);

      if (!eligible) continue;

      // Score all tied top identity candidates. For unique winners this is one row.
      for (const candidate of eligible.tied) {
        rows.push(
          sequenceConfidenceForCandidate(
            observation,
            candidate,
            observations,
            index
          )
        );
      }
    }

    const high = rows.filter((row) => row.tier === "HIGH");
    const medium = rows.filter((row) => row.tier === "MEDIUM");
    const low = rows.filter((row) => row.tier === "LOW");

    const validationRows = rows.filter(
      (row) => row.canonicalAgreement !== null
    );
    const agreements = validationRows.filter(
      (row) => row.canonicalAgreement === true
    );
    const disagreements = validationRows.filter(
      (row) => row.canonicalAgreement === false
    );

    console.log(`\n${sourceSet} CONFIDENCE SUMMARY`);
    console.log(
      `  candidateRows=${rows.length} HIGH=${high.length} MEDIUM=${medium.length} LOW=${low.length}`
    );
    console.log(
      `  productionValidation=${validationRows.length} agreements=${agreements.length} disagreements=${disagreements.length}`
    );

    console.log("  HIGH confidence candidates:");
    if (high.length === 0) {
      console.log("    none");
    } else {
      for (const row of high) {
        console.log(
          `    ${row.observation.sourceExternalId.padEnd(9)} -> ` +
            `${row.candidate.externalId.padEnd(10)} ${row.candidate.name} ` +
            `[points=${row.confidencePoints} rank=${row.rank} score=${row.candidate.score} strong=${row.candidate.strong}] ` +
            `${row.canonicalAgreement === true ? "PROD-AGREE " : ""}` +
            row.reasons.join(",")
        );
      }
    }

    console.log("  MEDIUM confidence candidates:");
    if (medium.length === 0) {
      console.log("    none");
    } else {
      for (const row of medium) {
        console.log(
          `    ${row.observation.sourceExternalId.padEnd(9)} -> ` +
            `${row.candidate.externalId.padEnd(10)} ${row.candidate.name} ` +
            `[points=${row.confidencePoints} rank=${row.rank} score=${row.candidate.score} strong=${row.candidate.strong}] ` +
            row.reasons.join(",")
        );
      }
    }

    console.log("  LOW / unresolved-risk candidates:");
    if (low.length === 0) {
      console.log("    none");
    } else {
      for (const row of low) {
        console.log(
          `    ${row.observation.sourceExternalId.padEnd(9)} -> ` +
            `${row.candidate.externalId.padEnd(10)} ${row.candidate.name} ` +
            `[points=${row.confidencePoints} rank=${row.rank} score=${row.candidate.score} strong=${row.candidate.strong}] ` +
            row.reasons.join(",")
        );
      }
    }

    console.log("  Production disagreements:");
    if (disagreements.length === 0) {
      console.log("    none");
    } else {
      for (const row of disagreements) {
        console.log(
          `    ${row.observation.sourceExternalId} candidate=${row.candidate.externalId} production=${row.observation.canonicalExternalId} points=${row.confidencePoints}`
        );
      }
    }
  }

  console.log(
    "\n=== END SEQUENCE CONFIDENCE CALIBRATION ===\n"
  );
}



function printBattleStyleDiagnostics() {
  console.log(
    "\n=== BATTLE STYLE DIAGNOSTIC (read-only; does not affect matching) ==="
  );

  const rawS5RObservations = Array.from(familySequenceObservations.values())
    .filter(
      (observation) =>
        observation.sourceLanguage === "JP" &&
        observation.sourceExternalId.startsWith("S5R-")
    )
    .sort((a, b) =>
      a.sourceExternalId.localeCompare(b.sourceExternalId)
    );

  console.log(
    `\nJP S5R observations captured: ${rawS5RObservations.length}`
  );

  const allS5RObservations = Array.from(familySequenceObservations.values())
    .filter((observation) => observation.sourceSetId === "S5R")
    .sort((a, b) =>
      a.sourceExternalId.localeCompare(b.sourceExternalId)
    );

  const s5rLanguageCounts = new Map<CatalogLanguage, number>();
  for (const observation of allS5RObservations) {
    s5rLanguageCounts.set(
      observation.sourceLanguage,
      (s5rLanguageCounts.get(observation.sourceLanguage) ?? 0) + 1
    );
  }

  console.log("S5R observations by language:");
  for (const language of ["JP", "CN-TW", "CN"] as CatalogLanguage[]) {
    console.log(
      `  ${language}: ${s5rLanguageCounts.get(language) ?? 0}`
    );
  }

  const s5rProbeIds = new Set(["S5R-049", "S5R-050", "S5R-051", "S5R-052"]);

  console.log("S5R 049-052 localization ownership:");
  const localizedProbeRows = allS5RObservations.filter((observation) =>
    s5rProbeIds.has(observation.sourceExternalId)
  );

  if (localizedProbeRows.length === 0) {
    console.log("  none");
  } else {
    for (const observation of localizedProbeRows) {
      console.log(
        `  ${observation.sourceLanguage}::${observation.sourceExternalId} name=${observation.sourceName} canonical=${observation.canonicalExternalId ?? "null"} confidence=${observation.canonicalConfidence ?? "null"} candidates=${observation.candidates.length}`
      );
    }
  }

  for (const observation of rawS5RObservations.filter((item) =>
    s5rProbeIds.has(item.sourceExternalId)
  )) {
    console.log(
      `  RAW ${observation.sourceLanguage}::${observation.sourceExternalId} name=${observation.sourceName} category=${observation.sourceCategory} canonical=${observation.canonicalExternalId ?? "null"} confidence=${observation.canonicalConfidence ?? "null"} candidates=${observation.candidates.length}`
    );

    const topCandidates = [...observation.candidates]
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.strong - a.strong ||
          (a.englishNumber ?? 9999) - (b.englishNumber ?? 9999)
      )
      .slice(0, 8);

    for (const candidate of topCandidates) {
      console.log(
        `    -> ${candidate.externalId} (${candidate.name}) score=${candidate.score} strong=${candidate.strong}`
      );
    }
  }

  for (const id of s5rProbeIds) {
    if (!rawS5RObservations.some((item) => item.sourceExternalId === id)) {
      console.log(`  MISSING JP::${id} from familySequenceObservations`);
    }
  }

  const targetSourceIds = new Set([
    "S5I-036",
    "S5I-037",
    "S5I-074",
    "S5I-075",
    "S5I-084",
    "S5I-085",
    "S5R-050",
    "S5R-051",
  ]);

  const observations = Array.from(familySequenceObservations.values())
    .filter(
      (observation) =>
        observation.sourceLanguage === "JP" &&
        targetSourceIds.has(observation.sourceExternalId)
    )
    .sort((a, b) =>
      a.sourceExternalId.localeCompare(b.sourceExternalId)
    );

  if (observations.length === 0) {
    console.log("  No JP Battle Style target observations found.");
  }

  for (const observation of observations) {
    const expected =
      expectedBattleStyleForSourceSet(observation.sourceExternalId);

    console.log(
      `\n${observation.sourceLanguage}::${observation.sourceExternalId} (${observation.sourceName}) expectedStyle=${expected ?? "none"}`
    );

    console.log(
      `  productionCanonical=${observation.canonicalExternalId ?? "null"} confidence=${observation.canonicalConfidence ?? "null"}`
    );

    const sourceSet =
      sourceSetId(observation.sourceExternalId);
    const familySetIds =
      ENGLISH_SET_FAMILIES.get(sourceSet) ?? [];

    const allFamilyCandidates = englishIdentities
      .filter((candidate) =>
        familySetIds.some((setId) =>
          candidateBelongsToEnglishSet(candidate.externalId, setId)
        )
      )
      .filter((candidate) => {
        const split = splitExternalId(candidate.externalId);
        return split?.setId === "swsh5";
      });

    const explicitStyleCandidates = allFamilyCandidates
      .filter((candidate) =>
        explicitBattleStyleFromEnglishName(candidate.name) !== null
      )
      .filter((candidate) =>
        candidate.modifiers.v ||
        candidate.modifiers.vmax
      );

    const compatible = explicitStyleCandidates
      .filter((candidate) =>
        battleStyleFamilyCompatible(
          {
            externalId: observation.sourceExternalId,
            name: observation.sourceName,
            category: observation.sourceCategory,
            dexIds: [],
            illustrator: null,
            suffix: null,
            stage: null,
            trainerType: null,
            energyType: null,
            regulationMark: null,
            rarity: null,
            variantKey: "",
            hp: null,
            types: [],
            weaknesses: [],
            resistances: [],
            retreat: null,
            attackFingerprint: [],
            modifiers: candidate.modifiers,
          },
          candidate
        )
      );

    const rejected = explicitStyleCandidates
      .filter((candidate) => !compatible.includes(candidate));

    const scored = observation.candidates
      .filter((candidate) =>
        explicitStyleCandidates.some(
          (styleCandidate) =>
            styleCandidate.externalId === candidate.externalId
        )
      )
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.strong - a.strong ||
          (a.englishNumber ?? 9999) - (b.englishNumber ?? 9999)
      );

    console.log("  eligible style candidates:");
    const eligibleRows = scored.filter((candidate) =>
      compatible.some(
        (styleCandidate) =>
          styleCandidate.externalId === candidate.externalId
      )
    );

    if (eligibleRows.length === 0) {
      console.log("    none");
    } else {
      for (const candidate of eligibleRows) {
        console.log(
          `    ${candidate.externalId} (${candidate.name}) score=${candidate.score} strong=${candidate.strong}`
        );
      }
    }

    console.log("  rejected opposite-style candidates:");
    const rejectedRows = scored.filter((candidate) =>
      rejected.some(
        (styleCandidate) =>
          styleCandidate.externalId === candidate.externalId
      )
    );

    if (rejectedRows.length === 0) {
      // Some rejected candidates are absent from observation.candidates because
      // the production sequence scorer already filtered them. Still surface names.
      const rejectedNames = rejected.slice(0, 12);
      if (rejectedNames.length === 0) {
        console.log("    none");
      } else {
        for (const candidate of rejectedNames) {
          console.log(
            `    ${candidate.externalId} (${candidate.name}) [filtered before sequence scoring]`
          );
        }
      }
    } else {
      for (const candidate of rejectedRows) {
        console.log(
          `    ${candidate.externalId} (${candidate.name}) score=${candidate.score} strong=${candidate.strong}`
        );
      }
    }
  }

  console.log(
    "\n=== END BATTLE STYLE DIAGNOSTIC ===\n"
  );
}


type ProductionSequencePromotion = {
  sourceExternalId: string;
  sourceLanguage: CatalogLanguage;
  canonicalExternalId: string;
  canonicalName: string;
  confidence: number;
  reason: string;
};

function trustedSequenceNeighborNumber(
  observation: FamilySequenceObservation | undefined
) {
  if (!observation) return null;

  if (observation.canonicalExternalId) {
    const parsed = splitExternalId(observation.canonicalExternalId);
    if (parsed?.setId === "swsh5") {
      return numericLocalId(parsed.localId);
    }
  }

  const eligible = bestEligibleSequenceCandidate(observation);
  if (eligible && eligible.tied.length === 1) {
    return eligible.best.englishNumber;
  }

  return null;
}

function productionSequenceLanguageForSourceSet(
  sourceSet: string
): CatalogLanguage | null {
  // Language-scoped production rollout:
  // - S5I is present/validated as Japanese in TCGdex data-asia.
  // - S5R is present as Traditional Chinese (CN-TW), not Japanese.
  // Do not broaden CN-TW promotion eligibility beyond S5R without
  // independent calibration for that release family.
  if (sourceSet === "S5I") return "JP";
  if (sourceSet === "S5R") return "CN-TW";
  return null;
}

function buildProductionFamilySequencePromotions() {
  const promotions = new Map<string, ProductionSequencePromotion>();

  for (const sourceSet of ["S5I", "S5R"]) {
    const productionLanguage =
      productionSequenceLanguageForSourceSet(sourceSet);

    if (!productionLanguage) continue;

    console.log(
      `Production sequence scope: ${sourceSet} -> ${productionLanguage}`
    );

    const observations = Array.from(
      familySequenceObservations.values()
    )
      .filter(
        (observation) =>
          observation.sourceSetId === sourceSet &&
          observation.sourceLanguage === productionLanguage &&
          observation.sourceNumber !== null
      )
      .sort(
        (a, b) =>
          (a.sourceNumber ?? 0) - (b.sourceNumber ?? 0)
      );

    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index];

      // Production rule #1: never replace an existing canonical match.
      if (observation.canonicalExternalId) continue;

      // First production rollout is Pokémon-only. Trainer/Energy sequence
      // ordering proved less reliable in diagnostics.
      if (observation.sourceCategory !== "Pokemon") continue;

      const eligible = bestEligibleSequenceCandidate(observation);
      if (!eligible) continue;

      const leftNumber = trustedSequenceNeighborNumber(
        index > 0 ? observations[index - 1] : undefined
      );
      const rightNumber = trustedSequenceNeighborNumber(
        index + 1 < observations.length
          ? observations[index + 1]
          : undefined
      );

      const hasTrustedNeighbor =
        leftNumber !== null || rightNumber !== null;

      if (!hasTrustedNeighbor) continue;

      const orderedCandidates = eligible.tied.filter((candidate) => {
        const number = candidate.englishNumber;
        if (number === null) return false;
        if (leftNumber !== null && number <= leftNumber) return false;
        if (rightNumber !== null && number >= rightNumber) return false;
        return true;
      });

      let selected: FamilySequenceCandidate | null = null;
      let reason = "";

      if (eligible.tied.length === 1) {
        // Unique top identity candidate. Sequence must corroborate it.
        const candidate = eligible.best;
        if (!orderedCandidates.some(
          (ordered) => ordered.externalId === candidate.externalId
        )) {
          continue;
        }

        const confidence = sequenceConfidenceForCandidate(
          observation,
          candidate,
          observations,
          index
        );

        // Calibrated production floor from S5I validation:
        // MEDIUM+ is allowed only for a unique rank-1 identity winner
        // with trusted structural support.
        if (
          confidence.confidencePoints >= 55 &&
          confidence.rank === 1 &&
          candidate.strong >= 2 &&
          candidate.score >= 40
        ) {
          selected = candidate;
          reason = `unique-identity+sequence:${confidence.confidencePoints}`;
        }
      } else {
        // Identity tie: sequence may break it only when exactly one tied
        // candidate survives the trusted neighbor bounds AND it reaches HIGH.
        if (orderedCandidates.length !== 1) continue;

        const candidate = orderedCandidates[0];
        const confidence = sequenceConfidenceForCandidate(
          observation,
          candidate,
          observations,
          index
        );

        if (
          confidence.confidencePoints >= 75 &&
          candidate.strong >= 2 &&
          candidate.score >= 40
        ) {
          selected = candidate;
          reason = `sequence-tiebreak-high:${confidence.confidencePoints}`;
        }
      }

      if (!selected) continue;

      const confidence = sequenceConfidenceForCandidate(
        observation,
        selected,
        observations,
        index
      );

      const promotionKey =
        `${observation.sourceLanguage}::${observation.sourceExternalId}`;

      promotions.set(promotionKey, {
        sourceExternalId: observation.sourceExternalId,
        sourceLanguage: observation.sourceLanguage,
        canonicalExternalId: selected.externalId,
        canonicalName: selected.name,
        confidence: Math.min(97, confidence.confidencePoints),
        reason,
      });
    }
  }

  console.log(
    `\nProduction family-sequence promotions prepared: ${promotions.size}`
  );

  for (const promotion of promotions.values()) {
    console.log(
      `  ${promotion.sourceLanguage}::${promotion.sourceExternalId} -> ${promotion.canonicalExternalId} (${promotion.canonicalName}) confidence=${promotion.confidence} reason=${promotion.reason}`
    );
  }

  return promotions;
}

function applyProductionFamilySequencePromotions(
  rows: CardRow[],
  promotions: Map<string, ProductionSequencePromotion>
) {
  let applied = 0;
  let skippedExisting = 0;

  for (const row of rows) {
    const promotionKey = `${row.language}::${row.external_id}`;
    const promotion = promotions.get(promotionKey);
    if (!promotion) continue;

    if (row.language !== promotion.sourceLanguage) continue;

    // Existing canonical identity is always authoritative.
    if (row.canonical_external_id) {
      skippedExisting += 1;
      continue;
    }

    row.canonical_name = promotion.canonicalName;
    row.canonical_external_id = promotion.canonicalExternalId;
    row.canonical_language = "EN";
    row.canonical_confidence = promotion.confidence;
    applied += 1;
  }

  console.log(
    `Production family-sequence promotions applied: ${applied}; existing canonicals preserved: ${skippedExisting}.`
  );
}

function dedupeCatalogRows<
  T extends {
    data_source?: unknown;
    language?: unknown;
    external_id?: unknown;
  }
>(
  rows: T[],
  label: string
) {
  const byIdentity =
    new Map<string, T>();

  for (const row of rows) {
    const source =
      String(
        row.data_source ?? ""
      ).trim();

    const language =
      String(
        row.language ?? ""
      ).trim();

    const externalId =
      String(
        row.external_id ?? ""
      ).trim();

    const key =
      `${source}\u0000${language}\u0000${externalId}`;

    if (
      byIdentity.has(key)
    ) {
      const existing =
        byIdentity.get(key)!;

      if (
        JSON.stringify(existing) !==
        JSON.stringify(row)
      ) {
        console.warn(
          `${label}: duplicate source identity ${source} / ${language} / ${externalId}; keeping the later discovered row.`
        );
      }
    }

    byIdentity.set(
      key,
      row
    );
  }

  return Array.from(
    byIdentity.values()
  );
}

const UPSERT_MAX_ATTEMPTS = 5;
const UPSERT_RETRY_BASE_MS = 1000;

function sleep(ms: number) {
  return new Promise<void>((resolve) =>
    setTimeout(resolve, ms)
  );
}

function isTransientUpsertError(
  error: unknown
) {
  const message =
    error instanceof Error
      ? error.message
      : String(
          (error as any)?.message ||
            error ||
            ""
        );

  const normalized =
    message.toLowerCase();

  return (
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("socket") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("connection") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("und_err") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504")
  );
}

async function upsertBatches(
  table: string,
  rows: Record<
    string,
    unknown
  >[],
  batchSize: number
) {
  for (
    let start = 0;
    start < rows.length;
    start += batchSize
  ) {
    const batch =
      rows.slice(
        start,
        start + batchSize
      );

    let completed = false;

    for (
      let attempt = 1;
      attempt <=
        UPSERT_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const { error } =
          await supabase
            .from(table)
            .upsert(
              batch,
              {
                onConflict:
                  "data_source,language,external_id",
              }
            );

        if (error) {
          throw error;
        }

        completed = true;
        break;
      } catch (error) {
        const transient =
          isTransientUpsertError(
            error
          );

        if (
          !transient ||
          attempt ===
            UPSERT_MAX_ATTEMPTS
        ) {
          const message =
            error instanceof Error
              ? error.message
              : String(
                  (error as any)?.message ||
                    error
                );

          throw new Error(
            `${table} upsert failed at row ${start}: ${message}`
          );
        }

        const delay =
          UPSERT_RETRY_BASE_MS *
          attempt;

        console.warn(
          `${table}: transient failure at row ${start} (attempt ${attempt}/${UPSERT_MAX_ATTEMPTS}); retrying in ${delay}ms...`
        );

        await sleep(delay);
      }
    }

    if (!completed) {
      throw new Error(
        `${table} upsert failed at row ${start}: retry loop exited unexpectedly`
      );
    }

    console.log(
      `${table}: ${Math.min(
        start + batch.length,
        rows.length
      )}/${rows.length}`
    );
  }
}

function loadEnvFile(
  filePath: string
) {
  if (!existsSync(filePath)) {
    return;
  }

  const contents =
    readFileSync(
      filePath,
      "utf8"
    );

  for (
    const rawLine of
    contents.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const index =
      line.indexOf("=");

    if (index < 1) {
      continue;
    }

    const key =
      line
        .slice(0, index)
        .trim();

    let value =
      line
        .slice(index + 1)
        .trim();

    if (
      (value.startsWith('"') &&
        value.endsWith('"')) ||
      (value.startsWith("'") &&
        value.endsWith("'"))
    ) {
      value =
        value.slice(
          1,
          -1
        );
    }

    if (
      !process.env[key]
    ) {
      process.env[key] =
        value;
    }
  }
}

main().catch((error) => {
  console.error(
    "\nPokémon sync failed:",
    error
  );
  process.exit(1);
});
