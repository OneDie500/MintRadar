
/**
 * MintRadar #5F-F4
 * Read-only TCG API discovery -> catalog manifest preparation.
 *
 * No Supabase connections.
 * No catalog writes.
 * No automatic image approvals.
 * No automatic identity or rights approvals.
 *
 * Offline test:
 * npx tsx scripts/catalog/discovery/prepare-manifest.ts --self-test
 *
 * Prepare a discovery report:
 * npx tsx scripts/catalog/discovery/prepare-manifest.ts \
 *   --input=.cache/catalog-discovery-audit/tcgapi-f3-REPORT.json
 *
 * The output manifest can subsequently be examined with:
 * npx tsx scripts/catalog/import.ts OUTPUT/catalog-manifest.json --dry-run
 *
 * Never pass --write to the importer as part of this workflow.
 */

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  validateCatalogManifest,
  type CatalogManifest,
  type CatalogCard,
  type CatalogSet,
} from "../validate";

const SOURCE = "tcgapi_discovery";

type UnknownRecord = Record<string, unknown>;

type ReviewItem = {
  scope: "report" | "set" | "card";
  providerSetId?: string;
  providerCardId?: string;
  reason: string;
};

type EvidenceCard = {
  providerSetId: string;
  providerCardId: string;
  collectorNumber: string;
  name: string;
  printing: string | null;
  imageCandidate: string | null;
  identityApproved: false;
  artworkApproved: false;
  rightsCleared: false;
};

type Preparation = {
  manifest: CatalogManifest | null;
  evidence: EvidenceCard[];
  reviewQueue: ReviewItem[];
  summary: {
    source: string;
    inputSets: number;
    preparedSets: number;
    preparedCards: number;
    reviewItems: number;
    imagesWithheld: number;
    noDatabaseCalls: true;
    noCatalogWrites: true;
    noApprovals: true;
  };
};

function isRecord(
  value: unknown
): value is UnknownRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function positiveId(value: unknown): string | null {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return String(value);
  }

  const text = stringValue(value);

  return text && /^[a-zA-Z0-9_-]+$/.test(text)
    ? text
    : null;
}

function fail(message: string): never {
  throw new Error(message);
}

function safeDate(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const date = stringValue(value);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return undefined;
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : undefined;
}

function sourceId(
  kind: "set" | "card",
  providerId: string
): string {
  return `tcgapi-${kind}-${providerId}`;
}

function safeCandidate(value: unknown): string | null {
  const raw = stringValue(value);

  if (!raw) return null;

  try {
    const url = new URL(raw);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      ![
        "product-images.tcgplayer.com",
        "tcgplayer-cdn.tcgplayer.com",
      ].includes(url.hostname)
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

export function prepareDiscoveryManifest(
  input: unknown
): Preparation {
  if (!isRecord(input)) {
    fail("Discovery report must be an object");
  }

  if (input.provider !== "tcgapi") {
    fail("Unsupported discovery provider");
  }

  if (input.listingComplete !== true) {
    fail("Set listing is incomplete; refusing manifest");
  }

  if (!Array.isArray(input.acceptedSets)) {
    fail("Discovery report missing acceptedSets");
  }

  if (!Array.isArray(input.reviewQueue)) {
    fail("Discovery report missing reviewQueue");
  }

  const reviewQueue: ReviewItem[] = [];
  const evidence: EvidenceCard[] = [];
  const sets: CatalogSet[] = [];
  const seenSets = new Set<string>();

  // Preserve upstream review visibility.
  for (const item of input.reviewQueue) {
    if (!isRecord(item)) {
      reviewQueue.push({
        scope: "report",
        reason: "Malformed upstream review item",
      });
      continue;
    }

    reviewQueue.push({
      scope: "report",
      providerSetId:
        stringValue(item.providerSetId) ?? undefined,
      reason:
        stringValue(item.reason) ??
        "Unspecified upstream discovery review",
    });
  }

  for (const rawSet of input.acceptedSets) {
    if (!isRecord(rawSet)) {
      reviewQueue.push({
        scope: "set",
        reason: "Malformed discovered set",
      });
      continue;
    }

    const providerSetId = positiveId(
      rawSet.providerSetId
    );

    const name = stringValue(rawSet.name);
    const game = stringValue(rawSet.game);

    if (
      !providerSetId ||
      !name ||
      rawSet.complete !== true ||
      !Array.isArray(rawSet.cards) ||
      rawSet.cards.length === 0
    ) {
      reviewQueue.push({
        scope: "set",
        providerSetId: providerSetId ?? undefined,
        reason:
          "Set missing required identity, cards, or completeness proof",
      });
      continue;
    }

    // Current adapter only gives us a reliable Pokemon/EN
    // target when the game is explicitly identified.
    // Language is NOT provided by the adapter.
    // Therefore even Pokemon sets must be reviewed for
    // language before they can become importable.
    if (game?.toLowerCase() !== "pokemon") {
      reviewQueue.push({
        scope: "set",
        providerSetId,
        reason:
          "Game is missing or not explicitly Pokemon",
      });
      continue;
    }

    if (seenSets.has(providerSetId)) {
      reviewQueue.push({
        scope: "set",
        providerSetId,
        reason: "Duplicate provider set ID",
      });
      continue;
    }

    seenSets.add(providerSetId);

    const cards: CatalogCard[] = [];
    const pendingEvidence: EvidenceCard[] = [];
    const seenCards = new Set<string>();

    let invalid = false;

    for (const rawCard of rawSet.cards) {
      if (!isRecord(rawCard)) {
        invalid = true;
        reviewQueue.push({
          scope: "card",
          providerSetId,
          reason: "Malformed discovered card",
        });
        continue;
      }

      const providerCardId = positiveId(
        rawCard.providerId
      );

      const cardName = stringValue(rawCard.name);
      const collectorNumber = stringValue(
        rawCard.collectorNumber
      );

      const printing =
        rawCard.printing === null ||
        rawCard.printing === undefined
          ? null
          : stringValue(rawCard.printing);

      if (
        !providerCardId ||
        !cardName ||
        !collectorNumber ||
        seenCards.has(providerCardId) ||
        rawCard.identityApproved !== false ||
        rawCard.artworkApproved !== false ||
        rawCard.rightsCleared !== false
      ) {
        invalid = true;

        reviewQueue.push({
          scope: "card",
          providerSetId,
          providerCardId: providerCardId ?? undefined,
          reason:
            "Missing or duplicate identity, or unexpected approval state",
        });
        continue;
      }

      seenCards.add(providerCardId);

      const card: CatalogCard = {
        id: sourceId("card", providerCardId),
        name: cardName,
        collectorNumber,
      };

      // Preserve source-declared printing metadata.
      // A missing printing remains unknown.
      if (printing) {
        card.printingPattern = printing;
      }

      // Do NOT copy imageCandidate into imageUrl.
      // Provider discovery is not publication clearance.
      cards.push(card);

      pendingEvidence.push({
        providerSetId,
        providerCardId,
        collectorNumber,
        name: cardName,
        printing,
        imageCandidate: safeCandidate(
          rawCard.imageCandidate
        ),
        identityApproved: false,
        artworkApproved: false,
        rightsCleared: false,
      });
    }

    if (
      invalid ||
      cards.length !== rawSet.cards.length
    ) {
      reviewQueue.push({
        scope: "set",
        providerSetId,
        reason:
          "Incomplete or ambiguous card identity; entire set withheld",
      });
      continue;
    }

    const releaseDate = safeDate(rawSet.releaseDate);

    if (
      rawSet.releaseDate !== null &&
      rawSet.releaseDate !== undefined &&
      !releaseDate
    ) {
      reviewQueue.push({
        scope: "set",
        providerSetId,
        reason: "Invalid release date; set withheld",
      });
      continue;
    }

    const set: CatalogSet = {
      id: sourceId("set", providerSetId),
      name,
      cards,
    };

    if (releaseDate) {
      set.releaseDate = releaseDate;
    }

    sets.push(set);
    evidence.push(...pendingEvidence);
  }

  // The current adapter does not establish language.
  // Never silently default these cards to EN just because
  // the validator's default is EN.
  //
  // Generate a review-only result until a later discovery
  // stage verifies language from provider evidence.
  for (const set of sets) {
    reviewQueue.push({
      scope: "set",
      providerSetId: set.id,
      reason:
        "Language unverified: EN cannot be assumed from provider listing",
    });
  }

  const manifest: CatalogManifest | null = null;

  // Verify structural compatibility internally using a
  // temporary candidate, without releasing it for import.
  if (sets.length > 0) {
    validateCatalogManifest({
      source: SOURCE,
      category: "Pokemon",
      language: "EN",
      sets,
    });
  }

  return {
    manifest,
    evidence,
    reviewQueue,
    summary: {
      source: SOURCE,
      inputSets: input.acceptedSets.length,
      preparedSets: sets.length,
      preparedCards: sets.reduce(
        (sum, set) => sum + set.cards.length,
        0
      ),
      reviewItems: reviewQueue.length,
      imagesWithheld: evidence.filter(
        (card) => card.imageCandidate !== null
      ).length,
      noDatabaseCalls: true,
      noCatalogWrites: true,
      noApprovals: true,
    },
  };
}

async function savePreparation(
  result: Preparation,
  outputRoot: string
): Promise<string> {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const hash = createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex")
    .slice(0, 12);

  const dir = path.join(
    outputRoot,
    `tcgapi-f4-${stamp}-${hash}`
  );

  await mkdir(dir, { recursive: true });

  const files: Record<string, unknown> = {
    "discovery-evidence.json": result.evidence,
    "review-queue.json": result.reviewQueue,
    "summary.json": result.summary,
  };

  // An importable manifest is deliberately NOT written
  // while language remains unverified.
  if (result.manifest !== null) {
    files["catalog-manifest.json"] = result.manifest;
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
  const fixture = {
    provider: "tcgapi",
    listingComplete: true,
    discoveredSetCount: 1,
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

  const result = prepareDiscoveryManifest(fixture);

  if (
    result.manifest !== null ||
    result.summary.preparedSets !== 1 ||
    result.summary.preparedCards !== 2 ||
    result.evidence.length !== 2 ||
    result.summary.imagesWithheld !== 1 ||
    !result.reviewQueue.some((item) =>
      item.reason.includes("Language unverified")
    )
  ) {
    fail("Basic preparation fixture failed");
  }

  const conflicting = structuredClone(fixture);
  conflicting.acceptedSets[0].cards[1].providerId =
    "101";

  const rejected = prepareDiscoveryManifest(conflicting);

  if (
    rejected.summary.preparedSets !== 0 ||
    rejected.evidence.length !== 0
  ) {
    fail("Duplicate provider identity was not blocked");
  }

  const incomplete = structuredClone(fixture);
  incomplete.listingComplete = false;

  let blocked = false;

  try {
    prepareDiscoveryManifest(incomplete);
  } catch {
    blocked = true;
  }

  if (!blocked) {
    fail("Incomplete listing was not blocked");
  }

  const dir = await mkdtemp(
    path.join(tmpdir(), "mintradar-f4-")
  );

  try {
    const saved = await savePreparation(result, dir);

    const summary = JSON.parse(
      await readFile(
        path.join(saved, "summary.json"),
        "utf8"
      )
    ) as Preparation["summary"];

    if (
      summary.preparedCards !== 2 ||
      summary.noCatalogWrites !== true
    ) {
      fail("Saved summary fixture failed");
    }

    let manifestExists = false;

    try {
      await readFile(
        path.join(saved, "catalog-manifest.json")
      );
      manifestExists = true;
    } catch {
      // Expected: language has not been verified.
    }

    if (manifestExists) {
      fail("Unverified manifest was emitted");
    }
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
    });
  }

  console.log(
    "PASS: provider IDs, distinct printings, " +
      "image withholding, duplicate rejection, " +
      "incomplete listing rejection, language quarantine"
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
    args.length !== 1 ||
    !args[0].startsWith("--input=")
  ) {
    fail(
      "Usage: prepare-manifest.ts --self-test | " +
        "--input=PATH_TO_F3_REPORT.json"
    );
  }

  const inputPath = args[0].slice("--input=".length);

  if (!inputPath) {
    fail("Input report path is required");
  }

  const input = JSON.parse(
    await readFile(
      path.resolve(inputPath),
      "utf8"
    )
  ) as unknown;

  const result = prepareDiscoveryManifest(input);

  const output = await savePreparation(
    result,
    path.resolve(
      ".cache/catalog-discovery-audit"
    )
  );

  console.log(
    "MintRadar #5F-F4 — READ-ONLY MANIFEST PREPARATION"
  );

  console.log(
    JSON.stringify(
      {
        ...result.summary,
        importableManifestProduced:
          result.manifest !== null,
        output,
      },
      null,
      2
    )
  );

  console.log(
    "Language verification is required before " +
      "producing an importable manifest."
  );
}

void main().catch((error: unknown) => {
  console.error(
    "Preparation failed:",
    error instanceof Error
      ? error.message
      : String(error)
  );

  process.exitCode = 1;
});
