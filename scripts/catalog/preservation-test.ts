
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

import type { CatalogCardRow } from "./normalize";
import type { ExistingCard } from "./reconcile";
import { preserveExistingCatalogCards } from "./preserve";

async function main() {
  loadEnvFile(resolve(".env.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase credentials in .env.local");
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log("\nMintRadar Preservation Test");
  console.log("MODE: READ-ONLY — NO DATABASE WRITES");

  // Retrieve the actual Snivy record.
  const { data, error } = await supabase
    .from("cards")
    .select(
      "external_id,data_source,language,category,set_name,card_number,image_url,canonical_name,canonical_external_id,canonical_language,canonical_confidence"
    )
    .eq("external_id", "2011bw-1")
    .eq("data_source", "tcgdex")
    .eq("language", "EN")
    .eq("category", "Pokemon")
    .single();

  if (error || !data) {
    throw new Error(
      `Could not retrieve Snivy test record: ${error?.message ?? "Record missing"}`
    );
  }

  const existing = data as unknown as ExistingCard;

  if (
    !existing.image_url ||
    !existing.canonical_name ||
    !existing.canonical_external_id ||
    existing.canonical_confidence === null
  ) {
    throw new Error(
      "Snivy record is missing required preservation test values."
    );
  }

  console.log("\nExisting record retrieved:");
  console.log(`External ID: ${existing.external_id}`);
  console.log(`Artwork: ${existing.image_url}`);
  console.log(`Canonical name: ${existing.canonical_name}`);
  console.log(`Canonical ID: ${existing.canonical_external_id}`);
  console.log(`Confidence: ${existing.canonical_confidence}`);

  // Deliberately construct conflicting incoming data.
  const incoming: CatalogCardRow = {
    external_id: existing.external_id,
    data_source: existing.data_source,
    language: "EN",
    name: "Snivy",
    set_name: existing.set_name ?? "McDonald's Collection 2011",
    set_id: "2011bw",
    card_number: existing.card_number ?? "1",
    image_url: "https://example.invalid/conflicting-image.webp",
    category: "Pokemon",
    rarity: null,
    edition: null,
    finish: null,
    canonical_name: "DELIBERATE TEST CONFLICT",
    canonical_external_id: "deliberately-wrong-canonical-id",
    canonical_language: "JP",
    canonical_confidence: 1,
    external_updated_at: new Date().toISOString(),
  };

  const auditDirectory = join(
    process.cwd(),
    ".cache",
    "catalog-import-audit",
    "preservation-test"
  );

  mkdirSync(auditDirectory, { recursive: true });

  console.log("\nApplying preservation rules...");

  const report = preserveExistingCatalogCards(
    [incoming],
    [existing],
    auditDirectory
  );

  const checks = [
    {
      name: "Existing artwork preserved",
      passed: incoming.image_url === existing.image_url,
    },
    {
      name: "Existing canonical ID preserved",
      passed:
        incoming.canonical_external_id ===
        existing.canonical_external_id,
    },
    {
      name: "Canonical language preserved",
      passed:
        incoming.canonical_language ===
        existing.canonical_language,
    },
    {
      name: "Canonical confidence preserved",
      passed:
        incoming.canonical_confidence ===
        existing.canonical_confidence,
    },
    {
      name: "Canonical name preserved",
      passed:
        incoming.canonical_name === existing.canonical_name,
    },
    {
      name: "Identity disagreement detected",
      passed: report.canonicalDisagreements === 1,
    },
    {
      name: "Artwork change detected",
      passed: report.protectedImages === 1,
    },
  ];

  console.log("\n=== PRESERVATION TEST RESULTS ===");

  for (const check of checks) {
    console.log(
      `${check.passed ? "PASS" : "FAIL"}: ${check.name}`
    );
  }

  console.log("\nPreservation report:");
  console.log(JSON.stringify(report, null, 2));

  console.log("\nFinal preserved values:");
  console.log(`Artwork: ${incoming.image_url}`);
  console.log(`Canonical name: ${incoming.canonical_name}`);
  console.log(`Canonical ID: ${incoming.canonical_external_id}`);
  console.log(`Confidence: ${incoming.canonical_confidence}`);

  const failures = checks.filter((check) => !check.passed);

  if (failures.length) {
    throw new Error(
      `${failures.length} preservation checks failed.`
    );
  }

  console.log("\nALL 7 PRESERVATION CHECKS PASSED.");
  console.log("Supabase database writes: ZERO.");
  console.log("=== END PRESERVATION TEST ===\n");
}

main().catch((error) => {
  console.error("\nPreservation test failed:", error);
  process.exitCode = 1;
});
