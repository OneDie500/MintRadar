
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SportsImageRecord = {
  id: string;
  card_name: string;
  year: string | null;
  manufacturer: string | null;
  release_name: string | null;
  set_name: string | null;
  card_number: string | null;
  parallel_name: string | null;
  print_run: number | null;
  data_source: string | null;
  external_id: string | null;
  image_url: string;
  image_source: string;
  image_type: string;
  verification_status: string;
  usage_permission: string;
};

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function validImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function sameIdentity(
  image: SportsImageRecord,
  requested: {
    name: string;
    year: string;
    manufacturer: string;
    release_name: string;
    set_name: string | null;
    card_number: string;
    parallel_name: string;
    print_run: number | null;
  }
): boolean {
  if (normalize(image.card_name) !== normalize(requested.name)) {
    return false;
  }

  if (normalize(image.year) !== normalize(requested.year)) {
    return false;
  }

  if (
    normalize(image.manufacturer) !==
    normalize(requested.manufacturer)
  ) {
    return false;
  }

  if (
    normalize(image.release_name) !==
    normalize(requested.release_name)
  ) {
    return false;
  }

  if (
    normalize(image.card_number) !==
    normalize(requested.card_number)
  ) {
    return false;
  }

  if (
    normalize(image.parallel_name) !==
    normalize(requested.parallel_name)
  ) {
    return false;
  }

  // A supplied set must match exactly.
  if (
    requested.set_name !== null &&
    normalize(image.set_name) !== normalize(requested.set_name)
  ) {
    return false;
  }

  // A supplied print run must match exactly.
  if (
    requested.print_run !== null &&
    image.print_run !== requested.print_run
  ) {
    return false;
  }

  return true;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    const name = params.get("name")?.trim() ?? "";
    const year = params.get("year")?.trim() ?? "";
    const manufacturer = params.get("manufacturer")?.trim() ?? "";
    const release_name = params.get("release_name")?.trim() ?? "";
    const set_name = params.get("set_name")?.trim() || null;
    const card_number = params.get("card_number")?.trim() ?? "";
    const parallel_name = params.get("parallel_name")?.trim() ?? "";

    const printRunText = params.get("print_run")?.trim() ?? "";
    const print_run = printRunText
      ? Number(printRunText)
      : null;

    // Require sufficient identity data to avoid
    // returning artwork for the wrong card.
    if (
      !name ||
      !year ||
      !manufacturer ||
      !release_name ||
      !card_number ||
      !parallel_name
    ) {
      return NextResponse.json(
        {
          found: false,
          image_url: null,
          error: "Incomplete sports card identity.",
        },
        { status: 400 }
      );
    }

    if (
      print_run !== null &&
      (!Number.isSafeInteger(print_run) || print_run <= 0)
    ) {
      return NextResponse.json(
        {
          found: false,
          image_url: null,
          error: "Invalid print_run.",
        },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(
        "Sports image resolver: missing Supabase server configuration."
      );

      return NextResponse.json(
        {
          found: false,
          image_url: null,
          error: "Sports image resolver is not configured.",
        },
        { status: 503 }
      );
    }

    // Server-only client. Never expose this key
    // to the browser or a NEXT_PUBLIC variable.
    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    // Only approved raw images are eligible.
    // RLS is enabled, but the service role bypasses
    // it, so these restrictions are mandatory.
    const { data, error } = await supabase
      .from("sports_card_images")
      .select(
        [
          "id",
          "card_name",
          "year",
          "manufacturer",
          "release_name",
          "set_name",
          "card_number",
          "parallel_name",
          "print_run",
          "data_source",
          "external_id",
          "image_url",
          "image_source",
          "image_type",
          "verification_status",
          "usage_permission",
        ].join(",")
      )
      .eq("image_type", "raw")
      .eq("verification_status", "verified")
      .in("usage_permission", ["granted", "licensed"])
      .ilike("card_name", name)
      .limit(100);

    if (error) {
      console.error("Sports image resolver database error:", error);

      return NextResponse.json(
        {
          found: false,
          image_url: null,
          error: "Could not query the sports image registry.",
        },
        { status: 502 }
      );
    }

    const requested = {
      name,
      year,
      manufacturer,
      release_name,
      set_name,
      card_number,
      parallel_name,
      print_run,
    };

    const matches = ((data ?? []) as unknown as SportsImageRecord[])
      .filter((image) => sameIdentity(image, requested))
      .filter((image) => validImageUrl(image.image_url));

    // Never guess when several distinct images
    // match the same identity.
    const uniqueUrls = new Set(matches.map((image) => image.image_url));

    if (uniqueUrls.size !== 1) {
      return NextResponse.json(
        {
          found: false,
          image_url: null,
          reason:
            uniqueUrls.size > 1
              ? "ambiguous_verified_images"
              : "no_verified_raw_image",
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const image = matches[0];

    return NextResponse.json(
      {
        found: true,
        image_url: image.image_url,
        image_source: image.image_source,
        image_type: "raw",
        verified: true,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("Sports image resolver error:", error);

    return NextResponse.json(
      {
        found: false,
        image_url: null,
        error: "Unexpected sports image resolver error.",
      },
      { status: 500 }
    );
  }
}
