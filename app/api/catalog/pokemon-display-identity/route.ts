import { NextRequest, NextResponse } from "next/server";

type TCGdexCardBrief = {
  id?: string | null;
  localId?: string | number | null;
  name?: string | null;
};

type TCGdexCardDetail = TCGdexCardBrief & {
  set?: {
    id?: string | null;
    name?: string | null;
  } | null;
};

type PokemonSpecies = {
  name?: string | null;
  names?: Array<{
    language?: {
      name?: string | null;
    } | null;
    name?: string | null;
  }> | null;
};

const TCGDEX_BASE =
  "https://api.tcgdex.net/v2";

const POKEAPI_BASE =
  "https://pokeapi.co/api/v2";

function clean(value: string | null) {
  return (value || "").trim();
}

function tcgdexLanguage(
  language: string
) {
  const normalized =
    language.trim().toUpperCase();

  if (normalized === "JP") {
    return "ja";
  }

  if (normalized === "CN-TW") {
    return "zh-tw";
  }

  if (normalized === "CN") {
    return "zh-cn";
  }

  return "en";
}

async function fetchJson<T>(
  url: string
): Promise<T | null> {
  try {
    const response =
      await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function resolveExactEnglishCounterpart(
  setId: string,
  cardNumber: string
) {
  if (!setId || !cardNumber) {
    return null;
  }

  const id =
    `${setId}-${cardNumber}`;

  const card =
    await fetchJson<TCGdexCardDetail>(
      `${TCGDEX_BASE}/en/cards/${encodeURIComponent(
        id
      )}`
    );

  if (!card?.name) {
    return null;
  }

  return {
    cardName: card.name,
    setName:
      card.set?.name || null,
    method:
      "tcgdex-exact-english-counterpart",
  };
}

async function resolveEnglishSpeciesName(
  localizedName: string,
  language: string
) {
  if (!localizedName) {
    return null;
  }

  const sourceLanguage =
    tcgdexLanguage(language);

  // Search the localized TCGdex catalog for the exact localized name.
  const searchUrl =
    `${TCGDEX_BASE}/${sourceLanguage}/cards?name=${encodeURIComponent(
      localizedName
    )}`;

  const localizedCards =
    await fetchJson<TCGdexCardBrief[]>(
      searchUrl
    );

  if (
    !Array.isArray(localizedCards) ||
    localizedCards.length === 0
  ) {
    return null;
  }

  // TCGdex IDs can differ for regional releases, so the species itself
  // is resolved through PokéAPI's multilingual species-name data.
  // We query the species index once and match the exact localized name.
  const speciesIndex =
    await fetchJson<{
      results?: Array<{
        name?: string | null;
        url?: string | null;
      }>;
    }>(
      `${POKEAPI_BASE}/pokemon-species?limit=2000`
    );

  if (
    !speciesIndex?.results ||
    !Array.isArray(
      speciesIndex.results
    )
  ) {
    return null;
  }

  // Fetch species details in modest parallel chunks until an exact
  // localized species-name match is found.
  const candidates =
    speciesIndex.results.filter(
      (entry) => entry.url
    );

  const batchSize = 50;

  for (
    let index = 0;
    index < candidates.length;
    index += batchSize
  ) {
    const batch =
      candidates.slice(
        index,
        index + batchSize
      );

    const details =
      await Promise.all(
        batch.map((entry) =>
          fetchJson<PokemonSpecies>(
            entry.url as string
          )
        )
      );

    for (const species of details) {
      if (
        !species?.names ||
        !Array.isArray(species.names)
      ) {
        continue;
      }

      const localized =
        species.names.find(
          (entry) =>
            entry.language?.name ===
              sourceLanguage &&
            entry.name ===
              localizedName
        );

      if (!localized) {
        continue;
      }

      const english =
        species.names.find(
          (entry) =>
            entry.language?.name ===
            "en"
        );

      if (english?.name) {
        return {
          cardName: english.name,
          method:
            "pokemon-species-english-name",
        };
      }
    }
  }

  return null;
}

export async function GET(
  request: NextRequest
) {
  const params =
    request.nextUrl.searchParams;

  const name =
    clean(params.get("name"));

  const setName =
    clean(params.get("setName"));

  const setId =
    clean(params.get("setId"));

  const cardNumber =
    clean(params.get("cardNumber"));

  const language =
    clean(params.get("language")) ||
    "EN";

  if (!name) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing card name.",
      },
      {
        status: 400,
      }
    );
  }

  if (
    language.toUpperCase() ===
    "EN"
  ) {
    return NextResponse.json({
      ok: true,
      cardName: name,
      setName:
        setName || null,
      method:
        "already-english",
    });
  }

  const exact =
    await resolveExactEnglishCounterpart(
      setId,
      cardNumber
    );

  if (exact) {
    return NextResponse.json({
      ok: true,
      ...exact,
    });
  }

  const species =
    await resolveEnglishSpeciesName(
      name,
      language
    );

  if (species) {
    return NextResponse.json({
      ok: true,
      cardName:
        species.cardName,
      // A regional-only set may have no legitimate official English
      // counterpart. Preserve its source set name instead of inventing one.
      setName:
        setName || null,
      method:
        species.method,
    });
  }

  return NextResponse.json({
    ok: true,
    cardName: name,
    setName:
      setName || null,
    method:
      "preserve-source-name",
  });
}
