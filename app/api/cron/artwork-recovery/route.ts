
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled artwork recovery is intentionally paused.
 *
 * Artwork recovery must remain explicitly set-scoped.
 * This endpoint must not enqueue or process jobs across
 * the entire catalog.
 *
 * Controlled recovery remains available through the
 * authenticated admin route.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";

  if (!secret || !header.startsWith("Bearer ")) {
    return false;
  }

  const received = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");

  return (
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    enabled: false,
    scheduledRecovery: false,
    reason:
      "Scheduled artwork recovery is paused. Use authenticated, set-scoped admin recovery.",
    enqueued: 0,
    claimed: 0,
    processed: 0,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
