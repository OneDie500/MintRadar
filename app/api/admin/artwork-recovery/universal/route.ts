
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    const authorization =
      request.headers.get("authorization") ?? "";

    if (!/^Bearer\s+\S+$/i.test(authorization) || !admins.size) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const { data: auth, error: authError } =
      await db.auth.getUser(token);

    if (
      authError ||
      !auth.user?.email ||
      !admins.has(auth.user.email.toLowerCase())
    ) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
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
