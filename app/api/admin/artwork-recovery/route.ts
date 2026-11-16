import {
  recoveryOrigin,
  runRecoveryBatch,
  processRecoveryJob,
  type RecoveryJob,
} from "@/lib/artwork-recovery-worker";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TABLE = "catalog_artwork_recovery_jobs";
const MAX_ENQUEUE = 100;
const MAX_RUN = 3;

const SINGLE_TEST_JOB_ID =
  "d0f1cf9a-f8bd-41a3-8062-3a2f86007d1d";

const SINGLE_TEST_EXTERNAL_ID = "M6-002";

// Exact allowlist for a preview-only, two-job ME06 recovery test.
const ME06_TEST_JOBS = [
  { id: "5cd0f2fa-7755-4cf2-a96a-9a713d072254", externalId: "ME06-115/103", number: "115/103", name: "Azurill" },
  { id: "8b9462b2-a353-4390-94cf-107aef632d1f", externalId: "ME06-138/103", number: "138/103", name: "Mega Rayquaza ex" },
] as const;
const ME06_TEST_ORIGIN = "https://mint-radar-git-mobile-print-infrastructure-mint-radar.vercel.app";
const SINGLE_TEST_BRANCH = "mobile-print-infrastructure";

type CatalogCard = {
  external_id: string;
  data_source: string | null;
  category: string | null;
  language: string;
  set_id: string | null;
  card_number: string | null;
  name: string | null;
  image_url: string | null;
};

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase server configuration.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

type AdminClient = ReturnType<typeof getServerSupabase>;

async function requireAdmin(
  request: NextRequest
): Promise<
  | { ok: true; supabase: AdminClient }
  | { ok: false; response: NextResponse }
> {
  const header = request.headers.get("authorization") || "";

  if (!/^Bearer\s+\S+$/i.test(header)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      ),
    };
  }

  const admins = new Set(
    (process.env.MINTRADAR_ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!admins.size) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Admin access is not configured." },
        { status: 403 }
      ),
    };
  }

  const supabase = getServerSupabase();
  const token = header.replace(/^Bearer\s+/i, "").trim();

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user?.email) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      ),
    };
  }

  if (!admins.has(data.user.email.toLowerCase())) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, supabase };
}

function integerWithin(
  value: unknown,
  fallback: number,
  max: number
): number {
  const number = Number(value);

  return Number.isSafeInteger(number) && number>= 1
    ? Math.min(number, max)
    : fallback;
}

function deriveSetId(card: CatalogCard): string| null {
  if (card.set_id) return card.set_id;

  if (
    card.card_number &&
    card.external_id.endsWith(`-${card.card_number}`)
  ) {
    return card.external_id.slice(
      0,
      -(card.card_number.length + 1)
    );
  }

  const index = card.external_id.lastIndexOf("-");

  return index > 0
    ? card.external_id.slice(0, index)
    : null;
}

function singleTestEnvironmentAllowed(): boolean {
  return (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_GIT_COMMIT_REF ===
      SINGLE_TEST_BRANCH &&
    process.env.ARTWORK_RECOVERY_SINGLE_TEST_ENABLED ===
      "true" &&
    process.env.ARTWORK_RECOVERY_ENABLED !== "true"
  );
}

function validSingleTestJob(job: RecoveryJob): boolean {
  return (
    job.id === SINGLE_TEST_JOB_ID &&
    job.external_id === SINGLE_TEST_EXTERNAL_ID&&
    job.category === "Pokemon" &&
    job.language === "JP" &&
    job.data_source === "tcgdex" &&
    job.set_id === "M6" &&
    job.card_number === "002" &&
    job.card_name === "アメタマ" &&
    typeof job.locked_at === "string" &&
    job.locked_at.length > 0 &&
    Number.isSafeInteger(job.attempts) &&
    job.attempts >= 1 &&
    job.attempts <= 5
  );
}

export async function GET(request: NextRequest){
  try {
    const auth = await requireAdmin(request);

    if (!auth.ok) return auth.response;

    const supabase = auth.supabase;

    const statuses = [
      "pending",
      "processing",
      "resolved",
      "unresolved",
      "failed",
    ];

    const counts = await Promise.all(
      statuses.map(async (status) => {
        const { count, error } = await supabase
          .from(TABLE)
          .select("id", {
            count: "exact",
            head: true,
          })
          .eq("status", status);

        if (error) throw error;

        return [status, count || 0] as const;
      })
    );

    const { data, error } = await supabase
      .from(TABLE)
      .select(
        "id,external_id,language,set_id,card_number,card_name,status,attempts,discovered_image_url,discovered_source,identity_verified,rights_cleared,last_error,updated_at"
      )
      .order("updated_at", { ascending: false })
      .limit(25);

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      counts: Object.fromEntries(counts),
      recent: data || [],
    });
  } catch (error) {
    console.error("Artwork recovery GET:", error);

    return NextResponse.json(
      { error: "Could not load artwork recoverystatus." },
      { status: 500 }
    );
  }
}

async function enqueue(
  supabase: AdminClient,
  body: Record<string, unknown>
) {
  const limit = integerWithin(
    body.limit,
    25,
    MAX_ENQUEUE
  );

  const language =
    typeof body.language === "string"
      ? body.language.toUpperCase()
      : "JP";

  if (!["JP", "EN"].includes(language)) {
    return NextResponse.json(
      { error: "Unsupported language." },
      { status: 400 }
    );
  }

  const after =
    typeof body.after === "string"
      ? body.after.trim()
      : "";

  const setId =
    typeof body.setId === "string"
      ? body.setId.trim()
      : "";

  if (setId && !/^[\w-]{1,80}$/.test(setId)) {
    return NextResponse.json(
      { error: "Invalid set ID." },
      { status: 400 }
    );
  }

  let query = supabase
    .from("cards")
    .select(
      "external_id,data_source,category,language,set_id,card_number,name,image_url"
    )
    .eq("data_source", "tcgdex")
    .eq("category", "Pokemon")
    .eq("language", language)
    .or("image_url.is.null,image_url.eq.")
    .order("external_id", { ascending: true })
    .limit(limit);

  if (after) {
    query = query.gt("external_id", after);
  }

  if (setId) {
    query = query.eq("set_id", setId);
  }

  const { data, error } = await query;

  if (error) throw error;

  const cards: CatalogCard[] = data ?? [];

  if (!cards.length) {
    return NextResponse.json({
      ok: true,
      examined: 0,
      queued: 0,
      nextCursor: null,
    });
  }

  const jobs = cards.map((card) => ({
    category: "Pokemon",
    language: card.language,
    data_source: "tcgdex",
    external_id: card.external_id,
    set_id: deriveSetId(card),
    card_number: card.card_number,
    card_name: card.name,
    status: "pending",
    priority: 100,
  }));

  const { error: insertError } = await supabase
    .from(TABLE)
    .upsert(jobs, {
      onConflict:
        "data_source,category,language,external_id",
      ignoreDuplicates: true,
    });

  if (insertError) throw insertError;

  return NextResponse.json({
    ok: true,
    examined: cards.length,
    queuedOrAlreadyPresent: cards.length,
    nextCursor: cards[cards.length - 1].external_id,
    hasMorePotentially: cards.length === limit,
    note:
      "Existing jobs were preserved. Use nextCursor as after to continue scanning.",
  });
}

async function run(
  supabase: AdminClient,
  body: Record<string, unknown>
) {
  if (process.env.ARTWORK_RECOVERY_ENABLED !== "true") {
    return NextResponse.json({
      ok: true,
      enabled: false,
      claimed: 0,
      processed: 0,
    });
  }

  const limit = integerWithin(body.limit, 3, MAX_RUN);
  const configured =
    process.env.ARTWORK_RECOVERY_ORIGIN ?? "";

  const origin = recoveryOrigin(configured);
  const batch = await runRecoveryBatch(
    supabase,
    limit,
    origin
  );

  return NextResponse.json({
    ok: true,
    ...batch,
  });
}

async function testSingle(
  supabase: AdminClient,
  body: Record<string, unknown>
) {
  if (!singleTestEnvironmentAllowed()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Single-job recovery test is disabled.",
      },
      { status: 403 }
    );
  }

  if (
    body.jobId !== SINGLE_TEST_JOB_ID ||
    Object.keys(body).some(
      (key) => !["action", "jobId"].includes(key)
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid single-job test request.",
      },
      { status: 400 }
    );
  }

  // Read-only preflight: verify the exact job and catalog
  // record before claiming anything.
  const { data: existingJob, error: jobError } =
    await supabase
      .from(TABLE)
      .select(
        "id,external_id,status,attempts,data_source,category,language,set_id,card_number,card_name"
      )
      .eq("id", SINGLE_TEST_JOB_ID)
      .maybeSingle();

  if (jobError) throw jobError;

  if (
    !existingJob ||
    existingJob.external_id !== SINGLE_TEST_EXTERNAL_ID ||
    existingJob.status !== "pending" ||
    existingJob.attempts !== 0 ||
    existingJob.data_source !== "tcgdex" ||
    existingJob.category !== "Pokemon" ||
    existingJob.language !== "JP" ||
    existingJob.set_id !== "M6" ||
    existingJob.card_number !== "002" ||
    existingJob.card_name !== "アメタマ"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Test job is not in its expectedinitial state.",
      },
      { status: 409 }
    );
  }

  const { data: card, error: cardError } =
    await supabase
      .from("cards")
      .select("image_url")
      .eq("data_source", "tcgdex")
      .eq("category", "Pokemon")
      .eq("language", "JP")
      .eq("external_id", SINGLE_TEST_EXTERNAL_ID)
      .maybeSingle();

  if (cardError) throw cardError;

  if (
    !card ||
    (typeof card.image_url === "string" &&
      card.image_url.trim().length > 0)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Test card is missing or alreadyhas artwork.",
      },
      { status: 409 }
    );
  }

  const configured =
    process.env.ARTWORK_RECOVERY_ORIGIN ?? "";

  const origin = recoveryOrigin(configured);

  // Require the resolver origin to be the exact known
  // Preview alias, not Production or an arbitrary host.
  const expectedOrigin =
    "https://mint-radar-git-mobile-print-infrastructure-mint-radar.vercel.app";

  if (origin !== expectedOrigin) {
    return NextResponse.json(
      {
        ok: false,
        error: "Recovery origin does not match the approved Preview.",
      },
      { status: 403 }
    );
  }

  // This RPC claims only the explicitly supplied UUID.
  const { data, error } = await supabase.rpc(
    "claim_single_artwork_recovery_job",
    {
      p_job_id: SINGLE_TEST_JOB_ID,
    }
  );

  if (error) throw error;

  const jobs = (data ?? []) as RecoveryJob[];

  if (jobs.length !== 1) {
    return NextResponse.json(
      {
        ok: false,
        error: "Target job was not eligible forclaiming.",
      },
      { status: 409 }
    );
  }

  const job = jobs[0];

  if (!validSingleTestJob(job)) {
    // Do not process an unexpected claimed record.
    // An administrator must inspect/release the claim.
    console.error(
      "Unexpected claimed single-test job identity",
      job.id
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          "Claimed job failed identity validation. Manual review required.",
      },
      { status: 409 }
    );
  }

  const result = await processRecoveryJob(
    supabase,
    job,
    origin
  );

  return NextResponse.json({
    ok: true,
    mode: "single-job-test",
    jobId: job.id,
    externalId: job.external_id,
    result,
    note:
      "Recovery discovery completed. Catalog artwork publication was not requested.",
  });
}

// This test intentionally bypasses the general queue claim. The database RPC
// atomically claims exactly the two allowlisted UUIDs, or neither of them.
async function testMe06Pair(
  supabase: AdminClient,
  body: Record<string, unknown>
) {
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.VERCEL_GIT_COMMIT_REF !== SINGLE_TEST_BRANCH ||
    process.env.ARTWORK_RECOVERY_ENABLED === "true" ||
    process.env.ARTWORK_RECOVERY_ME06_TEST_ENABLED !== "true"
  ) {
    return NextResponse.json(
      { ok: false, error: "ME06 pair test is disabled." },
      { status: 403 }
    );
  }

  if (
    Object.keys(body).some((key) => key !== "action") ||
    body.action !== "test-me06-pair"
  ) {
    return NextResponse.json(
      { ok: false, error: "Invalid ME06 pair test request." },
      { status: 400 }
    );
  }

  const origin = recoveryOrigin(process.env.ARTWORK_RECOVERY_ORIGIN ?? "");
  if (origin !== ME06_TEST_ORIGIN) {
    return NextResponse.json(
      { ok: false, error: "Recovery origin is not the approved preview." },
      { status: 403 }
    );
  }

  // Preflight is read-only. No attempt counters or locks change here.
  const ids = ME06_TEST_JOBS.map((job) => job.id);
  const { data: existing, error: preflightError } = await supabase
    .from(TABLE)
    .select("id,external_id,data_source,category,language,set_id,card_number,card_name,status,attempts,locked_at,identity_verified,rights_cleared,next_attempt_at")
    .in("id", ids);
  if (preflightError) throw preflightError;

  const ready = ME06_TEST_JOBS.every((expected) => {
    const job = (existing ?? []).find((item) => item.id === expected.id);
    return job &&
      job.external_id === expected.externalId &&
      job.data_source === "tcgapi_verified" &&
      job.category === "Pokemon" &&
      job.language === "EN" &&
      job.set_id === "ME06" &&
      job.card_number === expected.number &&
      job.card_name === expected.name &&
      job.status === "pending" &&
      job.attempts === 1 &&
      job.locked_at === null &&
      job.identity_verified === false &&
      job.rights_cleared === false &&
      (job.next_attempt_at === null || Date.parse(job.next_attempt_at) <= Date.now());
  });
  if (!ready || (existing ?? []).length !== 2) {
    return NextResponse.json(
      { ok: false, error: "ME06 test jobs no longer match their approved pending state." },
      { status: 409 }
    );
  }

  // Check the exact source catalog records before acquiring any claims.
  for (const expected of ME06_TEST_JOBS) {
    const { data: card, error: cardError } = await supabase
      .from("cards")
      .select("image_url,set_id,name")
      .eq("data_source", "tcgapi_verified")
      .eq("category", "Pokemon")
      .eq("language", "EN")
      .eq("external_id", expected.externalId)
      .maybeSingle();
    if (cardError) throw cardError;
    if (!card || (card.set_id && card.set_id.toLowerCase() !== "me06") ||
        card.name !== expected.name ||
        (typeof card.image_url === "string" && card.image_url.trim())) {
      return NextResponse.json(
        { ok: false, error: `Catalog preflight failed for ${expected.externalId}.` },
        { status: 409 }
      );
    }
  }

  // SQL enforces the same allowlist atomically to close preflight races.
  const { data, error } = await supabase.rpc("claim_me06_artwork_recovery_test_pair");
  if (error) throw error;
  const jobs = (data ?? []) as Array<RecoveryJob & { status: string }>;
  if (jobs.length !== 2 || !ME06_TEST_JOBS.every((expected) =>
    jobs.some((job) => job.id === expected.id &&
      job.external_id === expected.externalId &&
      job.data_source === "tcgapi_verified" &&
      job.category === "Pokemon" &&
      job.language === "EN" &&
      job.set_id === "ME06" &&
      job.card_number === expected.number &&
      job.card_name === expected.name &&
      job.status === "processing" &&
      job.attempts === 2 &&
      typeof job.locked_at === "string" && !!job.locked_at)
  )) {
    // An unexpected claim must not be processed automatically.
    console.error("ME06 test claim identity mismatch", jobs.map((job) => job.id));
    return NextResponse.json(
      { ok: false, error: "ME06 claim mismatch; inspect locks before retrying." },
      { status: 409 }
    );
  }

  const results = [];
  for (const expected of ME06_TEST_JOBS) {
    const job = jobs.find((item) => item.id === expected.id)!;
    results.push(await processRecoveryJob(supabase, job, origin));
  }
  return NextResponse.json({
    ok: true,
    mode: "me06-exact-pair-test",
    claimed: 2,
    results,
    note: "Discovery and identity verification only; no catalog publication or rights clearance.",
  });
}

export async function POST(request: NextRequest) {
  try {
    // Reject targeted-test requests outside Preview before
    // attempting privileged Supabase authentication.
    // All actions still require administrator authentication.
    const auth = await requireAdmin(request);

    if (!auth.ok) return auth.response;

    let body: Record<string, unknown>;

    try {
      const parsed: unknown = await request.json();

      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("Invalid JSON body");
      }

      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        {
          error: "A JSON object body is required.",
        },
        { status: 400 }
      );
    }

    if (body.action === "enqueue") {
      return await enqueue(auth.supabase, body);
    }

    if (body.action === "run") {
      return await run(auth.supabase, body);
    }

    if (body.action === "test-me06-pair") {
      return await testMe06Pair(auth.supabase, body);
    }

    if (body.action === "test-single") {
      return await testSingle(auth.supabase, body);
    }

    return NextResponse.json(
      {
        error:
          "Use action 'enqueue', 'run', 'test-single', or 'test-me06-pair'.",
      },
      { status: 400 }
    );
  } catch (error) {
    console.error(
      "Artwork recovery POST:",
      error
    );

    return NextResponse.json(
      {
        error: "Artwork recovery request failed.",
      },
      { status: 500 }
    );
  }
}
