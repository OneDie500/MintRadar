import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { POST as runGuardedUniversalBatch } from "@/app/api/admin/artwork-recovery/universal/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PREVIEW = "https://mint-radar-git-mobile-print-infrastructure-mint-radar.vercel.app";

function approvedEnvironment(): boolean {
  return process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF === "mobile-print-infrastructure" &&
    process.env.ARTWORK_RECOVERY_ENABLED === "true" &&
    process.env.ARTWORK_RECOVERY_COORDINATOR_ENABLED === "true" &&
    process.env.ARTWORK_RECOVERY_ORIGIN === PREVIEW;
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.ARTWORK_UNIVERSAL_SCHEDULER_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32 || !header.startsWith("Bearer ")) return false;
  const received = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET() {
  // Safe deployment smoke test; never executes recovery.
  return NextResponse.json({
    ok: true,
    mode: "preview-universal-scheduler",
    enabled: approvedEnvironment() && process.env.ARTWORK_UNIVERSAL_SCHEDULER_ENABLED === "true",
    dryRun: true,
    note: "GET never processes jobs. No Vercel cron is configured for this endpoint."
  });
}

export async function POST(request: NextRequest) {
  if (!approvedEnvironment() || request.nextUrl.origin !== PREVIEW) {
    return NextResponse.json({ ok: false, error: "Preview environment not approved" }, { status: 403 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.ARTWORK_UNIVERSAL_SCHEDULER_ENABLED !== "true") {
    return NextResponse.json({ ok: true, enabled: false, processed: 0, reason: "scheduler-disabled" });
  }

  // Reuse the *exact* guarded coordinator. Its DB lease, daily reservations,
  // scope selection, provider cooldown, and MC exclusion remain authoritative.
  const internal = new NextRequest(`${PREVIEW}/api/admin/artwork-recovery/universal`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mintradar-universal-scheduler": process.env.ARTWORK_UNIVERSAL_SCHEDULER_SECRET!,
    },
    body: JSON.stringify({ confirm: "PROCESS_THREE_UNIVERSAL_JOBS" }),
  });
  return runGuardedUniversalBatch(internal);
}
