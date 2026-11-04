
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

import { validateCatalogManifest } from "./validate";
import { normalizeCatalogManifest } from "./normalize";
import { reconcileCatalog } from "./reconcile";
import { preserveExistingCatalogCards } from "./preserve";
import { writeCatalog } from "./write";

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main() {
  const args = process.argv.slice(2);
  const writeEnabled = args.includes("--write");
  const manifestArgs = args.filter(
    (arg) => arg !== "--write" && arg !== "--dry-run"
  );

  if (manifestArgs.length !== 1) {
    throw new Error(
      "Usage: tsx scripts/catalog/import.ts <manifest.json> [--dry-run | --write]"
    );
  }

  if (args.includes("--write") && args.includes("--dry-run")) {
    throw new Error(
      "Cannot use --write and --dry-run together."
    );
  }

  const filePath = resolve(manifestArgs[0]);

  if (!existsSync(filePath)) {
    throw new Error(`Manifest not found: ${filePath}`);
  }

  loadEnvFile(resolve(".env.local"));

  const rawManifest = JSON.parse(
    readFileSync(filePath, "utf8")
  );

  const manifest = validateCatalogManifest(rawManifest);

  console.log("\nMintRadar Universal Catalog Importer");
  console.log(
    `MODE: ${writeEnabled ? "WRITE REQUESTED" : "READ-ONLY AUDIT"}`
  );
  console.log("------------------------------------");
  console.log(`Source: ${manifest.source}`);
  console.log(`Category: ${manifest.category}`);
  console.log(`Language: ${manifest.language}`);

  const normalized = normalizeCatalogManifest(manifest);

  console.log(`Manifest sets: ${normalized.sets.length}`);
  console.log(`Manifest cards: ${normalized.cards.length}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase credentials in .env.local"
    );
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log("\nReconciling existing catalog records...");

  const result = await reconcileCatalog(
    supabase,
    normalized.sets,
    normalized.cards
  );

  const auditDirectory = join(
    process.cwd(),
    ".cache",
    "catalog-import-audit"
  );

  mkdirSync(auditDirectory, { recursive: true });

  console.log("Applying existing-record preservation...");

  const preservation = preserveExistingCatalogCards(
    result.cards,
    result.existingCards,
    auditDirectory
  );

  const overlapPath = join(
    auditDirectory,
    "cross-provider-overlaps.csv"
  );

  const overlapFields = [
    "incoming_external_id",
    "incoming_source",
    "existing_external_id",
    "existing_source",
    "language",
    "set_name",
    "card_number",
  ] as const;

  const overlapCsv =
    [
      overlapFields.join(","),
      ...result.crossProviderOverlaps.map((record) =>
        overlapFields
          .map((field) => csvCell(record[field]))
          .join(",")
      ),
    ].join("\n") + "\n";

  writeFileSync(overlapPath, overlapCsv, "utf8");

  console.log("\n=== RECONCILIATION RESULTS ===");
  console.log(`Incoming sets: ${result.sets.length}`);
  console.log(`New sets: ${result.newSets.length}`);
  console.log(`Existing sets: ${result.existingSets.length}`);
  console.log(`Incoming cards: ${result.cards.length}`);
  console.log(`New cards: ${result.newCards.length}`);
  console.log(`Existing cards: ${result.existingCards.length}`);
  console.log(
    `Cross-provider overlap candidates: ${result.crossProviderOverlaps.length}`
  );

  console.log("\n=== PRESERVATION REPORT ===");
  console.log(JSON.stringify(preservation, null, 2));

  console.log("\n=== AUDIT FILES ===");
  console.log(`Protected images: ${preservation.imageAuditPath}`);
  console.log(`Canonical review: ${preservation.canonicalAuditPath}`);
  console.log(`Provider overlaps: ${overlapPath}`);

  if (!writeEnabled) {
    console.log("\n=== WRITE PROTECTION ===");
    console.log("Supabase writes BLOCKED.");
    console.log("No catalog records were inserted or updated.");
    console.log(
      "No artwork approvals or rights-clearance records were changed."
    );
    console.log("\n=== END UNIVERSAL CATALOG AUDIT ===\n");
    return;
  }

  // Conservative first-release policy:
  // do not write if the audit identifies unresolved records.
  if (result.quarantined.length > 0) {
    throw new Error(
      `Write blocked: ${result.quarantined.length} quarantined records.`
    );
  }

  if (result.crossProviderOverlaps.length > 0) {
    throw new Error(
      `Write blocked: ${result.crossProviderOverlaps.length} cross-provider overlaps require review.`
    );
  }

  console.log("\n=== INSERT-ONLY WRITE ===");
  console.log("Existing catalog records will not be updated.");

  const writeReport = await writeCatalog(
    supabase,
    result,
    true
  );

  console.log(JSON.stringify(writeReport, null, 2));

  if (writeReport.failedBatches > 0) {
    throw new Error(
      "Catalog insertion stopped after a database error. Review the write report."
    );
  }

  console.log("\n=== IMPORT COMPLETE ===");
  console.log(
    `Inserted ${writeReport.insertedSets} sets and ${writeReport.insertedCards} cards.`
  );
  console.log(
    "Existing records were not updated by this importer."
  );
  console.log(
    "Artwork approvals and rights-clearance records were not changed."
  );
  console.log("\n=== END UNIVERSAL CATALOG IMPORT ===\n");
}

main().catch((error) => {
  console.error("\nUniversal catalog import failed:", error);
  process.exitCode = 1;
});
