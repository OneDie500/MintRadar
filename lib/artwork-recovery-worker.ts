import { createClient } from "@supabase/supabase-js";

export const JOB_TABLE = "catalog_artwork_recovery_jobs";
const COOLDOWN_TABLE = "catalog_artwork_provider_cooldowns";
const RESOLVER_TIMEOUT_MS = 20_000;

export function recoveryDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing server-side Supabase configuration");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export type RecoveryDb = ReturnType<typeof recoveryDb>;
export type RecoveryJob = {
  id: string; category: string; language: string; data_source: string;
  external_id: string; set_id: string | null; card_number: string | null;
  card_name: string | null; attempts: number;
};
export type RecoveryResult = { external_id: string; status: string; error?: string };

const errorText = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
const isoAfter = (ms: number) => new Date(Date.now() + ms).toISOString();
const retryDelay = (attempts: number) => Math.min(7 * 86_400_000, 15 * 60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 9));

export function recoveryOrigin(configured: string): string {
  if (!configured) throw new Error("Configure ARTWORK_RECOVERY_ORIGIN (or NEXT_PUBLIC_APP_URL) before running recovery");
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("Artwork recovery origin must be HTTPS (except localhost)");
  }
  return url.origin;
}

export async function cooldownUntil(db: RecoveryDb): Promise<string | null> {
  const { data, error } = await db.from(COOLDOWN_TABLE)
    .select("blocked_until").eq("provider", "tcgapi").maybeSingle();
  if (error) throw error;
  return data?.blocked_until && Date.parse(data.blocked_until) > Date.now() ? data.blocked_until : null;
}

function nextUtcMidnight(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 10)).toISOString();
}

async function setRateLimitCooldown(db: RecoveryDb): Promise<string> {
  const blockedUntil = nextUtcMidnight();
  const { error } = await db.from(COOLDOWN_TABLE).upsert({
    provider: "tcgapi", blocked_until: blockedUntil, updated_at: new Date().toISOString(),
  }, { onConflict: "provider" });
  if (error) throw error;
  return blockedUntil;
}

async function saveJob(db: RecoveryDb, job: RecoveryJob, patch: Record<string, unknown>) {
  const { data, error } = await db.from(JOB_TABLE)
    .update({ ...patch, locked_at: null, updated_at: new Date().toISOString() })
    .eq("id", job.id).eq("status", "processing").select("id");
  if (error) throw error;
  if (!data?.length) throw new Error(`Recovery job ${job.id} was no longer processing`);
}

function exactMatch(job: RecoveryJob, payload: Record<string, unknown>): boolean {
  const match = payload.match;
  if (!match || typeof match !== "object" || Array.isArray(match)) return false;
  const m = match as Record<string, unknown>;
  const name = typeof m.name === "string" ? m.name.normalize("NFKC").trim() : "";
  const setIdValue = typeof m.setId === "string" ? m.setId :
    typeof m.set_id === "string" ? m.set_id : "";
  const setId = setIdValue.trim().toLowerCase();
  const number = typeof m.cardNumber === "string" ? m.cardNumber.trim() :
    typeof m.card_number === "string" ? m.card_number.trim() :
    typeof m.printedNumber === "string" ? m.printedNumber.trim() :
    typeof m.number === "string" ? m.number.trim() : "";
  // A provider result must prove all three identity fields; do not infer rights.
  return Boolean(name && setId && number &&
    name === (job.card_name ?? "").normalize("NFKC").trim() &&
    setId === (job.set_id ?? "").trim().toLowerCase() &&
    number === (job.card_number ?? "").trim());
}

export async function processRecoveryJob(db: RecoveryDb, job: RecoveryJob, origin: string): Promise<RecoveryResult> {
  try {
    const { data: card, error: cardError } = await db.from("cards")
      .select("image_url").eq("data_source", job.data_source)
      .eq("category", job.category).eq("language", job.language)
      .eq("external_id", job.external_id).maybeSingle();
    if (cardError) throw cardError;
    if (!card) {
      await saveJob(db, job, { status: "failed", next_attempt_at: null, last_error: "Catalog card no longer exists" });
      return { external_id: job.external_id, status: "failed", error: "Catalog card no longer exists" };
    }
    if (typeof card.image_url === "string" && card.image_url.trim()) {
      await saveJob(db, job, { status: "unresolved", next_attempt_at: null, last_error: "Skipped: catalog already has artwork" });
      return { external_id: job.external_id, status: "skipped-existing-image" };
    }
    if (!["tcgdex", "tcgapi_verified"].includes(job.data_source) || job.category !== "Pokemon" ||
        !["JP", "EN"].includes(job.language) || !job.set_id || !job.card_number || !job.card_name) {
      await saveJob(db, job, { status: "failed", next_attempt_at: null, last_error: "Unsupported or incomplete exact card identity" });
      return { external_id: job.external_id, status: "failed", error: "Unsupported or incomplete exact card identity" };
    }
    // A confirmed account-wide rate limit stops calls before touching another provider request.
    const blocked = await cooldownUntil(db);
    if (blocked) {
      await saveJob(db, job, { status: "pending", next_attempt_at: blocked, last_error: "Provider cooldown active" });
      return { external_id: job.external_id, status: "provider-cooldown" };
    }
    const params = new URLSearchParams({ name: job.card_name, setId: job.set_id,
      cardNumber: job.card_number, language: job.language });
    const response = await fetch(`${origin}/api/catalog/pokemon-image-fallback?${params}`, {
      cache: "no-store", signal: AbortSignal.timeout(RESOLVER_TIMEOUT_MS),
    });
    if (response.status === 429) {
      const blockedUntil = await setRateLimitCooldown(db);
      await saveJob(db, job, { status: "pending", next_attempt_at: blockedUntil, last_error: "Resolver rate limited (429)" });
      return { external_id: job.external_id, status: "rate-limited" };
    }
    // The resolver can wrap an upstream 429 in HTTP 502; inspect JSON first.
    const payload: unknown = await response.json().catch(() => null);
    const result = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown> : {};
    const reason = String(result.reason ?? result.error ?? "");
    const upstreamStatus = Number(result.upstreamStatus ?? result.status ?? 0);
    const upstreamError = String(result.error ?? "");
    if (upstreamStatus === 429 || /RATE_LIMIT_EXCEEDED|daily rate limit exceeded|rate limit exceeded|too many requests/i.test(`${reason} ${upstreamError}`)) {
      const blockedUntil = await setRateLimitCooldown(db);
      await saveJob(db, job, { status: "pending", next_attempt_at: blockedUntil, last_error: "Upstream provider rate limited" });
      return { external_id: job.external_id, status: "rate-limited" };
    }
    if (!response.ok) throw new Error(`Resolver HTTP ${response.status}: ${reason.slice(0, 120)}`);
    const raw = result.ok === true && typeof result.imageUrl === "string" ? result.imageUrl.trim() : "";
    let imageUrl: string | null = null;
    if (raw) {
      const url = new URL(raw);
      if (url.protocol !== "https:" || !url.hostname) throw new Error("Resolver returned invalid HTTPS image URL");
      imageUrl = url.toString();
    }
    const candidateOnly = result.testingOnly === true || result.requiresManualReview === true;
    const verified = Boolean(imageUrl && !candidateOnly && exactMatch(job, result));
    // A discovered URL without proven identity is retained for diagnostics, not resolved/published.
    const status = verified ? "resolved" : "unresolved";
    const now = new Date().toISOString();
    await saveJob(db, job, {
      status,
      discovered_image_url: imageUrl,
      discovered_source: typeof result.provider === "string" ? result.provider.slice(0, 150) : null,
      identity_verified: verified,
      rights_cleared: false,
      diagnostics: { provider: result.provider ?? null, reason: result.reason ?? null,
        match: result.match ?? null, candidate_only: candidateOnly,
        identity_rule: verified ? "exact-name-set-number" : "not-proven", recovered_at: now },
      last_error: verified ? null : (imageUrl ? "Artwork candidate discovered; exact identity not proven" : (reason || "No artwork currently available")).slice(0, 500),
      next_attempt_at: imageUrl ? null : isoAfter(24 * 60 * 60_000),
    });
    return { external_id: job.external_id, status: verified ? "resolved-identity-verified" : imageUrl ? "candidate-review" : "unresolved-recheck-scheduled" };
  } catch (error) {
    const message = errorText(error);
    try {
      await saveJob(db, job, { status: "pending", next_attempt_at: isoAfter(retryDelay(job.attempts)), last_error: message });
    } catch (saveError) { console.error("Recovery status update failed", saveError); }
    return { external_id: job.external_id, status: "retry-scheduled", error: message };
  }
}

export async function runRecoveryBatch(db: RecoveryDb, limit: number, origin: string) {
  const blocked = await cooldownUntil(db);
  if (blocked) return { claimed: 0, cooldownUntil: blocked, results: [] as RecoveryResult[] };
  const { data, error } = await db.rpc("claim_catalog_artwork_recovery_jobs", { p_limit: limit });
  if (error) throw error;
  const jobs = (data ?? []) as RecoveryJob[];
  const results: RecoveryResult[] = [];
  for (const job of jobs) {
    const result = await processRecoveryJob(db, job, origin);
    results.push(result);
    if (["rate-limited", "provider-cooldown"].includes(result.status)) {
      // Claimed-but-not-run jobs must be released; they were already counted as attempts by the RPC.
      const blockedUntil = await cooldownUntil(db);
      for (const remaining of jobs.slice(results.length)) {
        const { error: releaseError } = await db.from(JOB_TABLE).update({
          status: "pending", locked_at: null,
          next_attempt_at: blockedUntil ?? isoAfter(24 * 60 * 60_000),
          updated_at: new Date().toISOString(),
        }).eq("id", remaining.id).eq("status", "processing");
        if (releaseError) throw releaseError;
      }
      break;
    }
  }
  return { claimed: jobs.length, cooldownUntil: await cooldownUntil(db), results };
}
