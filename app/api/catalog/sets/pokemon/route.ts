import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type CatalogSetRow = {
  external_id: string;
  name: string;
  category: string;
  code: string | null;
  card_count: number | null;
  released_at: string | null;
  set_type: string | null;
  logo_url: string | null;
  symbol_url: string | null;
};

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase environment variables are not configured."
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from("catalog_sets")
      .select(
        `
          external_id,
          name,
          category,
          code,
          card_count,
          released_at,
          set_type,
          logo_url,
          symbol_url
        `
      )
      .eq("data_source", "tcgdex")
      .eq("category", "Pokemon")
      .order("released_at", { ascending: false, nullsFirst: false })
      .order("name", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as CatalogSetRow[];

    const results = rows.map((set) => ({
      id: set.external_id,
      name: set.name,
      category: "Pokemon" as const,
      code: set.code ?? set.external_id,
      cardCount: set.card_count,
      releasedAt: set.released_at,
      setType: set.set_type,
      logoUrl: set.logo_url,
      symbolUrl: set.symbol_url,
    }));

    return NextResponse.json({
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("Pokémon set catalog error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Pokémon set catalog is unavailable.",
        results: [],
      },
      { status: 500 }
    );
  }
}
