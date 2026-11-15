/**
 * MintRadar #5F-E2 — read-only discovery evidence bridge.
 * Place at scripts/catalog/prepare-discovery-manifest.ts
 * Usage:
 * npx tsx scripts/catalog/prepare-discovery-manifest.ts \
 *   .cache/pokemon-sync-audit/delta-reign-manifest.json \
 *   .cache/pokemon-sync-audit/delta-reign-tcgapi-audit-report.json
 *
 * No database/API calls. Never changes the input manifest or infers approvals.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

type Card = {
  id: string;
  name: string;
  imageUrl?: string;
  [key: string]: unknown;
};
type SetRecord = {
  id: string;
  name: string;
  cards: Card[];
  [key: string]: unknown;
};
type Manifest = {
  source: string;
  category?: string;
  language?: string;
  sets: SetRecord[];
  [key: string]: unknown;
};
type AuditRow = {
  number: string;
  name: string;
  status: string;
  providerIds: Array<string | number>;
  url?: string;
  image?: { status?: string; http?: number; mime?: string; checkedAt?: string };
  note?: string;
};
type Audit = { summary?: Record<string, unknown>; rows: AuditRow[] };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readJson(path: string): unknown {
  assert(existsSync(path), `File not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function safeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "product-images.tcgplayer.com" &&
      /^\/fit-in\/400x400\/\d+\.jpg$/.test(parsed.pathname) &&
      !parsed.search && !parsed.hash;
  } catch { return false; }
}
function main(): void {
  const args = process.argv.slice(2);
  assert(args.length === 2 && !args.some(a => a.startsWith("--")),
    "Usage: tsx scripts/catalog/prepare-discovery-manifest.ts <manifest.json> <audit-report.json>");
  const manifestPath = resolve(args[0]);
  const auditPath = resolve(args[1]);
  const manifestRaw = readFileSync(manifestPath, "utf8");
  const manifestValue = readJson(manifestPath);
  const auditValue = readJson(auditPath);
  assert(object(manifestValue), "Manifest must be an object");
  assert(typeof manifestValue.source === "string" && manifestValue.source.length > 0, "Manifest source missing");
  assert(Array.isArray(manifestValue.sets) && manifestValue.sets.length === 1,
    "#5F-E2 supports exactly one set per report; refusing to guess set associations");
  const manifest = manifestValue as Manifest;
  const set = manifest.sets[0];
  assert(object(set) && typeof set.id === "string" && typeof set.name === "string" && Array.isArray(set.cards), "Invalid set");
  assert(set.cards.length > 0, "Set has no cards");
  assert(object(auditValue) && Array.isArray(auditValue.rows), "Audit must have rows array");
  const audit = auditValue as Audit;
  const cards = new Map<string, Card>();
  for (const card of set.cards) {
    assert(object(card) && typeof card.id === "string" && card.id.trim() && typeof card.name === "string" && card.name.trim(), "Invalid manifest card");
    assert(!cards.has(card.id), `Duplicate manifest card number: ${card.id}`);
    cards.set(card.id, card);
  }
  const rows = new Map<string, AuditRow>();
  for (const row of audit.rows) {
    assert(object(row) && typeof row.number === "string" && typeof row.name === "string" && typeof row.status === "string" && Array.isArray(row.providerIds), "Invalid audit row");
    assert(!rows.has(row.number), `Duplicate audit number: ${row.number}`);
    const card = cards.get(row.number);
    assert(card, `Audit card not in manifest: ${row.number}`);
    assert(card.name === row.name, `Name mismatch for ${row.number}: manifest=${card.name}, audit=${row.name}`);
    assert(row.providerIds.every(id => (typeof id === "number" && Number.isSafeInteger(id) && id > 0) || (typeof id === "string" && id.length > 0)), `Invalid provider ID for ${row.number}`);
    rows.set(row.number, row);
  }
  assert(rows.size === cards.size, `Audit coverage mismatch: ${rows.size} rows for ${cards.size} cards`);
  if (audit.summary?.totalCards !== undefined) {
    assert(audit.summary.totalCards === cards.size, "Audit summary totalCards mismatch");
  }

  const evidence: Array<Record<string, unknown>> = [];
  const review: Array<Record<string, unknown>> = [];
  let reachable = 0;
  let differingUrls = 0;
  for (const card of set.cards) {
    const row = rows.get(card.id)!;
    const reachableCandidate = row.status === "unique-candidate" &&
      row.providerIds.length === 1 && typeof row.url === "string" && safeUrl(row.url) &&
      row.image?.status === "reachable-image" &&
      typeof row.image.http === "number" && row.image.http >= 200 && row.image.http < 300 &&
      typeof row.image.mime === "string" && row.image.mime.toLowerCase().startsWith("image/");
    const urlDiffers = reachableCandidate && typeof card.imageUrl === "string" && card.imageUrl !== row.url;
    if (urlDiffers) differingUrls++;
    if (reachableCandidate) reachable++;
    const reason = !reachableCandidate ? `Evidence incomplete: ${row.status}` :
      urlDiffers ? "Candidate URL differs from existing manifest image URL" : null;
    const entry = {
      setId: set.id, number: card.id, name: card.name,
      manifestSource: manifest.source,
      manifestImageUrl: card.imageUrl ?? null,
      candidateUrl: row.url ?? null,
      providerIds: row.providerIds,
      discoveryStatus: row.status,
      imageCheck: row.image ?? null,
      note: row.note ?? null,
      evidenceStatus: reachableCandidate ? "REACHABLE_CANDIDATE_ONLY" : "INCOMPLETE_EVIDENCE",
      visualIdentityApproved: false,
      rightsCleared: false,
      catalogWriteAuthorized: false,
    };
    evidence.push(entry);
    if (reason) review.push({ ...entry, reviewReason: reason });
  }
  // Run-isolated directory: never overwrite a prior audit. No random or time-dependent identity mapping.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `${set.id}-${stamp}-${hash(manifestRaw).slice(0, 8)}`;
  const outputDir = resolve(".cache", "catalog-discovery-audit", runId);
  assert(!existsSync(outputDir), `Output directory already exists: ${outputDir}`);
  mkdirSync(outputDir, { recursive: true });
  const manifestOut = join(outputDir, "catalog-manifest.json");
  const evidenceOut = join(outputDir, "discovery-evidence.json");
  const reviewOut = join(outputDir, "review-queue.json");
  const summaryOut = join(outputDir, "summary.json");
  // Preserve the original manifest *byte for byte*, including all identities and metadata.
  writeFileSync(manifestOut, manifestRaw, { flag: "wx" });
  writeFileSync(evidenceOut, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
  writeFileSync(reviewOut, JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
  const summary = {
    setId: set.id, setName: set.name, source: manifest.source,
    category: manifest.category ?? "Pokemon", language: manifest.language ?? "EN",
    totalCards: cards.size, auditRows: rows.size,
    reachableCandidates: reachable, incompleteOrNonreachable: cards.size - reachable,
    candidateUrlDisagreements: differingUrls, reviewQueueCount: review.length,
    inputManifest: basename(manifestPath), inputAudit: basename(auditPath),
    inputManifestSha256: hash(manifestRaw),
    inputAuditSha256: hash(readFileSync(auditPath, "utf8")),
    noDatabaseCalls: true, noCatalogWrites: true,
    note: "Reachability is not visual identity, printing verification, or rights clearance. Manifest unchanged."
  };
  writeFileSync(summaryOut, JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
  console.log("\nMintRadar #5F-E2 — READ-ONLY DISCOVERY BRIDGE");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nOutput directory: ${outputDir}`);
  console.log(`Manifest: ${manifestOut}`);
  console.log(`Evidence: ${evidenceOut}`);
  console.log(`Review queue: ${reviewOut}`);
  console.log(`Summary: ${summaryOut}`);
  console.log("No Supabase/API calls. No database writes.\n");
}
try { main(); } catch (error) {
  console.error("Discovery bridge failed:", error);
  process.exitCode = 1;
}
