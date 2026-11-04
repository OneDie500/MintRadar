
import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { CatalogCardRow } from "./normalize";
import type { ExistingCard } from "./reconcile";

export type PreservationReport = {
  existingRecords: number;
  newRecords: number;
  protectedImages: number;
  protectedCanonicalIds: number;
  protectedCanonicalNames: number;
  protectedCanonicalConfidence: number;
  canonicalDisagreements: number;
  imageAuditPath: string;
  canonicalAuditPath: string;
};

type AuditRecord = {
  external_id: string;
  data_source: string;
  language: string;
  category: string;
  set_name: string;
  card_number: string;
  existing_value: string;
  incoming_value: string;
  reason: string;
};

function identityKey(
  source: string,
  language: string,
  externalId: string
): string {
  return JSON.stringify([source, language, externalId]);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function exportAudit(
  path: string,
  records: AuditRecord[]
): void {
  const fields: (keyof AuditRecord)[] = [
    "external_id",
    "data_source",
    "language",
    "category",
    "set_name",
    "card_number",
    "existing_value",
    "incoming_value",
    "reason",
  ];

  const output = [
    fields.join(","),
    ...records.map((record) =>
      fields.map((field) => csvCell(record[field])).join(",")
    ),
  ].join("\n") + "\n";

  writeFileSync(path, output, "utf8");
}

export function preserveExistingCatalogCards(
  rows: CatalogCardRow[],
  existingCards: ExistingCard[],
  auditDirectory: string
): PreservationReport {
  mkdirSync(auditDirectory, { recursive: true });

  const existingByIdentity = new Map<string, ExistingCard>();

  for (const existing of existingCards) {
    const key = identityKey(
      existing.data_source,
      existing.language,
      existing.external_id
    );

    existingByIdentity.set(key, existing);
  }

  const counts = {
    existingRecords: 0,
    newRecords: 0,
    protectedImages: 0,
    protectedCanonicalIds: 0,
    protectedCanonicalNames: 0,
    protectedCanonicalConfidence: 0,
    canonicalDisagreements: 0,
  };

  const imageAudit: AuditRecord[] = [];
  const canonicalAudit: AuditRecord[] = [];

  for (const row of rows) {
    const key = identityKey(
      row.data_source,
      row.language,
      row.external_id
    );

    const old = existingByIdentity.get(key);

    if (!old) {
      counts.newRecords++;
      continue;
    }

    counts.existingRecords++;

    const auditBase = {
      external_id: row.external_id,
      data_source: row.data_source,
      language: row.language,
      category: row.category,
      set_name: row.set_name,
      card_number: row.card_number,
    };

    // Preserve established artwork.
    if (
      typeof old.image_url === "string" &&
      old.image_url.trim()
    ) {
      if (row.image_url !== old.image_url) {
        counts.protectedImages++;

        imageAudit.push({
          ...auditBase,
          existing_value: old.image_url,
          incoming_value: row.image_url ?? "",
          reason: "existing-image-preserved",
        });
      }

      row.image_url = old.image_url;
    }

    const oldId = old.canonical_external_id?.trim() ?? "";
    const incomingId = row.canonical_external_id?.trim() ?? "";

    const oldConfidence =
      typeof old.canonical_confidence === "number"
        ? old.canonical_confidence
        : null;

    const incomingConfidence = row.canonical_confidence;

    // Conflicting IDs require review. Confidence alone must
    // never determine which different identity is correct.
    if (oldId && incomingId && oldId !== incomingId) {
      counts.canonicalDisagreements++;

      canonicalAudit.push({
        ...auditBase,
        existing_value: oldId,
        incoming_value: incomingId,
        reason: "canonical-id-disagreement",
      });
    } else if (oldId && !incomingId) {
      canonicalAudit.push({
        ...auditBase,
        existing_value: oldId,
        incoming_value: "",
        reason: "incoming-canonical-id-missing",
      });
    }

    // Preserve established identity and its confidence together.
    if (
      oldId &&
      (
        !incomingId ||
        oldId !== incomingId ||
        (oldConfidence ?? -1) > (incomingConfidence ?? -1)
      )
    ) {
      if (row.canonical_external_id !== oldId) {
        counts.protectedCanonicalIds++;
      }

      row.canonical_external_id = oldId;
      row.canonical_language = old.canonical_language;
      row.canonical_confidence = oldConfidence;

      counts.protectedCanonicalConfidence++;

      if (
        typeof old.canonical_name === "string" &&
        old.canonical_name.trim()
      ) {
        if (row.canonical_name !== old.canonical_name) {
          counts.protectedCanonicalNames++;
        }

        row.canonical_name = old.canonical_name;
      }

      continue;
    }

    // Preserve an established search name when incoming data
    // does not provide one.
    if (
      !row.canonical_name?.trim() &&
      typeof old.canonical_name === "string" &&
      old.canonical_name.trim()
    ) {
      row.canonical_name = old.canonical_name;
      counts.protectedCanonicalNames++;
    }
  }

  const imageAuditPath = join(
    auditDirectory,
    "protected-images.csv"
  );

  const canonicalAuditPath = join(
    auditDirectory,
    "canonical-review.csv"
  );

  exportAudit(imageAuditPath, imageAudit);
  exportAudit(canonicalAuditPath, canonicalAudit);

  return {
    ...counts,
    imageAuditPath,
    canonicalAuditPath,
  };
}
