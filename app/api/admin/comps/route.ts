import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const ALLOWED_SOURCES = new Set([
  "TCGplayer",
  "PriceCharting",
  "Collectr",
  "eBay",
]);

function getServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getAdminEmails() {
  return new Set(
    (process.env.MINTRADAR_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function requireAdmin(request: NextRequest) {
  const authorization =
    request.headers.get("authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      ),
    };
  }

  const accessToken =
    authorization.slice("Bearer ".length).trim();

  const supabase = getServerSupabase();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);

  if (userError || !user?.email) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      ),
    };
  }

  const adminEmails = getAdminEmails();

  if (
    adminEmails.size === 0 ||
    !adminEmails.has(user.email.toLowerCase())
  ) {
    return {
      error: NextResponse.json(
        { error: "Forbidden." },
        { status: 403 }
      ),
    };
  }

  return {
    supabase,
    user,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);

    if ("error" in auth) {
      return auth.error;
    }

    return NextResponse.json({
      ok: true,
      isAdmin: true,
    });
  } catch (err: any) {
    console.error("Admin comps GET error:", err);

    return NextResponse.json(
      {
        error:
          err?.message ||
          "MintRadar could not verify admin access.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);

    if ("error" in auth) {
      return auth.error;
    }

    const body = await request.json();

    const cardId =
      typeof body?.cardId === "string"
        ? body.cardId.trim()
        : "";

    const comps =
      Array.isArray(body?.comps)
        ? body.comps
        : [];

    if (!cardId) {
      return NextResponse.json(
        { error: "A card ID is required." },
        { status: 400 }
      );
    }

    const { data: cardExists, error: cardError } =
      await auth.supabase
        .from("cards")
        .select("id")
        .eq("id", cardId)
        .maybeSingle();

    if (cardError) {
      throw cardError;
    }

    if (!cardExists) {
      return NextResponse.json(
        { error: "Card not found." },
        { status: 404 }
      );
    }

    for (const incoming of comps) {
      const source =
        typeof incoming?.source === "string"
          ? incoming.source.trim()
          : "";

      if (!ALLOWED_SOURCES.has(source)) {
        return NextResponse.json(
          { error: `Unsupported comp source: ${source || "unknown"}.` },
          { status: 400 }
        );
      }

      const average =
        incoming?.average == null
          ? null
          : Number(incoming.average);

      const lastSold =
        incoming?.last_sold == null
          ? null
          : Number(incoming.last_sold);

      const sourceUrl =
        typeof incoming?.source_url === "string" &&
        incoming.source_url.trim() !== ""
          ? incoming.source_url.trim()
          : null;

      if (
        average != null &&
        (!Number.isFinite(average) || average < 0)
      ) {
        return NextResponse.json(
          { error: `${source} has an invalid market value.` },
          { status: 400 }
        );
      }

      if (
        lastSold != null &&
        (!Number.isFinite(lastSold) || lastSold < 0)
      ) {
        return NextResponse.json(
          { error: `${source} has an invalid last-sale value.` },
          { status: 400 }
        );
      }

      if (sourceUrl) {
        try {
          const parsed = new URL(sourceUrl);

          if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
          ) {
            throw new Error("Invalid protocol");
          }
        } catch {
          return NextResponse.json(
            { error: `${source} must use a valid http/https source URL.` },
            { status: 400 }
          );
        }
      }

      const shouldDelete =
        average == null &&
        lastSold == null &&
        sourceUrl == null;

      if (shouldDelete) {
        const { error: deleteError } =
          await auth.supabase
            .from("comps")
            .delete()
            .eq("card_id", cardId)
            .eq("source", source);

        if (deleteError) {
          throw deleteError;
        }

        continue;
      }

      const { error: upsertError } =
        await auth.supabase
          .from("comps")
          .upsert(
            {
              card_id: cardId,
              source,
              average,
              last_sold: lastSold,
              source_url: sourceUrl,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "card_id,source",
            }
          );

      if (upsertError) {
        throw upsertError;
      }
    }

    const { data: savedComps, error: readError } =
      await auth.supabase
        .from("comps")
        .select(
          "source, last_sold, average, source_url, updated_at"
        )
        .eq("card_id", cardId)
        .order("source", { ascending: true });

    if (readError) {
      throw readError;
    }

    return NextResponse.json({
      ok: true,
      comps: savedComps || [],
    });
  } catch (err: any) {
    console.error("Admin comps POST error:", err);

    return NextResponse.json(
      {
        error:
          err?.message ||
          "MintRadar could not save market comps.",
      },
      { status: 500 }
    );
  }
}
