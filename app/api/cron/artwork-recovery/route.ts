import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { recoveryDb, recoveryOrigin, runRecoveryBatch } from "@/lib/artwork-recovery-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const received = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (process.env.ARTWORK_RECOVERY_ENABLED !== "true") {
    return NextResponse.json({ ok: true, enabled: false, enqueued: 0, claimed: 0 });
  }
  try {
    const db = recoveryDb();
    const configured = process.env.ARTWORK_RECOVERY_ORIGIN || process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const origin = recoveryOrigin(configured);
    const { data: enqueued, error } = await db.rpc("enqueue_catalog_artwork_recovery_jobs", { p_limit: 12 });
    if (error) throw error;
    const batch = await runRecoveryBatch(db, 2, origin);
    return NextResponse.json({ ok: true, enabled: true, enqueued: enqueued ?? 0, ...batch });
  } catch (error) {
    console.error("Scheduled artwork recovery failed", error);
    return NextResponse.json({ ok: false, error: "Scheduled artwork recovery failed" }, { status: 500 });
  }
}
export async function GET(request: NextRequest) { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
