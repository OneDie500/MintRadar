
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import {
  recoveryOrigin,
  runRecoveryBatch,
  cooldownUntil,
} from "@/lib/artwork-recovery-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const JOB_TABLE = "catalog_artwork_recovery_jobs";

const APPROVED_BRANCH = "mobile-print-infrastructure";
const APPROVED_SET = "MC";
const BATCH_LIMIT = 3;

const APPROVED_ORIGIN =
  "https://mint-radar-git-mobile-print-infrastructure-mint-radar.vercel.app";

function getSupabase() {
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

type Db = ReturnType<typeof getSupabase>;

function previewAllowed(): boolean {
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF ===
      APPROVED_BRANCH &&
    process.env.ARTWORK_RECOVERY_ENABLED === "true" &&
    process.env.ARTWORK_RECOVERY_COORDINATOR_ENABLED ===
      "true"
  );
}

async function requireAdmin(
  request: NextRequest,
  db: Db
): Promise<boolean> {
  const authorization =
    request.headers.get("authorization") ?? "";

  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return false;
  }

  const admins = new Set(
    (process.env.MINTRADAR_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!admins.size) return false;

  const token = authorization
    .replace(/^Bearer\s+/i, "")
    .trim();

  const { data, error } = await db.auth.getUser(token);

  if (error || !data.user?.email) {
    return false;
  }

  return admins.has(data.user.email.toLowerCase());
}

async function countJobs(
  db: Db,
  status: string
): Promise<number> {
  const { count, error } = await db
    .from(JOB_TABLE)
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("set_id", APPROVED_SET)
    .eq("data_source", "tcgdex")
    .eq("category", "Pokemon")
    .eq("language", "JP")
    .eq("status", status);

  if (error) throw error;

  return count ?? 0;
}

async function getProgress(db: Db) {
  const [
    pending,
    processing,
    resolved,
    unresolved,
    failed,
  ] = await Promise.all([
    countJobs(db, "pending"),
    countJobs(db, "processing"),
    countJobs(db, "resolved"),
    countJobs(db, "unresolved"),
    countJobs(db, "failed"),
  ]);

  return {
    total:
      pending +
      processing +
      resolved +
      unresolved +
      failed,
    pending,
    processing,
    resolved,
    unresolved,
    failed,
  };
}

async function handle(request: NextRequest) {
  if (!previewAllowed()) {
    return NextResponse.json(
      {
        ok: false,
        enabled: false,
        error: "Preview coordinator is disabled.",
      },
      { status: 403 }
    );
  }

  const db = getSupabase();

  if (!(await requireAdmin(request, db))) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized.",
      },
      { status: 401 }
    );
  }

  try {
    const configuredOrigin =
      process.env.ARTWORK_RECOVERY_ORIGIN ?? "";

    const origin = recoveryOrigin(configuredOrigin);

    if (origin !== APPROVED_ORIGIN) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Coordinator origin does not match the approved Preview.",
        },
        { status: 403 }
      );
    }

    const before = await getProgress(db);

    const existingCooldown = await cooldownUntil(db);

    if (existingCooldown) {
      return NextResponse.json({
        ok: true,
        mode: "preview-coordinator",
        setId: APPROVED_SET,
        claimed: 0,
        processed: 0,
        cooldownUntil: existingCooldown,
        before,
        after: before,
        results: [],
        note: "Provider cooldown active. No jobs claimed.",
      });
    }

    const batch = await runRecoveryBatch(
      db,
      BATCH_LIMIT,
      origin,
      APPROVED_SET
    );

    const after = await getProgress(db);

    return NextResponse.json({
      ok: true,
      mode: "preview-coordinator",
      setId: APPROVED_SET,
      batchLimit: BATCH_LIMIT,
      claimed: batch.claimed,
      processed: batch.results.length,
      cooldownUntil: batch.cooldownUntil,
      before,
      after,
      results: batch.results,
      note:
        "Discovery and identity verification only. No catalog artwork publication or rights clearance.",
    });
  } catch (error) {
    console.error(
      "[artwork-recovery-coordinator]",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error: "Artwork recovery coordinator failed.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}
