
/**
 * MintRadar #5F-F5 — Language evidence verifier
 *
 * Read-only. No Supabase, provider requests, or catalog writes.
 *
 * Language evidence must be explicitly reviewed against
 * an authoritative source. This module validates that
 * evidence; it does not independently authenticate a URL
 * or infer a language from a name.
 *
 * Self-test:
 * npx tsx scripts/catalog/discovery/verify-language.ts --self-test
 *
 * Usage:
 * npx tsx scripts/catalog/discovery/verify-language.ts \
 *   --report=PATH_TO_F3_REPORT.json \
 *   --evidence=PATH_TO_LANGUAGE_EVIDENCE.json
 */

import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export type CatalogLanguage =
  | "EN"
  | "JP"
  | "CN"
  | "CN-TW";

export type LanguageEvidence = {
  providerSetId: string;
  setName: string;
  language: CatalogLanguage;
  sourceUrl: string;
  reviewedBy: string;
  reviewedAt: string;
};

export type VerifiedLanguage = {
  providerSetId: string;
  setName: string;
  language: CatalogLanguage;
  sourceUrl: string;
  reviewedBy: string;
  reviewedAt: string;
  status: "EVIDENCE_REVIEWED";
};

export type LanguageReview = {
  providerSetId: string | null;
  reason: string;
};

export type LanguageVerificationReport = {
  version: 1;
  provider: "tcgapi";
  listingComplete: true;
  verifiedLanguages: VerifiedLanguage[];
  reviewQueue: LanguageReview[];
  summary: {
    discoveredSets: number;
    verifiedSets: number;
    withheldSets: number;
    noInferredLanguages: true;
    noDatabaseCalls: true;
    noCatalogWrites: true;
  };
};

type RecordValue = Record<string, unknown>;

function object(
  value: unknown
): value is RecordValue {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function nonempty(
  value: unknown
): string | null {
  return typeof value === "string" &&
    value.trim().length > 0
    ? value.trim()
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

function validSourceUrl(
  value: unknown
): string | null {
  const raw = nonempty(value);

  if (!raw) return null;

  try {
    const url = new URL(raw);

    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function validTimestamp(
  value: unknown
): string | null {
  const raw = nonempty(value);

  if (
    !raw ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(
      raw
    )
  ) {
    return null;
  }

  const time = Date.parse(raw);

  return Number.isFinite(time)
    ? raw
    : null;
}

function fail(message: string): never {
  throw new Error(message);
}

export function verifyLanguages(
  discovery: unknown,
  evidenceInput: unknown
): LanguageVerificationReport {
  if (
    !object(discovery) ||
    discovery.provider !== "tcgapi" ||
    discovery.listingComplete !== true ||
    !Array.isArray(discovery.acceptedSets) ||
    !Array.isArray(discovery.reviewQueue)
  ) {
    fail(
      "Incomplete or malformed TCG API discovery report"
    );
  }

  if (
    !object(evidenceInput) ||
    !Array.isArray(evidenceInput.sets)
  ) {
    fail(
      "Language evidence must contain a sets array"
    );
  }

  const evidenceById = new Map<
    string,
    unknown[]
  >();

  for (const entry of evidenceInput.sets) {
    const key = object(entry)
      ? nonempty(entry.providerSetId)
      : null;

    if (!key) {
      fail(
        "Language evidence contains an entry without a provider set ID"
      );
    }

    const matches = evidenceById.get(key) ?? [];

    matches.push(entry);
    evidenceById.set(key, matches);
  }

  const verifiedLanguages: VerifiedLanguage[] = [];
  const reviewQueue: LanguageReview[] = [];
  const seenDiscovered = new Set<string>();

  for (const rawSet of discovery.acceptedSets) {
    if (!object(rawSet)) {
      reviewQueue.push({
        providerSetId: null,
        reason: "Malformed discovered set",
      });
      continue;
    }

    const providerSetId = nonempty(
      rawSet.providerSetId
    );

    const setName = nonempty(rawSet.name);

    if (!providerSetId || !setName) {
      reviewQueue.push({
        providerSetId,
        reason: "Missing discovered set identity",
      });
      continue;
    }

    if (seenDiscovered.has(providerSetId)) {
      reviewQueue.push({
        providerSetId,
        reason: "Duplicate discovered set ID",
      });
      continue;
    }

    seenDiscovered.add(providerSetId);

    if (
      rawSet.complete !== true ||
      !Array.isArray(rawSet.cards) ||
      rawSet.cards.length === 0
    ) {
      reviewQueue.push({
        providerSetId,
        reason: "Set is not complete",
      });
      continue;
    }

    const matches =
      evidenceById.get(providerSetId) ?? [];

    if (matches.length !== 1) {
      reviewQueue.push({
        providerSetId,
        reason:
          matches.length === 0
            ? "No reviewed language evidence"
            : "Conflicting or duplicate language evidence",
      });
      continue;
    }

    const entry = matches[0];

    if (!object(entry)) {
      reviewQueue.push({
        providerSetId,
        reason: "Malformed language evidence",
      });
      continue;
    }

    const evidenceName = nonempty(
      entry.setName
    );

    const evidenceLanguage = language(
      entry.language
    );

    const sourceUrl = validSourceUrl(
      entry.sourceUrl
    );

    const reviewedBy = nonempty(
      entry.reviewedBy
    );

    const reviewedAt = validTimestamp(
      entry.reviewedAt
    );

    if (
      evidenceName !== setName ||
      !evidenceLanguage ||
      !sourceUrl ||
      !reviewedBy ||
      !reviewedAt
    ) {
      reviewQueue.push({
        providerSetId,
        reason:
          "Evidence identity, language, source, or review metadata invalid",
      });
      continue;
    }

    verifiedLanguages.push({
      providerSetId,
      setName,
      language: evidenceLanguage,
      sourceUrl,
      reviewedBy,
      reviewedAt,
      status: "EVIDENCE_REVIEWED",
    });
  }

  // Evidence for sets absent from this discovery run
  // cannot silently be accepted.
  for (const providerSetId of evidenceById.keys()) {
    if (!seenDiscovered.has(providerSetId)) {
      reviewQueue.push({
        providerSetId,
        reason:
          "Language evidence references an undiscovered set",
      });
    }
  }

  // Preserve visibility into upstream discovery issues.
  for (const item of discovery.reviewQueue) {
    reviewQueue.push({
      providerSetId:
        object(item)
          ? nonempty(item.providerSetId)
          : null,
      reason:
        "Upstream discovery review: " +
        (object(item)
          ? nonempty(item.reason) ??
            "Unspecified issue"
          : "Malformed review item"),
    });
  }

  return {
    version: 1,
    provider: "tcgapi",
    listingComplete: true,
    verifiedLanguages,
    reviewQueue,
    summary: {
      discoveredSets:
        discovery.acceptedSets.length,
      verifiedSets:
        verifiedLanguages.length,
      withheldSets:
        discovery.acceptedSets.length -
        verifiedLanguages.length,
      noInferredLanguages: true,
      noDatabaseCalls: true,
      noCatalogWrites: true,
    },
  };
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
        complete: true,
        cards: [
          {
            providerId: "101",
            name: "Example",
            collectorNumber: "001/002",
          },
        ],
      },
    ],
  };

  const evidence = {
    sets: [
      {
        providerSetId: "42",
        setName: "Fixture Set",
        language: "JP",
        sourceUrl:
          "https://example.org/fixture-language",
        reviewedBy: "offline-test",
        reviewedAt:
          "2026-11-15T12:00:00Z",
      },
    ],
  };

  const good = verifyLanguages(
    discovery,
    evidence
  );

  if (
    good.verifiedLanguages.length !== 1 ||
    good.verifiedLanguages[0].language !==
      "JP" ||
    good.summary.withheldSets !== 0
  ) {
    fail("Reviewed JP evidence fixture failed");
  }

  const missing = verifyLanguages(
    discovery,
    { sets: [] }
  );

  if (
    missing.verifiedLanguages.length !== 0 ||
    missing.summary.withheldSets !== 1
  ) {
    fail("Missing evidence was not withheld");
  }

  const wrongName = structuredClone(evidence);

  wrongName.sets[0].setName =
    "Different Set";

  if (
    verifyLanguages(
      discovery,
      wrongName
    ).verifiedLanguages.length !== 0
  ) {
    fail("Mismatched set name was accepted");
  }

  const duplicates = {
    sets: [
      evidence.sets[0],
      evidence.sets[0],
    ],
  };

  if (
    verifyLanguages(
      discovery,
      duplicates
    ).verifiedLanguages.length !== 0
  ) {
    fail("Duplicate evidence was accepted");
  }

  const invalidLanguage =
    structuredClone(evidence);

  invalidLanguage.sets[0].language =
    "UNKNOWN";

  if (
    verifyLanguages(
      discovery,
      invalidLanguage
    ).verifiedLanguages.length !== 0
  ) {
    fail("Unknown language was accepted");
  }

  const incomplete = {
    ...discovery,
    listingComplete: false,
  };

  let blocked = false;

  try {
    verifyLanguages(
      incomplete,
      evidence
    );
  } catch {
    blocked = true;
  }

  if (!blocked) {
    fail("Incomplete listing was accepted");
  }

  console.log(
    "PASS: explicit JP evidence, missing evidence quarantine, " +
      "set identity mismatch, duplicate rejection, " +
      "unknown language rejection, incomplete listing rejection"
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
    args.length !== 2 ||
    args.some(
      (arg) =>
        !arg.startsWith("--report=") &&
        !arg.startsWith("--evidence=")
    )
  ) {
    fail(
      "Usage: verify-language.ts --self-test | " +
        "--report=FILE --evidence=FILE"
    );
  }

  const reportArg = args.find(
    (arg) => arg.startsWith("--report=")
  );

  const evidenceArg = args.find(
    (arg) => arg.startsWith("--evidence=")
  );

  if (!reportArg || !evidenceArg) {
    fail(
      "Both report and evidence paths are required"
    );
  }

  const reportPath = reportArg.slice(
    "--report=".length
  );

  const evidencePath = evidenceArg.slice(
    "--evidence=".length
  );

  if (!reportPath || !evidencePath) {
    fail("Empty input path");
  }

  const discovery = JSON.parse(
    await readFile(
      path.resolve(reportPath),
      "utf8"
    )
  ) as unknown;

  const evidence = JSON.parse(
    await readFile(
      path.resolve(evidencePath),
      "utf8"
    )
  ) as unknown;

  const result = verifyLanguages(
    discovery,
    evidence
  );

  const outputRoot = path.resolve(
    ".cache/catalog-discovery-audit"
  );

  await mkdir(outputRoot, {
    recursive: true,
  });

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const digest = createHash("sha256")
    .update(JSON.stringify(result))
    .digest("hex")
    .slice(0, 12);

  const outputPath = path.join(
    outputRoot,
    `language-f5-${stamp}-${digest}.json`
  );

  await writeFile(
    outputPath,
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" }
  );

  console.log(
    "MintRadar #5F-F5 — LANGUAGE EVIDENCE REVIEW"
  );

  console.log(
    JSON.stringify(
      {
        ...result.summary,
        reviewItems:
          result.reviewQueue.length,
        output: outputPath,
      },
      null,
      2
    )
  );

  console.log(
    "Evidence reviewed is not independent provider " +
      "authentication. No catalog manifest or writes."
  );
}

void main().catch((error: unknown) => {
  console.error(
    "Language verification failed:",
    error instanceof Error
      ? error.message
      : String(error)
  );

  process.exitCode = 1;
});
