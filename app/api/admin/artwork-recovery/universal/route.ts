import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cooldownUntil, recoveryOrigin, runScopedRecoveryBatch } from "@/lib/artwork-recovery-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVED_BRANCH = "mobile-print-infrastructure";
const EXCLUDED_SET = "MC";
const MAX_CANDIDATES = 1000;

type Job = {
  set_id: string | null;
  language: string;
  data_source: string;
  priority: number;
  created_at: string;
};

function previewAllowed() {
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === APPROVED_BRANCH &&
    process.env.ARTWORK_RECOVERY_ENABLED === "true" &&
    process.env.ARTWORK_RECOVERY_COORDINATOR_ENABLED === "true"
  );
}

function schedulerAuthorized(request: NextRequest): boolean {
  const secret = process.env.ARTWORK_UNIVERSAL_SCHEDULER_SECRET;
  const supplied = request.headers.get("x-mintradar-universal-scheduler") ?? "";
  if (!secret || secret.length < 32 || !supplied) return false;
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase configuration");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function GET(request: NextRequest) {
  if (!previewAllowed()) {
    return NextResponse.json(
      { ok: false, error: "Preview automation disabled" },
      { status: 403 }
    );
  }

  try {
    const db = getDb();

    const admins = new Set(
      (process.env.MINTRADAR_ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    );

    const internalScheduler = schedulerAuthorized(request) &&
      process.env.ARTWORK_UNIVERSAL_SCHEDULER_ENABLED === "true";
    const authorization = request.headers.get("authorization") ?? "";

    if (!internalScheduler && (!/^Bearer\s+\S+$/i.test(authorization) || !admins.size)) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!internalScheduler) {
      const token = authorization.replace(/^Bearer\s+/i, "").trim();
      const { data: auth, error: authError } = await db.auth.getUser(token);
      if (authError || !auth.user?.email || !admins.has(auth.user.email.toLowerCase())) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
      }
    }

    // Authenticated, read-only progress view. Excludes the protected MC pilot.
    if (request.nextUrl.searchParams.get("view") === "progress") {
      const statuses = ["pending", "processing", "resolved", "unresolved", "failed"] as const;
      const counts = await Promise.all(statuses.map(async (status) => {
        const { count, error } = await db.from("catalog_artwork_recovery_jobs")
          .select("external_id", { count: "exact", head: true })
          .eq("category", "Pokemon")
          .neq("set_id", EXCLUDED_SET)
          .eq("status", status);
        if (error) throw error;
        return [status, count ?? 0] as const;
      }));
      const { data: control, error: controlError } = await db
        .from("catalog_artwork_universal_controls")
        .select("day_utc,reserved_today,lease_until")
        .eq("control_key", "preview-universal")
        .single();
      if (controlError || !control) throw controlError ?? new Error("Missing universal controls");
      return NextResponse.json({
        ok: true, mode: "preview-universal-progress", excludedSet: EXCLUDED_SET,
        statuses: Object.fromEntries(counts),
        daily: { dayUtc: control.day_utc, reserved: control.reserved_today, limit: 30 },
        batchInProgress: Boolean(control.lease_until && new Date(control.lease_until).getTime() > Date.now()),
        leaseUntil: control.lease_until,
        note: "Read-only counts; no jobs claimed or artwork published."
      });
    }

    const now = new Date().toISOString();
    const staleBefore = new Date(
      Date.now() - 15 * 60 * 1000
    ).toISOString();

    const { data, error } = await db
      .from("catalog_artwork_recovery_jobs")
      .select("set_id,language,data_source,priority,created_at")
      .eq("category", "Pokemon")
      .in("language", ["EN", "JP"])
      .in("data_source", ["tcgdex", "tcgapi_verified"])
      .lt("attempts", 5)
      .not("set_id", "is", null)
      .or(
        [
          `and(status.eq.pending,or(next_attempt_at.is.null,next_attempt_at.lte.${now}))`,
          `and(status.eq.unresolved,next_attempt_at.lte.${now})`,
          `and(status.eq.processing,locked_at.lt.${staleBefore})`,
        ].join(",")
      )
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(MAX_CANDIDATES + 1);

    if (error) throw error;

    const rows = (data ?? []) as Job[];
    const truncated = rows.length > MAX_CANDIDATES;

    // Never select an incomplete candidate pool.
    if (truncated) {
      return NextResponse.json(
        {
          ok: false,
          error: "Candidate limit reached; selection is incomplete",
          limit: MAX_CANDIDATES,
        },
        { status: 409 }
      );
    }

    const groups = new Map<
      string,
      {
        setId: string;
        language: string;
        dataSource: string;
        eligibleJobs: number;
        highestPriority: number;
        oldestJob: string;
      }
    >();

    for (const job of rows) {
      const setId = job.set_id?.trim();
      if (!setId || setId.toUpperCase() === EXCLUDED_SET) {
        continue;
      }

      const key = [
        setId.toLowerCase(),
        job.language,
        job.data_source,
      ].join(":");

      const existing = groups.get(key);

      if (existing) {
        existing.eligibleJobs += 1;
        existing.highestPriority = Math.min(
          existing.highestPriority,
          job.priority
        );
        if (job.created_at < existing.oldestJob) {
          existing.oldestJob = job.created_at;
        }
      } else {
        groups.set(key, {
          setId,
          language: job.language,
          dataSource: job.data_source,
          eligibleJobs: 1,
          highestPriority: job.priority,
          oldestJob: job.created_at,
        });
      }
    }

    const candidates = [...groups.values()].sort(
      (a, b) =>
        a.highestPriority - b.highestPriority ||
        a.oldestJob.localeCompare(b.oldestJob) ||
        a.setId.localeCompare(b.setId)
    );

    return NextResponse.json({
      ok: true,
      mode: "preview-universal-discovery",
      dryRun: true,
      excludedSet: EXCLUDED_SET,
      eligibleJobs: candidates.reduce(
        (sum, item) => sum + item.eligibleJobs,
        0
      ),
      candidateSets: candidates.length,
      selected: candidates[0] ?? null,
      candidates,
      note:
        "Read-only discovery. No jobs claimed, no provider requests, no catalog changes.",
    });
  } catch (error) {
    console.error("[universal-artwork-discovery]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Universal artwork discovery failed",
      },
      { status: 500 }
    );
  }
}


// Intentionally separate from the existing MC pilot coordinator.
// A POST processes at most three jobs, sequentially, on the approved Preview.
const APPROVED_ORIGIN =
  "https://mint-radar-git-mobile-print-infrastructure-mint-radar.vercel.app";
const MAX_BATCH_JOBS = 3;
const CONFIRMATION = "PROCESS_THREE_UNIVERSAL_JOBS";

type SelectedScope = {
  setId: string;
  language: "EN" | "JP";
  dataSource: "tcgdex" | "tcgapi_verified";
};

function validScope(value: unknown): value is SelectedScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const selected = value as Record<string, unknown>;
  return (
    typeof selected.setId === "string" &&
    /^[\w-]{1,80}$/.test(selected.setId) &&
    selected.setId.toUpperCase() !== EXCLUDED_SET &&
    (selected.language === "EN" || selected.language === "JP") &&
    (selected.dataSource === "tcgdex" || selected.dataSource === "tcgapi_verified")
  );
}

export async function POST(request: NextRequest) {
  if (!previewAllowed()) {
    return NextResponse.json(
      { ok: false, error: "Preview automation disabled" },
      { status: 403 }
    );
  }

  // An explicit confirmation prevents accidental batch execution.
  // Authorization is still enforced by the GET discovery call below.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { ok: false, error: "JSON content type required" },
      { status: 415 }
    );
  }
  const internalScheduler = schedulerAuthorized(request) &&
    process.env.ARTWORK_UNIVERSAL_SCHEDULER_ENABLED === "true";
  const requestOrigin = request.headers.get("origin");
  if (request.nextUrl.origin !== APPROVED_ORIGIN ||
      (!internalScheduler && requestOrigin !== APPROVED_ORIGIN)) {
    return NextResponse.json(
      { ok: false, error: "Unapproved Preview request origin" },
      { status: 403 }
    );
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      (body as Record<string, unknown>).confirm !== CONFIRMATION) {
    return NextResponse.json(
      { ok: false, error: "Explicit three-job confirmation required" },
      { status: 400 }
    );
  }

  try {
    // Authenticate and discover BEFORE any mutation; GET fails closed on
    // incomplete candidate pools. Repeat discovery after every processed job.
    let discoveryResponse = await GET(request);
    if (!discoveryResponse.ok) return discoveryResponse;

    // The worker's fallback fetch must never be redirected to another host.
    const origin = recoveryOrigin(process.env.ARTWORK_RECOVERY_ORIGIN ?? "");
    if (origin !== APPROVED_ORIGIN) {
      return NextResponse.json(
        { ok: false, error: "Unapproved Preview recovery origin" },
        { status: 403 }
      );
    }

    const db = getDb();
    // Atomic database lease and daily reservation. The RPC uses a row lock,
    // so concurrent Vercel instances cannot reserve the same capacity.
    const { data: reservation, error: reservationError } = await db.rpc(
      "begin_catalog_artwork_universal_batch", { p_slots: MAX_BATCH_JOBS }
    );
    if (reservationError) throw reservationError;
    const guard = reservation as {
      acquired?: boolean; token?: string; reason?: string;
      reservedToday?: number; dailyLimit?: number; dayUtc?: string;
      leaseUntil?: string;
    } | null;
    if (!guard?.acquired || !guard.token) {
      return NextResponse.json({
        ok: false, error: guard?.reason ?? "Batch reservation unavailable",
        daily: { reserved: guard?.reservedToday ?? null, limit: guard?.dailyLimit ?? 30,
          dayUtc: guard?.dayUtc ?? null }, leaseUntil: guard?.leaseUntil ?? null
      }, { status: guard?.reason === "batch-in-progress" ? 409 : 429 });
    }
    try {
    const results: Array<{ external_id: string; status: string; error?: string }> = [];
    const selections: SelectedScope[] = [];
    let claimed = 0;
    let cooldown: string | null = null;
    let stopReason = "batch-limit-reached";

    for (let index = 0; index < MAX_BATCH_JOBS; index++) {
      // The first iteration uses the already-authenticated discovery response.
      // Subsequent iterations re-evaluate eligibility and ordering.
      if (index > 0) {
        discoveryResponse = await GET(request);
        if (!discoveryResponse.ok) {
          stopReason = `discovery-failed-${discoveryResponse.status}`;
          break;
        }
      }
      const discovery = (await discoveryResponse.json()) as { selected?: unknown };
      const selected = discovery.selected;
      if (selected == null) {
        stopReason = "queue-empty";
        break;
      }
      if (!validScope(selected)) {
        stopReason = "invalid-discovery-scope";
        break;
      }

      cooldown = await cooldownUntil(db);
      if (cooldown) {
        stopReason = "provider-cooldown";
        break;
      }

      const batch = await runScopedRecoveryBatch(db, origin, selected);
      claimed += batch.claimed;
      cooldown = batch.cooldownUntil;
      selections.push(selected);
      results.push(...batch.results);

      if (batch.claimed === 0) {
        stopReason = cooldown ? "provider-cooldown" : "claim-unavailable";
        break;
      }
      const outcome = batch.results[0];
      // Fail closed on errors and retry conditions. Never loop through a
      // provider outage or continue after an ambiguous job outcome.
      if (!outcome || ![
        "resolved-identity-verified",
        "resolved-existing-vintage-identity",
        "candidate-review",
        "skipped-existing-image",
        "fallback-configuration-needed",
        "unresolved-recheck-scheduled",
        "unresolved-max-attempts"
      ].includes(outcome.status)) {
        stopReason = outcome?.status ?? "missing-result";
        break;
      }
      if (cooldown) {
        stopReason = "provider-cooldown";
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "preview-universal-processing",
      batchLimit: MAX_BATCH_JOBS,
      claimed,
      processed: results.length,
      selected: selections[0] ?? null,
      selections,
      cooldownUntil: cooldown,
      stopReason,
      results,
      daily: { reserved: guard.reservedToday, limit: guard.dailyLimit,
        dayUtc: guard.dayUtc },
      note: "Identity discovery only. No artwork publication or rights clearance.",
    });
    } finally {
      const { data: released, error: releaseError } = await db.rpc(
        "end_catalog_artwork_universal_batch", { p_token: guard.token }
      );
      if (releaseError || released !== true) {
        console.error("[universal-artwork-lease-release]", releaseError ?? "Lease not released");
        // Lease expires after 10 minutes; a new batch will be blocked until then.
      }
    }
  } catch (error) {
    console.error("[universal-artwork-processing]", error);
    return NextResponse.json(
      { ok: false, error: "Universal artwork processing failed; inspect job states before retrying" },
      { status: 500 }
    );
  }
}
