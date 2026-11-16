/**
 * MintRadar #5F-C: offline writer safety regression.
 * Place at scripts/catalog/test-write-gate-5F-C.ts and run:
 *   npx tsx scripts/catalog/test-write-gate-5F-C.ts
 * This test never reads .env.local or contacts Supabase.
 */
import { writeCatalog } from "./write";
import type { ReconciliationResult } from "./reconcile";
import type { SupabaseClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
  let dbAccesses = 0;
  const fakeSupabase = new Proxy({} as SupabaseClient, {
    get(_target, property) {
      dbAccesses += 1;
      throw new Error(`UNSAFE: attempted database access: ${String(property)}`);
    },
  });

  const base: ReconciliationResult = {
    sets: [], cards: [], existingCards: [], newCards: [],
    existingSets: [], newSets: [], crossProviderOverlaps: [],
    skippedSets: 0, quarantined: [],
  };

  // Deliberately include an incoming row: the test must block before an insert.
  const pendingCard = {
    external_id: "offline-test-29",
    data_source: "offline_test",
    language: "EN",
  } as ReconciliationResult["newCards"][number];

  const overlap = {
    incoming_external_id: "offline-test-29",
    incoming_source: "offline_test",
    existing_external_id: "base5-29",
    existing_source: "tcgdex",
    language: "EN",
    set_name: "Team Rocket",
    card_number: "29",
    incoming_name: "Dark Slowbro",
    existing_name: "Dark Slowbro",
    incoming_edition: "1st Edition",
    existing_edition: "1st Edition",
    incoming_finish: "Non-Holo",
    existing_finish: "Non-Holo",
    review_status: "POSSIBLE_SAME_PRINTING" as const,
    review_reason: "matching_declared_attributes_not_verified",
  };

  const withOverlap: ReconciliationResult = {
    ...base, newCards: [pendingCard], crossProviderOverlaps: [overlap],
  };

  const dryRun = await writeCatalog(fakeSupabase, withOverlap, false);
  if (dryRun.mode !== "dry-run" || dryRun.insertedCards !== 0 || dbAccesses !== 0) {
    throw new Error("FAIL: dry-run accessed database or reported inserts");
  }
  console.log("PASS: dry-run does not access database");

  let overlapBlocked = false;
  try {
    await writeCatalog(fakeSupabase, withOverlap, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    overlapBlocked = message.includes("cross-provider overlaps require review");
    if (!overlapBlocked) throw new Error(`FAIL: unexpected overlap error: ${message}`);
  }
  if (!overlapBlocked || dbAccesses !== 0) {
    throw new Error("FAIL: overlap write was not blocked before database access");
  }
  console.log("PASS: direct write blocked for unverified cross-provider overlap");

  const withQuarantine: ReconciliationResult = {
    ...base,
    newCards: [pendingCard],
    quarantined: [{ external_id: "offline-test-29", reason: "offline test" }],
  };
  let quarantineBlocked = false;
  try {
    await writeCatalog(fakeSupabase, withQuarantine, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    quarantineBlocked = message.includes("quarantined records");
    if (!quarantineBlocked) throw new Error(`FAIL: unexpected quarantine error: ${message}`);
  }
  if (!quarantineBlocked || dbAccesses !== 0) {
    throw new Error("FAIL: quarantine write was not blocked before database access");
  }
  console.log("PASS: direct write blocked for quarantined records");
  console.log("PASS: ZERO database calls across all tests");
  console.log("#5F-C offline writer gate verified");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
