
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReconciliationResult } from "./reconcile";
import type { CatalogCardRow, CatalogSetRow } from "./normalize";

export type CatalogWriteReport = {
  mode: "dry-run" | "write";
  plannedSets: number;
  plannedCards: number;
  insertedSets: number;
  insertedCards: number;
  skippedExistingSets: number;
  skippedExistingCards: number;
  failedBatches: number;
  errors: string[];
};

const BATCH_SIZE = 100;

type CatalogIdentity = {
  external_id: string;
  data_source: string;
  language: string;
};

function identityKey(row: CatalogIdentity): string {
  return JSON.stringify([
    row.data_source,
    row.language,
    row.external_id,
  ]);
}

function validateUniqueIdentities(
  rows: CatalogIdentity[],
  table: string
): void {
  const seen = new Set<string>();

  for (const row of rows) {
    if (
      !row.external_id?.trim() ||
      !row.data_source?.trim() ||
      !row.language?.trim()
    ) {
      throw new Error(
        `Invalid identity in ${table}: ${JSON.stringify(row)}`
      );
    }

    const key = identityKey(row);

    if (seen.has(key)) {
      throw new Error(
        `Duplicate incoming ${table} identity: ${key}`
      );
    }

    seen.add(key);
  }
}

async function findExisting(
  supabase: SupabaseClient,
  table: "cards" | "catalog_sets",
  rows: CatalogIdentity[]
): Promise<Set<string>> {
  const existing = new Set<string>();

  if (rows.length === 0) {
    return existing;
  }

  const groups = new Map<string, CatalogIdentity[]>();

  for (const row of rows) {
    const groupKey = JSON.stringify([
      row.data_source,
      row.language,
    ]);

    const group = groups.get(groupKey) ?? [];
    group.push(row);
    groups.set(groupKey, group);
  }

  for (const group of groups.values()) {
    const first = group[0];

    for (let i = 0; i < group.length; i += BATCH_SIZE) {
      const batch = group.slice(i, i + BATCH_SIZE);

      const { data, error } = await supabase
        .from(table)
        .select("external_id,data_source,language")
        .eq("data_source", first.data_source)
        .eq("language", first.language)
        .in(
          "external_id",
          batch.map((row) => row.external_id)
        );

      if (error) {
        throw new Error(
          `Existing-record check failed for ${table}: ${error.message}`
        );
      }

      for (const row of (data ?? []) as CatalogIdentity[]) {
        existing.add(identityKey(row));
      }
    }
  }

  return existing;
}

async function insertBatches<T extends CatalogIdentity>(
  supabase: SupabaseClient,
  table: "cards" | "catalog_sets",
  rows: T[],
  report: CatalogWriteReport
): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const existing = await findExisting(
      supabase,
      table,
      batch
    );

    const pending = batch.filter(
      (row) => !existing.has(identityKey(row))
    );

    const skipped = batch.length - pending.length;

    if (table === "cards") {
      report.skippedExistingCards += skipped;
    } else {
      report.skippedExistingSets += skipped;
    }

    if (pending.length === 0) {
      continue;
    }

    // INSERT ONLY. Never update existing rows.
    const { error } = await supabase
      .from(table)
      .insert(pending);

    if (error) {
      report.failedBatches++;

      report.errors.push(
        `${table} batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`
      );

      break;
    }

    inserted += pending.length;
  }

  return inserted;
}

export async function writeCatalog(
  supabase: SupabaseClient,
  reconciliation: ReconciliationResult,
  writeEnabled = false
): Promise<CatalogWriteReport> {
  const report: CatalogWriteReport = {
    mode: writeEnabled ? "write" : "dry-run",
    plannedSets: reconciliation.newSets.length,
    plannedCards: reconciliation.newCards.length,
    insertedSets: 0,
    insertedCards: 0,
    skippedExistingSets: 0,
    skippedExistingCards: 0,
    failedBatches: 0,
    errors: [],
  };

  if (!writeEnabled) {
    return report;
  }

  if (reconciliation.quarantined.length > 0) {
    throw new Error(
      `Write blocked: ${reconciliation.quarantined.length} quarantined records`
    );
  }

  validateUniqueIdentities(
    reconciliation.newSets,
    "catalog_sets"
  );

  validateUniqueIdentities(
    reconciliation.newCards,
    "cards"
  );

  try {
    report.insertedSets = await insertBatches(
      supabase,
      "catalog_sets",
      reconciliation.newSets,
      report
    );

    if (report.failedBatches > 0) {
      return report;
    }

    report.insertedCards = await insertBatches(
      supabase,
      "cards",
      reconciliation.newCards,
      report
    );
  } catch (error) {
    report.failedBatches++;
    report.errors.push(
      error instanceof Error ? error.message : String(error)
    );
  }

  return report;
}
