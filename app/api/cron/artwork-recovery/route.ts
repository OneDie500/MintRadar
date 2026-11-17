
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  recoveryDb,
  recoveryOrigin,
  runRecoveryBatch,
} from "@/lib/artwork-recovery-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_BATCH_LIMIT = 2;
const MAX_BATCH_LIMIT = 3;

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

function disabled(reason: string) {
  return NextResponse.json({
    ok: true,
    enabled: false,
    scheduledRecovery: false,
    reason,
    enqueued: 0,
    claimed: 0,
    processed: 0,
  });
}

function configuredBatchLimit(): number {
  const raw =
    process.env.ARTWORK_RECOVERY_CRON_BATCH_LIMIT ??
    String(DEFAULT_BATCH_LIMIT);

  const limit = Number(raw);

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_BATCH_LIMIT
  ) {
    throw new Error(
      "ARTWORK_RECOVERY_CRON_BATCH_LIMIT must be 1, 2, or 3"
    );
  }

  return limit;
}

function productionOrigin(): string {
  const configured =
    process.env.ARTWORK_RECOVERY_ORIGIN ?? "";

  const productionHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "";

  if (!productionHost) {
    throw new Error(
      "Missing VERCEL_PROJECT_PRODUCTION_URL"
    );
  }

  const origin = recoveryOrigin(configured);
  const expected = recoveryOrigin(
    `https://${productionHost}`
  );

  if (origin !== expected) {
    throw new Error(
      "Artwork recovery origin does not match the " +
      "Vercel Production URL"
    );
  }

  return origin;
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized",
      },
      { status: 401 }
    );
  }

  if (process.env.VERCEL_ENV !== "production") {
    return disabled(
      "Scheduled recovery is restricted to Production"
    );
  }

  if (
    process.env.ARTWORK_RECOVERY_ENABLED !== "true"
  ) {
    return disabled(
      "Artwork recovery worker is disabled"
    );
  }

  if (
    process.env.ARTWORK_RECOVERY_CRON_ENABLED !== "true"
  ) {
    return disabled(
      "Scheduled artwork recovery is disabled"
    );
  }

  const setId =
    process.env.ARTWORK_RECOVERY_CRON_SET_ID?.trim();

  if (!setId || !/^[\w-]{1,80}$/.test(setId)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "A valid ARTWORK_RECOVERY_CRON_SET_ID is required",
      },
      { status: 503 }
    );
  }

  try {
    const origin = productionOrigin();
    const limit = configuredBatchLimit();
    const db = recoveryDb();

    const result = await runRecoveryBatch(
      db,
      limit,
      origin,
      setId
    );

    return NextResponse.json({
      ok: true,
      enabled: true,
      scheduledRecovery: true,
      setId,
      batchLimit: limit,
      enqueued: 0,
      claimed: result.claimed,
      processed: result.results.length,
      cooldownUntil: result.cooldownUntil,
      results: result.results,
    });
  } catch (error) {
    console.error(
      "[artwork-recovery-cron] Scheduled recovery failed",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        error: "Scheduled artwork recovery failed",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
