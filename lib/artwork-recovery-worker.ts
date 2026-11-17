
import { createClient } from "@supabase/supabase-js";

export const JOB_TABLE = "catalog_artwork_recovery_jobs";

const COOLDOWN_TABLE = "catalog_artwork_provider_cooldowns";
const RESOLVER_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 5;

export function recoveryDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing server-side Supabase configuration");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type RecoveryDb = ReturnType<typeof recoveryDb>;

export type RecoveryJob = {
  id: string;
  category: string;
  language: string;
  data_source: string;
  external_id: string;
  set_id: string | null;
  card_number: string | null;
  card_name: string | null;
  attempts: number;
  locked_at: string | null;
};

export type RecoveryResult = {
  external_id: string;
  status: string;
  error?: string;
};

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message.slice(0, 500)
    : "Unknown error";

const isoAfter = (ms: number) =>
  new Date(Date.now() + ms).toISOString();

const retryDelay = (attempts: number) =>
  Math.min(
    7 * 86_400_000,
    15 * 60_000 *
      2 ** Math.min(Math.max(attempts - 1, 0), 9)
  );

export function recoveryOrigin(configured: string): string {
  if (!configured) {
    throw new Error(
      "Configure ARTWORK_RECOVERY_ORIGIN before running recovery"
    );
  }

  const url = new URL(configured);

  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);

  if (url.protocol !== "https:" && !local) {
    throw new Error(
      "Artwork recovery origin must use HTTPS except localhost"
    );
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Invalid artwork recovery origin");
  }

  return url.origin;
}

export async function cooldownUntil(
  db: RecoveryDb
): Promise<string | null> {
  const { data, error } = await db
    .from(COOLDOWN_TABLE)
    .select("blocked_until")
    .eq("provider", "tcgapi")
    .maybeSingle();

  if (error) throw error;

  return data?.blocked_until &&
    Date.parse(data.blocked_until) > Date.now()
    ? data.blocked_until
    : null;
}

function nextUtcMidnight(): string {
  const now = new Date();

  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      10
    )
  ).toISOString();
}

async function setRateLimitCooldown(
  db: RecoveryDb
): Promise<string> {
  const blockedUntil = nextUtcMidnight();

  const { error } = await db
    .from(COOLDOWN_TABLE)
    .upsert(
      {
        provider: "tcgapi",
        blocked_until: blockedUntil,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider" }
    );

  if (error) throw error;

  return blockedUntil;
}

async function saveJob(
  db: RecoveryDb,
  job: RecoveryJob,
  patch: Record<string, unknown>
) {
  if (!job.locked_at) {
    throw new Error(
      `Recovery job ${job.id} has no claim timestamp`
    );
  }

  const { data, error } = await db
    .from(JOB_TABLE)
    .update({
      ...patch,
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "processing")
    .eq("locked_at", job.locked_at)
    .eq("attempts", job.attempts)
    .select("id");

  if (error) throw error;

  if (!data?.length) {
    throw new Error(
      `Recovery job ${job.id} is no longer owned by this worker`
    );
  }
}

// Name equivalence is allowed only for the English TCGdex regional exact-ID
// provider. Other providers and JP/vintage retain literal name matching.
function exactRegionalName(name: string): string {
  const normalized = name.normalize("NFKC").trim();
  if (normalized === "Nidoran F" || normalized === "Nidoran♀") return "Nidoran♀";
  if (normalized === "Nidoran M" || normalized === "Nidoran♂") return "Nidoran♂";
  // A specific spelling equivalence, not general accent removal.
  return normalized.replace(/Pokémon/g, "Pokemon");
}

// Catalog aliases are scoped to a complete printed identity, never to a
// generic letter expansion. These do not confer image usage rights.
const REGIONAL_EXACT_ID_ALIASES: Record<string, { catalog: string; provider: string }> = {
  "me06:132/103": { catalog: "Bubbly W Energy", provider: "Bubbly Water Energy" },
  "me06:133/103": { catalog: "Growing G Energy", provider: "Growing Grass Energy" },
  "me06:134/103": { catalog: "Nitro R Energy", provider: "Nitro Fire Energy" },
};

function regionalNamesMatch(job: RecoveryJob, providerName: string, catalogName: string): boolean {
  if (exactRegionalName(providerName) === exactRegionalName(catalogName)) return true;
  const key = `${(job.set_id ?? "").trim().toLowerCase()}:${(job.card_number ?? "").trim()}`;
  const alias = REGIONAL_EXACT_ID_ALIASES[key];
  return Boolean(alias && catalogName === alias.catalog && providerName === alias.provider);
}

function verifiedIdentityRule(job: RecoveryJob, payload: Record<string, unknown>): string {
  const match = payload.match;
  if (!match || typeof match !== "object" || Array.isArray(match)) return "exact-name-set-number";
  const m = match as Record<string, unknown>;
  if (exactMe06LegendaryPiece(job, payload, m)) return "me06-legendary-piece-exact-id";
  if (payload.provider !== "tcgdex-regional-exact-id" || typeof m.name !== "string") {
    return "exact-name-set-number";
  }
  const providerName = m.name.normalize("NFKC").trim();
  const catalogName = (job.card_name ?? "").normalize("NFKC").trim();
  if (providerName === catalogName) return "regional-exact-id-name";
  if (exactRegionalName(providerName) === exactRegionalName(catalogName)) {
    return "regional-exact-id-normalized-name";
  }
  return "regional-exact-id-approved-alias";
}

// Only the six English ME06 two-piece printings have this catalog naming
// convention. Each side is tied to its own exact provider card ID.
const ME06_LEGENDARY_PIECES: Record<string, { name: string; side: "Left" | "Right" }> = {
  "094": { name: "Legendary Pyroduct", side: "Left" },
  "095": { name: "Legendary Pyroduct", side: "Right" },
  "096": { name: "Legendary Summit", side: "Left" },
  "097": { name: "Legendary Summit", side: "Right" },
  "098": { name: "Legendary Trench", side: "Left" },
  "099": { name: "Legendary Trench", side: "Right" },
};

function exactMe06LegendaryPiece(
  job: RecoveryJob,
  payload: Record<string, unknown>,
  match: Record<string, unknown>
): boolean {
  if (job.language !== "EN" || job.set_id?.toLowerCase() !== "me06" ||
      !["tcgdex-regional-exact-id", "tcgdex-regional-exact-set"].includes(String(payload.provider))) {
    return false;
  }
  const printed = /^(\d{3})\/103$/.exec((job.card_number || "").trim());
  if (!printed) return false;
  const piece = ME06_LEGENDARY_PIECES[printed[1]];
  if (!piece || job.external_id.toLowerCase() !== `me06-${printed[1]}/103`) return false;
  if (job.card_name?.normalize("NFKC").trim() !==
      `${piece.name} - ${printed[1]}/103 (${piece.side})`) return false;
  if (match.name !== piece.name ||
      String(match.id || "").toLowerCase() !== `me06-${printed[1]}` ||
      String(match.cardNumber || "") !== printed[1]) return false;
  const identity = payload.parsedIdentity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return false;
  const parsed = identity as Record<string, unknown>;
  return parsed.originalName === job.card_name &&
    String(parsed.language || "").toUpperCase() === "EN" &&
    String(parsed.suppliedSetId || "").toLowerCase() === "me06" &&
    String(parsed.resolvedSetId || "").toLowerCase() === "me06";
}

function exactMatch(
  job: RecoveryJob,
  payload: Record<string, unknown>
): boolean {
  const match = payload.match;

  if (!match || typeof match !== "object" || Array.isArray(match)) {
    return false;
  }

  const m = match as Record<string, unknown>;
  const name =
    typeof m.name === "string" ? m.name.normalize("NFKC").trim() : "";
  const wantedName = (job.card_name ?? "").normalize("NFKC").trim();
  const wantedSet = (job.set_id ?? "").trim().toLowerCase();
  const wantedNumber = (job.card_number ?? "").trim();

  const setIdValue =
    typeof m.setId === "string" ? m.setId :
    typeof m.set_id === "string" ? m.set_id : "";
  const setId = setIdValue.trim().toLowerCase();
  const number =
    typeof m.cardNumber === "string" ? m.cardNumber.trim() :
    typeof m.card_number === "string" ? m.card_number.trim() :
    typeof m.printedNumber === "string" ? m.printedNumber.trim() :
    typeof m.number === "string" ? m.number.trim() : "";

  if (!name || !wantedName || !wantedSet || !wantedNumber || !number) {
    return false;
  }

  const regionalExactId = job.language === "EN" &&
    payload.provider === "tcgdex-regional-exact-id";
  // This is a separate, explicitly enumerated identity rule, not a
  // generalized suffix-stripping or approximate name comparison.
  if (exactMe06LegendaryPiece(job, payload, m)) return true;

  const namesMatch = regionalExactId
    ? regionalNamesMatch(job, name, wantedName)
    : name === wantedName;
  if (!namesMatch) return false;

  // Preserve the original strict verification for all existing providers.
  if (!regionalExactId && setId === wantedSet && number === wantedNumber &&
      name === wantedName) {
    return true;
  }

  // TCGdex's exact regional card endpoint uses local IDs ("001") even when
  // the marketplace catalog stores a printed number ("001/103"). The
  // regional resolver reports its verified set in parsedIdentity rather than
  // match.setId. Accept this representation ONLY for the exact-ID provider,
  // after checking the resolver's independent card ID, set, and name evidence.
  // This does not grant image rights or change JP/vintage matching rules.
  if (job.language !== "EN" ||
      payload.provider !== "tcgdex-regional-exact-id") {
    return false;
  }

  const parsed = payload.parsedIdentity;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const identity = parsed as Record<string, unknown>;
  const suppliedSet = typeof identity.suppliedSetId === "string"
    ? identity.suppliedSetId.trim().toLowerCase() : "";
  const resolvedSet = typeof identity.resolvedSetId === "string"
    ? identity.resolvedSetId.trim().toLowerCase() : "";
  const originalName = typeof identity.originalName === "string"
    ? identity.originalName.normalize("NFKC").trim() : "";
  const resolvedLanguage = typeof identity.language === "string"
    ? identity.language.trim().toUpperCase() : "";
  const providerCardId = typeof m.id === "string"
    ? m.id.trim().toLowerCase() : "";

  // Only compare a short local ID with the numerator of a complete printed
  // number. Never accept loose partial matches, different sets, or a variant.
  const printed = /^(\d+)\/(\d+)$/.exec(wantedNumber);
  if (!printed || !/^\d+$/.test(number)) {
    return false;
  }
  const sameLocalNumber = Number(printed[1]) === Number(number);
  const exactProviderId = providerCardId === `${wantedSet}-${number.toLowerCase()}`;

  return Boolean(
    suppliedSet === wantedSet &&
    resolvedSet === wantedSet &&
    originalName === wantedName &&
    resolvedLanguage === "EN" &&
    sameLocalNumber &&
    exactProviderId
  );
}

// Reuse existing Japanese vintage research before making an external provider
// request. Staging is a candidate source, not evidence of image usage rights.
// The JP guard is essential: some Neo IDs also exist as EN catalog records.
async function stagedVintageCandidate(db: RecoveryDb, job: RecoveryJob) {
  if (job.category !== "Pokemon" || job.language !== "JP" || !job.set_id) {
    return null;
  }

  const { data, error } = await db
    .from("vintage_artwork_staging")
    .select("catalog_id,set_id,card_name,image_url,visual_approved,identity_approved,rights_cleared,source")
    .ilike("catalog_id", job.external_id.trim())
    .ilike("set_id", job.set_id.trim())
    .limit(2);

  if (error) throw error;
  // Ambiguous matches must not be silently selected.
  if (!data?.length) return null;
  if (data.length !== 1) {
    throw new Error("Ambiguous vintage staging identity: multiple rows match");
  }

  const staged = data[0];
  if (
    String(staged.catalog_id ?? "").normalize("NFKC").trim().toLowerCase() !==
      job.external_id.normalize("NFKC").trim().toLowerCase() ||
    String(staged.set_id ?? "").normalize("NFKC").trim().toLowerCase() !==
      job.set_id.normalize("NFKC").trim().toLowerCase()
  ) return null;

  const raw = typeof staged.image_url === "string" ? staged.image_url.trim() : "";
  if (!raw || staged.visual_approved !== true) return null;

  const url = new URL(raw);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("Vintage staging returned invalid HTTPS artwork URL");
  }

  return {
    url: url.toString(),
    identityApproved: staged.identity_approved === true,
    // Read only for diagnostics. Never propagate this flag to the recovery job.
    stagingRightsCleared: staged.rights_cleared === true,
    source: typeof staged.source === "string" ? staged.source : null,
    stagedName: typeof staged.card_name === "string" ? staged.card_name : null,
  };
}

export async function processRecoveryJob(
  db: RecoveryDb,
  job: RecoveryJob,
  origin: string
): Promise<RecoveryResult> {
  const fail = async (message: string): Promise<RecoveryResult> => {
    await saveJob(db, job, {
      status: "failed",
      next_attempt_at: null,
      last_error: message,
    });

    return {
      external_id: job.external_id,
      status: "failed",
      error: message,
    };
  };

  try {
    if (job.attempts > MAX_ATTEMPTS) {
      return await fail("Maximum recovery attempts exceeded");
    }

    const { data: card, error: cardError } = await db
      .from("cards")
      .select("image_url,set_name,set_id,name")
      .eq("data_source", job.data_source)
      .eq("category", job.category)
      .eq("language", job.language)
      .eq("external_id", job.external_id)
      .maybeSingle();

    if (cardError) throw cardError;

    if (!card) {
      return await fail("Catalog card no longer exists");
    }

    // Use the catalog's existing expansion identity. Never invent a set name
    // from a set code or silently substitute a similarly named expansion.
    const catalogSetName =
      typeof card.set_name === "string" ? card.set_name.trim() : "";
    const catalogSetId =
      typeof card.set_id === "string" ? card.set_id.trim() : "";
    if (catalogSetId && catalogSetId.toLowerCase() !== (job.set_id ?? "").trim().toLowerCase()) {
      return await fail("Recovery job set ID no longer matches catalog");
    }

    if (
      typeof card.image_url === "string" &&
      card.image_url.trim()
    ) {
      await saveJob(db, job, {
        status: "unresolved",
        next_attempt_at: null,
        last_error: "Skipped: catalog already has artwork",
      });

      return {
        external_id: job.external_id,
        status: "skipped-existing-image",
      };
    }

    if (
      !["tcgdex", "tcgapi_verified"].includes(job.data_source) ||
      job.category !== "Pokemon" ||
      !["JP", "EN"].includes(job.language) ||
      !job.set_id ||
      !job.card_number ||
      !job.card_name
    ) {
      return await fail(
        "Unsupported or incomplete exact card identity"
      );
    }

    // Reuse existing identity-approved vintage artwork immediately. A visually
    // approved candidate without identity approval is retained as evidence,
    // while independent resolver verification continues below.
    const vintage = await stagedVintageCandidate(db, job);
    if (vintage?.identityApproved) {
      await saveJob(db, job, {
        status: "resolved",
        discovered_image_url: vintage.url,
        discovered_source: "vintage_artwork_staging",
        identity_verified: true,
        rights_cleared: false,
        next_attempt_at: null,
        last_error: null,
        diagnostics: {
          provider: "vintage_artwork_staging",
          catalog_set_name: catalogSetName || null,
          staging_source: vintage.source,
          staging_card_name: vintage.stagedName,
          staging_identity_approved: true,
          staging_rights_cleared: vintage.stagingRightsCleared,
          candidate_only: false,
          identity_rule: "preexisting-vintage-staging-identity-approval",
          recovered_at: new Date().toISOString(),
        },
      });
      return {
        external_id: job.external_id,
        status: "resolved-existing-vintage-identity",
      };
    }

    // Preserve the original staged URL in diagnostics. A provider may verify
    // the card identity using a DIFFERENT image URL: that never verifies the
    // staged image itself or confers image usage rights.
    const stagingEvidence = vintage ? {
      staging_candidate_url: vintage.url,
      staging_source: vintage.source,
      staging_card_name: vintage.stagedName,
      staging_identity_approved: false,
      staging_rights_cleared: vintage.stagingRightsCleared,
    } : {};

    const blocked = await cooldownUntil(db);

    if (blocked) {
      await saveJob(db, job, {
        status: "pending",
        next_attempt_at: blocked,
        last_error: "Provider cooldown active",
      });

      return {
        external_id: job.external_id,
        status: "provider-cooldown",
      };
    }

    const params = new URLSearchParams({
      name: job.card_name,
      setId: job.set_id,
      ...(catalogSetName ? { setName: catalogSetName } : {}),
      cardNumber: job.card_number,
      language: job.language,
    });

    const response = await fetch(
      `${origin}/api/catalog/pokemon-image-fallback?${params}`,
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(RESOLVER_TIMEOUT_MS),
      }
    );

    if (response.status === 429) {
      const blockedUntil = await setRateLimitCooldown(db);

      await saveJob(db, job, {
        status: "pending",
        next_attempt_at: blockedUntil,
        last_error: "Resolver rate limited (429)",
      });

      return {
        external_id: job.external_id,
        status: "rate-limited",
      };
    }

    const payload: unknown = await response
      .json()
      .catch(() => null);

    const result =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};

    const reason = String(
      result.reason ?? result.error ?? ""
    );

    const upstreamStatus = Number(
      result.upstreamStatus ?? result.status ?? 0
    );

    const upstreamError = String(result.error ?? "");

    if (
      upstreamStatus === 429 ||
      /RATE_LIMIT_EXCEEDED|daily rate limit exceeded|rate limit exceeded|too many requests/i.test(
        `${reason} ${upstreamError}`
      )
    ) {
      const blockedUntil = await setRateLimitCooldown(db);

      await saveJob(db, job, {
        status: "pending",
        next_attempt_at: blockedUntil,
        last_error: "Upstream provider rate limited",
      });

      return {
        external_id: job.external_id,
        status: "rate-limited",
      };
    }

    if (!response.ok) {
      throw new Error(
        `Resolver HTTP ${response.status}: ${reason.slice(0, 120)}`
      );
    }

    if (result.reason === "optional-pokemon-tcg-api-not-configured") {
      await saveJob(db, job, {
        status: "unresolved",
        next_attempt_at: null,
        last_error: vintage
          ? "Staged candidate exists; independent resolver not configured"
          : "Optional Pokémon TCG API fallback is not configured; requeue after configuration",
        ...(vintage ? {
          discovered_image_url: vintage.url,
          discovered_source: "vintage_artwork_staging",
          diagnostics: { ...stagingEvidence, provider: "vintage_artwork_staging", candidate_only: true, identity_rule: "not-proven" },
        } : {}),
        identity_verified: false,
        rights_cleared: false,
      });
      return { external_id: job.external_id, status: "fallback-configuration-needed" };
    }

    const raw =
      result.ok === true &&
      typeof result.imageUrl === "string"
        ? result.imageUrl.trim()
        : "";

    let imageUrl: string | null = null;

    if (raw) {
      const url = new URL(raw);

      if (
        url.protocol !== "https:" ||
        !url.hostname ||
        url.username ||
        url.password
      ) {
        throw new Error(
          "Resolver returned invalid HTTPS image URL"
        );
      }

      imageUrl = url.toString();
    }

    const candidateOnly =
      result.testingOnly === true ||
      result.requiresManualReview === true;

    const verified = Boolean(
      imageUrl &&
        !candidateOnly &&
        exactMatch(job, result)
    );

    const status = verified ? "resolved" : "unresolved";
    const now = new Date().toISOString();

    await saveJob(db, job, {
      status,
      discovered_image_url: imageUrl ?? vintage?.url ?? null,
      discovered_source: imageUrl
        ? (typeof result.provider === "string" ? result.provider.slice(0, 150) : null)
        : (vintage ? "vintage_artwork_staging" : null),
      identity_verified: verified,
      rights_cleared: false,
      diagnostics: {
        provider: result.provider ?? null,
        catalog_set_name: catalogSetName || null,
        ...stagingEvidence,
        resolver_image_url: imageUrl,
        staging_image_matches_resolver_url: vintage && imageUrl
          ? vintage.url === imageUrl
          : null,
        reason: result.reason ?? null,
        match: result.match ?? null,
        parsed_identity: result.parsedIdentity ?? null,
        candidate_only: candidateOnly,
        identity_rule: verified
          ? verifiedIdentityRule(job, result)
          : "not-proven",
        recovered_at: now,
      },
      last_error: verified
        ? null
        : (
            imageUrl
              ? "Artwork candidate discovered; exact identity not proven"
              : vintage
                ? "Staged artwork candidate retained; independent identity verification incomplete"
                : reason || "No artwork currently available"
          ).slice(0, 500),
      next_attempt_at: imageUrl || vintage
        ? null
        : job.attempts >= MAX_ATTEMPTS
          ? null
          : isoAfter(24 * 60 * 60_000),
    });

    return {
      external_id: job.external_id,
      status: verified
        ? "resolved-identity-verified"
        : imageUrl || vintage
          ? "candidate-review"
          : job.attempts >= MAX_ATTEMPTS
            ? "unresolved-max-attempts"
            : "unresolved-recheck-scheduled",
    };
  } catch (error) {
    const message = errorText(error);

    // A stale worker must not overwrite a newer claim.
    try {
      if (job.attempts >= MAX_ATTEMPTS) {
        await saveJob(db, job, {
          status: "failed",
          next_attempt_at: null,
          last_error: message,
        });

        return {
          external_id: job.external_id,
          status: "failed",
          error: message,
        };
      }

      await saveJob(db, job, {
        status: "pending",
        next_attempt_at: isoAfter(
          retryDelay(job.attempts)
        ),
        last_error: message,
      });

      return {
        external_id: job.external_id,
        status: "retry-scheduled",
        error: message,
      };
    } catch (saveError) {
      console.error(
        "Recovery status update failed",
        saveError
      );

      return {
        external_id: job.external_id,
        status: "status-update-failed",
        error: message,
      };
    }
  }
}

export async function runRecoveryBatch(
  db: RecoveryDb,
  limit: number,
  origin: string,
  setId?: string
) {
  const scopedSetId = setId?.trim();
  // Fail closed for all callers, including older cron routes.
  if (!scopedSetId || !/^[\w-]{1,80}$/.test(scopedSetId)) {
    throw new Error("Recovery batch requires a valid explicit set ID");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3) {
    throw new Error("Recovery batch limit must be between 1 and 3");
  }

  const blocked = await cooldownUntil(db);

  if (blocked) {
    return {
      claimed: 0,
      cooldownUntil: blocked,
      results: [] as RecoveryResult[],
    };
  }

  const { data, error } = await db.rpc(
    "claim_catalog_artwork_recovery_jobs",
    { p_limit: limit, p_set_id: scopedSetId }
  );

  if (error) throw error;

  const jobs = (data ?? []) as RecoveryJob[];
  const results: RecoveryResult[] = [];

  for (const job of jobs) {
    const result = await processRecoveryJob(
      db,
      job,
      origin
    );

    results.push(result);

    if (
      ["rate-limited", "provider-cooldown"].includes(
        result.status
      )
    ) {
      const blockedUntil = await cooldownUntil(db);

      for (const remaining of jobs.slice(results.length)) {
        if (!remaining.locked_at) {
          throw new Error(
            `Claimed job ${remaining.id} has no lock timestamp`
          );
        }

        const { error: releaseError } = await db
          .from(JOB_TABLE)
          .update({
            status: "pending",
            locked_at: null,
            next_attempt_at:
              blockedUntil ??
              isoAfter(24 * 60 * 60_000),
            updated_at: new Date().toISOString(),
          })
          .eq("id", remaining.id)
          .eq("status", "processing")
          .eq("locked_at", remaining.locked_at)
          .eq("attempts", remaining.attempts);

        if (releaseError) throw releaseError;
      }

      break;
    }
  }

  return {
    claimed: jobs.length,
    cooldownUntil: await cooldownUntil(db),
    results,
  };
}

// Universal recovery uses a separate, explicitly scoped claim RPC. Keep the
// existing runRecoveryBatch() unchanged for the established MC pilot/cron.
export async function runScopedRecoveryBatch(
  db: RecoveryDb,
  origin: string,
  scope: {
    setId: string;
    language: "EN" | "JP";
    dataSource: "tcgdex" | "tcgapi_verified";
  }
) {
  const setId = scope.setId?.trim();
  if (!setId || !/^[\w-]{1,80}$/.test(setId)) {
    throw new Error("Scoped recovery requires a valid explicit set ID");
  }
  if (setId.toUpperCase() === "MC") {
    throw new Error("MC remains reserved for the existing recovery pilot");
  }
  if (!["EN", "JP"].includes(scope.language)) {
    throw new Error("Unsupported scoped recovery language");
  }
  if (!["tcgdex", "tcgapi_verified"].includes(scope.dataSource)) {
    throw new Error("Unsupported scoped recovery data source");
  }

  const blocked = await cooldownUntil(db);
  if (blocked) {
    return {
      claimed: 0,
      cooldownUntil: blocked,
      results: [] as RecoveryResult[],
    };
  }

  // One claim only: there can be no unprocessed claimed jobs to release.
  const { data, error } = await db.rpc(
    "claim_catalog_artwork_recovery_jobs_scoped",
    {
      p_limit: 1,
      p_set_id: setId,
      p_language: scope.language,
      p_data_source: scope.dataSource,
      p_category: "Pokemon",
    }
  );
  if (error) throw error;

  const jobs = (data ?? []) as RecoveryJob[];
  if (jobs.length > 1) {
    throw new Error("Scoped claim unexpectedly returned multiple jobs");
  }
  const job = jobs[0];
  if (!job) {
    return {
      claimed: 0,
      cooldownUntil: await cooldownUntil(db),
      results: [] as RecoveryResult[],
    };
  }

  // Defense in depth: the database function must honor every scope field.
  // If this check fails, do not call the resolver on the unexpected job.
  if (
    job.set_id?.trim().toLowerCase() !== setId.toLowerCase() ||
    job.language !== scope.language ||
    job.data_source !== scope.dataSource ||
    job.category !== "Pokemon"
  ) {
    throw new Error("Scoped claim returned a job outside the requested scope");
  }

  const result = await processRecoveryJob(db, job, origin);
  return {
    claimed: 1,
    cooldownUntil: await cooldownUntil(db),
    results: [result],
  };
}
