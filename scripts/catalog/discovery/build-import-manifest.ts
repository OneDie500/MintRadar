
/**
 * MintRadar #5F-F6
 * Read-only discovery -> importable catalog manifests.
 *
 * Requires:
 *  - Complete #5F-F3 discovery report
 *  - #5F-F5 reviewed-language report
 *  - Explicit SHA-256 of the discovery report
 *
 * Safeguards:
 *  - No live API calls or Supabase calls
 *  - No database writes or approvals
 *  - No unapproved image URLs in import manifests
 *  - Provider card IDs remain distinct
 *  - Collector numbers remain physical card numbers
 *  - Missing/ambiguous language or printing evidence fails closed
 *  - Upstream review queues block importable output
 *
 * Self-test:
 * npx tsx scripts/catalog/discovery/build-import-manifest.ts --self-test
 *
 * Production evidence preparation:
 * npx tsx scripts/catalog/discovery/build-import-manifest.ts \
 *   --discovery=PATH_TO_F3_REPORT.json \
 *   --languages=PATH_TO_F5_REPORT.json \
 *   --sha256=EXPECTED_DISCOVERY_FILE_SHA256
 *
 * Output is for importer --dry-run only.
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  validateCatalogManifest,
  type CatalogCard,
  type CatalogLanguage,
  type CatalogManifest,
  type CatalogSet,
} from "../validate";

import { normalizeCatalogManifest } from "../normalize";

const SOURCE = "tcgapi_discovery";

type JsonRecord = Record<string, unknown>;

type Review = {
  scope: "report" | "set" | "card";
  setId?: string;
  cardId?: string;
  reason: string;
};

type BuildResult = {
  manifests: CatalogManifest[];
  reviewQueue: Review[];
  summary: {
    discoverySha256: string;
    discoveredSets: number;
    importableSets: number;
    importableCards: number;
    withheldSets: number;
    reviewItems: number;
    imageUrlsPublished: 0;
    noDatabaseCalls: true;
    noCatalogWrites: true;
    noApprovals: true;
    languageProvenanceBound: false;
  };
};

function record(
  value: unknown
): value is JsonRecord {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function text(
  value: unknown
): string | null {
  return typeof value === "string" &&
    value.trim().length > 0
    ? value.trim()
    : null;
}

function identifier(
  value: unknown
): string | null {
  const result = text(value);

  return result &&
    /^[a-zA-Z0-9_-]+$/.test(result)
    ? result
    : null;
}

function language(
  value: unknown
): CatalogLanguage | null {
  return value === "EN" ||
    value === "JP" ||
    value === "CN" ||
    value === "CN-TW"
    ? value
    : null;
}

function fail(message: string): never {
  throw new Error(message);
}

function sha256(
  bytes: Buffer | string
): string {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

function releaseDate(
  value: unknown
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const date = text(value);

  if (!date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return undefined;
  }

  const parsed = new Date(
    `${date}T00:00:00Z`
  );

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    return undefined;
  }

  return date;
}

function reviewedLanguage(
  entry: unknown,
  setId: string,
  setName: string
): CatalogLanguage | null {
  if (!record(entry)) return null;

  if (
    entry.providerSetId !== setId ||
    entry.setName !== setName ||
    entry.status !== "EVIDENCE_REVIEWED"
  ) {
    return null;
  }

  if (
    !text(entry.sourceUrl) ||
    !text(entry.reviewedBy) ||
    !text(entry.reviewedAt)
  ) {
    return null;
  }

  // This is reviewed evidence, not independent
  // verification of the source webpage.
  return language(entry.language);
}

export function buildImportManifests(
  discovery: unknown,
  languageReport: unknown,
  discoveryDigest: string
): BuildResult {
  if (!/^[a-f0-9]{64}$/.test(discoveryDigest)) {
    fail("Invalid discovery SHA-256");
  }

  if (
    !record(discovery) ||
    discovery.provider !== "tcgapi" ||
    discovery.listingComplete !== true ||
    !Array.isArray(discovery.acceptedSets) ||
    !Array.isArray(discovery.reviewQueue)
  ) {
    fail("Discovery report is incomplete");
  }

  if (
    !record(languageReport) ||
    languageReport.provider !== "tcgapi" ||
    languageReport.version !== 1 ||
    languageReport.listingComplete !== true ||
    !Array.isArray(languageReport.verifiedLanguages) ||
    !Array.isArray(languageReport.reviewQueue)
  ) {
    fail("Language report is invalid");
  }

  // F5 does not yet include a source report digest.
  // We therefore cannot claim cryptographic binding.
  if (
    discovery.reviewQueue.length > 0 ||
    languageReport.reviewQueue.length > 0
  ) {
    fail(
      "Unresolved upstream review items; " +
      "importable output blocked"
    );
  }

  const reviewQueue: Review[] = [];
  const groups = new Map<
    CatalogLanguage,
    CatalogSet[]
  >();

  const seenSets = new Set<string>();
  const seenProviderCards = new Set<string>();

  const evidenceBySet = new Map<
    string,
    unknown[]
  >();

  for (const entry of languageReport.verifiedLanguages) {
    if (!record(entry)) {
      fail("Malformed language evidence");
    }

    const id = identifier(entry.providerSetId);

    if (!id) {
      fail("Language evidence missing set ID");
    }

    const existing = evidenceBySet.get(id) ?? [];
    existing.push(entry);
    evidenceBySet.set(id, existing);
  }

  for (const rawSet of discovery.acceptedSets) {
    if (!record(rawSet)) {
      reviewQueue.push({
        scope: "set",
        reason: "Malformed set",
      });
      continue;
    }

    const setId = identifier(
      rawSet.providerSetId
    );

    const setName = text(rawSet.name);

    if (
      !setId ||
      !setName ||
      rawSet.complete !== true ||
      !Array.isArray(rawSet.cards) ||
      rawSet.cards.length === 0
    ) {
      reviewQueue.push({
        scope: "set",
        setId: setId ?? undefined,
        reason: "Incomplete set identity",
      });
      continue;
    }

    if (seenSets.has(setId)) {
      reviewQueue.push({
        scope: "set",
        setId,
        reason: "Duplicate provider set ID",
      });
      continue;
    }

    seenSets.add(setId);

    if (
      text(rawSet.game)?.toLowerCase() !==
      "pokemon"
    ) {
      reviewQueue.push({
        scope: "set",
        setId,
        reason:
          "Unsupported or unknown game",
      });
      continue;
    }

    const evidence =
      evidenceBySet.get(setId) ?? [];

    if (evidence.length !== 1) {
      reviewQueue.push({
        scope: "set",
        setId,
        reason:
          "Missing or duplicate language evidence",
      });
      continue;
    }

    const setLanguage = reviewedLanguage(
      evidence[0],
      setId,
      setName
    );

    if (!setLanguage) {
      reviewQueue.push({
        scope: "set",
        setId,
        reason:
          "Language review does not match set",
      });
      continue;
    }

    const date = releaseDate(
      rawSet.releaseDate
    );

    if (
      rawSet.releaseDate !== null &&
      rawSet.releaseDate !== undefined &&
      !date
    ) {
      reviewQueue.push({
        scope: "set",
        setId,
        reason: "Invalid release date",
      });
      continue;
    }

    const cards: CatalogCard[] = [];
    const localIds = new Set<string>();
    let invalid = false;

    for (const rawCard of rawSet.cards) {
      if (!record(rawCard)) {
        invalid = true;
        reviewQueue.push({
          scope: "card",
          setId,
          reason: "Malformed card",
        });
        continue;
      }

      const providerCardId = identifier(
        rawCard.providerId
      );

      const name = text(rawCard.name);
      const number = text(
        rawCard.collectorNumber
      );

      if (
        !providerCardId ||
        !name ||
        !number ||
        localIds.has(providerCardId) ||
        seenProviderCards.has(providerCardId) ||
        rawCard.identityApproved !== false ||
        rawCard.artworkApproved !== false ||
        rawCard.rightsCleared !== false
      ) {
        invalid = true;
        reviewQueue.push({
          scope: "card",
          setId,
          cardId:
            providerCardId ?? undefined,
          reason:
            "Invalid or duplicate card identity",
        });
        continue;
      }

      localIds.add(providerCardId);

      const card: CatalogCard = {
        id: `tcgapi-card-${providerCardId}`,
        name,
        collectorNumber: number,
      };

      if (
        rawCard.printing !== null &&
        rawCard.printing !== undefined
      ) {
        const printing = text(
          rawCard.printing
        );

        if (!printing) {
          invalid = true;
          reviewQueue.push({
            scope: "card",
            setId,
            cardId: providerCardId,
            reason: "Empty printing evidence",
          });
          continue;
        }

        // Provider-declared printing only.
        // Never infer a missing pattern.
        card.printingPattern = printing;
      }

      // Intentionally omit imageUrl.
      // Image candidates are not rights clearance.
      cards.push(card);
    }

    if (
      invalid ||
      cards.length !== rawSet.cards.length
    ) {
      reviewQueue.push({
        scope: "set",
        setId,
        reason:
          "Incomplete card validation; set withheld",
      });
      continue;
    }

    for (const cardId of localIds) {
      seenProviderCards.add(cardId);
    }

    const set: CatalogSet = {
      id: `tcgapi-set-${setId}`,
      name: setName,
      cards,
    };

    if (date) {
      set.releaseDate = date;
    }

    const current =
      groups.get(setLanguage) ?? [];

    current.push(set);
    groups.set(setLanguage, current);
  }

  for (const id of evidenceBySet.keys()) {
    if (!seenSets.has(id)) {
      reviewQueue.push({
        scope: "report",
        setId: id,
        reason:
          "Language evidence references an absent set",
      });
    }
  }

  // Fail closed for the entire batch.
  // Do not emit partial importable manifests.
  if (reviewQueue.length > 0) {
    groups.clear();
  }

  const manifests: CatalogManifest[] = [];

  for (const [lang, sets] of groups) {
    if (!sets.length) continue;

    const candidate: CatalogManifest = {
      source: SOURCE,
      category: "Pokemon",
      language: lang,
      sets,
    };

    const validated =
      validateCatalogManifest(candidate);

    const normalized =
      normalizeCatalogManifest(validated);

    if (
      normalized.sets.length !== sets.length ||
      normalized.cards.length !==
        sets.reduce(
          (count, set) =>
            count + set.cards.length,
          0
        ) ||
      normalized.cards.some(
        (card) => card.image_url !== ""
      )
    ) {
      fail(
        "Normalized manifest failed integrity checks"
      );
    }

    manifests.push(candidate);
  }

  const importableSets =
    manifests.reduce(
      (count, manifest) =>
        count + manifest.sets.length,
      0
    );

  const importableCards =
    manifests.reduce(
      (count, manifest) =>
        count +
        manifest.sets.reduce(
          (total, set) =>
            total + set.cards.length,
          0
        ),
      0
    );

  return {
    manifests,
    reviewQueue,
    summary: {
      discoverySha256: discoveryDigest,
      discoveredSets:
        discovery.acceptedSets.length,
      importableSets,
      importableCards,
      withheldSets:
        discovery.acceptedSets.length -
        importableSets,
      reviewItems: reviewQueue.length,
      imageUrlsPublished: 0,
      noDatabaseCalls: true,
      noCatalogWrites: true,
      noApprovals: true,
      languageProvenanceBound: false,
    },
  };
}

async function saveResult(
  result: BuildResult,
  outputRoot: string
): Promise<string> {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const dir = path.join(
    outputRoot,
    `tcgapi-f6-${stamp}-${result.summary.discoverySha256.slice(0, 12)}`
  );

  await mkdir(dir, {
    recursive: true,
  });

  const files: Record<string, unknown> = {
    "summary.json": result.summary,
    "review-queue.json": result.reviewQueue,
  };

  for (const manifest of result.manifests) {
    files[
      `catalog-manifest-${manifest.language}.json`
    ] = manifest;
  }

  for (const [name, data] of Object.entries(files)) {
    await writeFile(
      path.join(dir, name),
      JSON.stringify(data, null, 2) + "\n",
      { flag: "wx" }
    );
  }

  return dir;
}

async function selfTest(): Promise<void> {
  const discovery = {
    provider: "tcgapi",
    listingComplete: true,
    reviewQueue: [],
    acceptedSets: [
      {
        providerSetId: "42",
        name: "Fixture Set",
        game: "pokemon",
        releaseDate: "2026-11-06",
        complete: true,
        cards: [
          {
            providerId: "101",
            name: "Example",
            collectorNumber: "001/002",
            printing: "Holofoil",
            imageCandidate:
              "https://product-images.tcgplayer.com/fit-in/400x400/123.jpg",
            identityApproved: false,
            artworkApproved: false,
            rightsCleared: false,
          },
          {
            providerId: "102",
            name: "Example",
            collectorNumber: "001/002",
            printing: "Reverse Holofoil",
            imageCandidate: null,
            identityApproved: false,
            artworkApproved: false,
            rightsCleared: false,
          },
        ],
      },
    ],
  };

  const languages = {
    version: 1,
    provider: "tcgapi",
    listingComplete: true,
    reviewQueue: [],
    verifiedLanguages: [
      {
        providerSetId: "42",
        setName: "Fixture Set",
        language: "JP",
        sourceUrl:
          "https://example.org/fixture",
        reviewedBy: "offline-test",
        reviewedAt:
          "2026-11-15T12:00:00Z",
        status: "EVIDENCE_REVIEWED",
      },
    ],
  };

  const digest = sha256(
    JSON.stringify(discovery)
  );

  const result = buildImportManifests(
    discovery,
    languages,
    digest
  );

  if (
    result.manifests.length !== 1 ||
    result.manifests[0].language !== "JP" ||
    result.summary.importableCards !== 2 ||
    result.summary.imageUrlsPublished !== 0
  ) {
    fail("Manifest generation fixture failed");
  }

  const cards =
    result.manifests[0].sets[0].cards;

  if (
    cards[0].id === cards[1].id ||
    cards[0].collectorNumber !==
      cards[1].collectorNumber ||
    cards.some((card) => !!card.imageUrl)
  ) {
    fail(
      "Printing identity or image safeguard failed"
    );
  }

  const duplicate = structuredClone(
    discovery
  );

  duplicate.acceptedSets[0].cards[1].providerId =
    "101";

  if (
    buildImportManifests(
      duplicate,
      languages,
      digest
    ).manifests.length !== 0
  ) {
    fail("Duplicate identity was not blocked");
  }

  const missing = structuredClone(
    languages
  );

  missing.verifiedLanguages = [];

  if (
    buildImportManifests(
      discovery,
      missing,
      digest
    ).manifests.length !== 0
  ) {
    fail("Missing language was not blocked");
  }

  const upstream = structuredClone(
    discovery
  );

  upstream.reviewQueue.push({
    reason: "Unresolved provider issue",
  } as never);

  let upstreamBlocked = false;

  try {
    buildImportManifests(
      upstream,
      languages,
      digest
    );
  } catch {
    upstreamBlocked = true;
  }

  if (!upstreamBlocked) {
    fail("Upstream review was not blocked");
  }

  const dir = await mkdtemp(
    path.join(tmpdir(), "mintradar-f6-")
  );

  try {
    const output = await saveResult(
      result,
      dir
    );

    const saved = JSON.parse(
      await readFile(
        path.join(
          output,
          "catalog-manifest-JP.json"
        ),
        "utf8"
      )
    ) as unknown;

    const validated =
      validateCatalogManifest(saved);

    if (
      validated.language !== "JP" ||
      validated.sets[0].cards.length !== 2
    ) {
      fail("Saved manifest validation failed");
    }
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
    });
  }

  console.log(
    "PASS: importable manifest generation, " +
      "JP language preservation, distinct printings, " +
      "image withholding, duplicate rejection, " +
      "missing-language quarantine, upstream review gate"
  );

  console.log(
    "Zero live API calls. Zero Supabase calls. " +
      "Zero catalog writes."
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (
    args.length === 1 &&
    args[0] === "--self-test"
  ) {
    await selfTest();
    return;
  }

  if (
    args.length !== 3 ||
    args.some(
      (arg) =>
        !arg.startsWith("--discovery=") &&
        !arg.startsWith("--languages=") &&
        !arg.startsWith("--sha256=")
    )
  ) {
    fail(
      "Usage: --self-test | " +
      "--discovery=FILE --languages=FILE --sha256=HASH"
    );
  }

  function option(name: string): string {
    const prefix = `--${name}=`;

    const match = args.find(
      (arg) => arg.startsWith(prefix)
    );

    return match?.slice(prefix.length) ||
      fail(`Missing ${name}`);
  }

  const discoveryBytes = await readFile(
    path.resolve(option("discovery"))
  );

  const actualDigest = sha256(
    discoveryBytes
  );

  const expectedDigest =
    option("sha256").toLowerCase();

  if (actualDigest !== expectedDigest) {
    fail(
      "Discovery file SHA-256 mismatch"
    );
  }

  const discovery = JSON.parse(
    discoveryBytes.toString("utf8")
  ) as unknown;

  const languages = JSON.parse(
    await readFile(
      path.resolve(option("languages")),
      "utf8"
    )
  ) as unknown;

  const result = buildImportManifests(
    discovery,
    languages,
    actualDigest
  );

  const output = await saveResult(
    result,
    path.resolve(
      ".cache/catalog-discovery-audit"
    )
  );

  console.log(
    "MintRadar #5F-F6 — READ-ONLY IMPORT MANIFESTS"
  );

  console.log(
    JSON.stringify(
      {
        ...result.summary,
        manifestCount:
          result.manifests.length,
        output,
      },
      null,
      2
    )
  );

  console.log(
    "Manifests are for importer --dry-run only. " +
    "Language review is not cryptographically bound " +
    "to the original discovery report."
  );
}

void main().catch((error: unknown) => {
  console.error(
    "Manifest build failed:",
    error instanceof Error
      ? error.message
      : String(error)
  );

  process.exitCode = 1;
});
