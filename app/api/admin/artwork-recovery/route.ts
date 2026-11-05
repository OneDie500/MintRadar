import { recoveryOrigin, runRecoveryBatch } from "@/lib/artwork-recovery-worker";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "catalog_artwork_recovery_jobs";
const MAX_ENQUEUE = 100;
const MAX_RUN = 3;
const RESOLVER_TIMEOUT_MS = 25000;

type Job = {
  id: string;
  category: string;
  language: string;
  data_source: string;
  external_id: string;
  set_id: string | null;
  card_number: string | null;
  card_name: string | null;
  attempts: number;
};

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

  return Number.isSafeInteger(number) && number >= 1
    ? Math.min(number, max)
    : fallback;
}

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Unknown recovery error";
}

function deriveSetId(card: CatalogCard): string | null {
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

export async function GET(request: NextRequest) {
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
      .select("id,external_id,language,set_id,card_number,card_name,status,attempts,discovered_image_url,discovered_source,identity_verified,rights_cleared,last_error,updated_at")
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
      { error: "Could not load artwork recovery status." },
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

  if (!["JP", "EN", "CN", "CN-TW"].includes(language)) {
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

  // IMPORTANT:
  // Missing artwork can be stored as NULL or an empty string.
  // The original query only checked NULL, excluding thousands
  // of valid recovery candidates.
  //
  // This query includes BOTH representations without changing
  // existing catalog records.

  let query = supabase
    .from("cards")
    .select("external_id,data_source,category,language,set_id,card_number,name,image_url")
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

  // Existing jobs are preserved, including previous discoveries.
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
  body: Record<string, unknown>,
  request: NextRequest
) {
  // Block admin-triggered processing until recovery is explicitly enabled.
  if (process.env.ARTWORK_RECOVERY_ENABLED !== "true") {
    return NextResponse.json({
      ok: true,
      enabled: false,
      claimed: 0,
      processed: 0,
    });
  }

  const limit = integerWithin(body.limit, 3, MAX_RUN);
  const configured = process.env.ARTWORK_RECOVERY_ORIGIN ||
    process.env.MINTRADAR_INTERNAL_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : request.nextUrl.origin);
  const origin = recoveryOrigin(configured);
  const batch = await runRecoveryBatch(supabase, limit, origin);
  return NextResponse.json({ ok: true, ...batch });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);

    if (!auth.ok) return auth.response;

    let body: Record<string, unknown>;

    try {
      const parsed: unknown =
        await request.json();

      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error(
          "Invalid JSON body"
        );
      }

      body = parsed as Record<
        string,
        unknown
      >;
    } catch {
      return NextResponse.json(
        {
          error:
            "A JSON object body is required.",
        },
        { status: 400 }
      );
    }

    if (body.action === "enqueue") {
      return await enqueue(
        auth.supabase,
        body
      );
    }

    if (body.action === "run") {
      return await run(
        auth.supabase,
        body,
        request
      );
    }

    return NextResponse.json(
      {
        error:
          "Use action 'enqueue' or 'run'.",
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
        error:
          "Artwork recovery request failed.",
      },
      { status: 500 }
    );
  }
}
