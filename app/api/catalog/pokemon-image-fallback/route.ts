import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type PokemonTcgCard = {
  id?: string;
  name?: string;
  number?: string;
  set?: {
    id?: string;
    name?: string;
  };
  images?: {
    small?: string;
    large?: string;
  };
};

type PokemonTcgResponse = {
  data?: PokemonTcgCard[];
};

type TcgdexCardBrief = {
  id?: string;
  localId?: string;
  name?: string;
  image?: string | null;
};

type TcgdexCardDetail = TcgdexCardBrief & {
  set?: {
    id?: string;
    name?: string;
  };
};

type FetchAttemptResult =
  | {
      ok: true;
      response: Response;
    }
  | {
      ok: false;
      status?: number;
      error?: string;
    };

type KnownImageOverride = {
  name: string;
  setName?: string;
  cardNumber?: string;
  imageUrl: string;
};

const KNOWN_IMAGE_OVERRIDES: KnownImageOverride[] = [
  {
    name: "Ancient Mew",
    setName: "Miscellaneous Promos",
    cardNumber: "001",
    imageUrl: "/card-overrides/pokemon/ancient-mew-001.jpg",
  },
];

function normalize(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeCardNumber(value?: string | null) {
  return (value || "")
    .trim()
    .replace(/^#/, "")
    .split("/")[0]
    .trim();
}

function normalizeSet(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bpokemon\b/g, " ")
    .replace(/\btrading card game\b/g, " ")
    .replace(/\bbase set\b/g, " ")
    .replace(/\btrainer gallery\b/g, " ")
    .replace(/\bgalarian gallery\b/g, " ")
    .replace(/\bshiny vault\b/g, " ")
    .replace(/\bpromo cards?\b/g, " promo ")
    .replace(/\bblack star promos?\b/g, " promo ")
    .replace(/\bblack star\b/g, " promo ")
    .replace(/\bsvp\b/g, " scarlet violet promo ")
    .replace(/\bsv\b/g, " scarlet violet ")
    .replace(/\bswsh\b/g, " sword shield ")
    .replace(/\bcelebrations classic collection\b/g, " celebrations ")
    .replace(/\bclassic collection\b/g, " celebrations ")
    .replace(/\bsun moon\b/g, " sun and moon ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setSimilarityScore(
  wanted?: string | null,
  actual?: string | null
) {
  const left = normalizeSet(wanted);
  const right = normalizeSet(actual);

  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 500;
  }

  if (
    left.includes(right) ||
    right.includes(left)
  ) {
    return 350;
  }

  const leftWords = new Set(
    left.split(" ").filter(Boolean)
  );

  const rightWords =
    right.split(" ").filter(Boolean);

  const overlap =
    rightWords.filter((word) =>
      leftWords.has(word)
    ).length;

  const denominator =
    Math.max(
      leftWords.size,
      rightWords.length
    );

  if (!denominator) {
    return 0;
  }

  const ratio =
    overlap / denominator;

  if (ratio >= 0.8) {
    return 300;
  }

  if (ratio >= 0.6) {
    return 220;
  }

  if (ratio >= 0.4) {
    return 125;
  }

  return overlap > 0 ? 40 : 0;
}

function escapeQueryValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}


const VARIANT_HINTS = [
  "poke ball pattern",
  "poké ball pattern",
  "master ball pattern",
  "masterball pattern",
  "reverse holo",
  "reverse holofoil",
  "holo",
  "holofoil",
  "full art",
  "alternate art",
  "alternate full art",
  "alt art",
  "illustration rare",
  "special illustration rare",
  "ultra rare",
  "secret rare",
  "rainbow rare",
  "gold",
];

function splitCanonicalNameAndVariant(
  value: string
) {
  const original = value.trim();

  const match =
    original.match(
      /^(.*?)\s*\(([^()]+)\)\s*$/
    );

  if (!match) {
    return {
      canonicalName: original,
      variant: null as string | null,
    };
  }

  const possibleName =
    match[1].trim();

  const possibleVariant =
    match[2].trim();

  const normalizedVariant =
    possibleVariant
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const looksLikeVariant =
    VARIANT_HINTS.some(
      (hint) =>
        normalizedVariant ===
          hint.replace(
            /[^a-z0-9]+/g,
            " "
          ) ||
        normalizedVariant.includes(
          hint.replace(
            /[^a-z0-9]+/g,
            " "
          )
        )
    );

  if (
    !possibleName ||
    !looksLikeVariant
  ) {
    return {
      canonicalName: original,
      variant: null as string | null,
    };
  }

  return {
    canonicalName: possibleName,
    variant: possibleVariant,
  };
}

function namesMatch(
  wantedName: string,
  actualName?: string | null
) {
  const wanted =
    normalize(wantedName);

  const actual =
    normalize(actualName);

  if (!wanted || !actual) {
    return {
      matched: false,
      exact: false,
    };
  }

  if (wanted === actual) {
    return {
      matched: true,
      exact: true,
    };
  }

  if (
    actual.includes(wanted) ||
    wanted.includes(actual)
  ) {
    return {
      matched: true,
      exact: false,
    };
  }

  return {
    matched: false,
    exact: false,
  };
}

function findKnownImageOverride({
  name,
  setName,
  cardNumber,
}: {
  name: string;
  setName?: string | null;
  cardNumber?: string | null;
}) {
  const wantedName = normalize(name);
  const wantedSet = normalize(setName);
  const wantedNumber = normalize(
    normalizeCardNumber(cardNumber)
  );

  return KNOWN_IMAGE_OVERRIDES.find((override) => {
    const overrideName =
      normalize(override.name);
    const overrideSet =
      normalize(override.setName);
    const overrideNumber =
      normalize(
        normalizeCardNumber(
          override.cardNumber
        )
      );

    if (overrideName !== wantedName) {
      return false;
    }

    if (
      overrideSet &&
      wantedSet &&
      overrideSet !== wantedSet
    ) {
      return false;
    }

    if (
      overrideNumber &&
      wantedNumber &&
      overrideNumber !== wantedNumber
    ) {
      return false;
    }

    return true;
  });
}


function buildCollectorNumberVariants(
  value?: string | null
) {
  const normalized =
    normalizeCardNumber(value);

  if (!normalized) {
    return [] as string[];
  }

  const compact =
    normalized
      .replace(/\s+/g, "")
      .toUpperCase();

  const variants =
    new Set<string>([
      normalized,
      compact,
    ]);

  const prefixed =
    compact.match(
      /^([A-Z]+)0*(\d+)$/
    );

  if (prefixed) {
    const prefix = prefixed[1];
    const digits = prefixed[2];

    variants.add(
      `${prefix}${digits}`
    );

    if (
      ["SVP", "SWSH", "SM", "XY", "CC"]
        .includes(prefix)
    ) {
      variants.add(
        String(Number(digits))
      );
    }
  }

  const numeric =
    compact.match(/^0*(\d+)$/);

  if (numeric) {
    variants.add(
      String(Number(numeric[1]))
    );
  }

  return Array.from(variants)
    .filter(Boolean);
}

function scoreCard(
  card: PokemonTcgCard,
  {
    name,
    setName,
    cardNumber,
  }: {
    name: string;
    setName?: string | null;
    cardNumber?: string | null;
  }
) {
  const parsedName =
    splitCanonicalNameAndVariant(
      name
    );

  const match =
    namesMatch(
      parsedName.canonicalName,
      card.name
    );

  if (!match.matched) {
    return -1;
  }

  const wantedNumber =
    normalize(
      normalizeCardNumber(
        cardNumber
      )
    );

  const cardNumberValue =
    normalize(
      normalizeCardNumber(
        card.number
      )
    );

  let score =
    match.exact
      ? 1000
      : 250;

  if (wantedNumber) {
    if (
      cardNumberValue ===
      wantedNumber
    ) {
      score += 700;
    } else {
      score -= 500;
    }
  }

  score += setSimilarityScore(
    setName,
    card.set?.name
  );

  if (card.images?.large) {
    score += 25;
  } else if (
    card.images?.small
  ) {
    score += 10;
  }

  return score;
}


function tcgdexImageUrl(
  imageBase?: string | null
) {
  if (!imageBase) {
    return null;
  }

  const clean = imageBase.replace(
    /\/+$/,
    ""
  );

  if (
    /\.(png|webp|jpe?g)$/i.test(clean)
  ) {
    return clean;
  }

  return `${clean}/high.png`;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs = 7000
): Promise<T | null> {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveTcgdexImage({
  name,
  setName,
  cardNumber,
}: {
  name: string;
  setName?: string | null;
  cardNumber?: string | null;
}) {
  const numberVariants =
    buildCollectorNumberVariants(
      cardNumber
    );

  const diagnostics: {
    requestedName: string;
    requestedSet: string | null;
    requestedNumber: string | null;
    numberVariants: string[];
    searchAttempts: Array<{
      url: string;
      resultCount: number | null;
    }>;
    candidatesFound: number;
    shortlistedCandidates: number;
    topCandidates: Array<{
      id: string | null;
      name: string | null;
      setName: string | null;
      cardNumber: string | null;
      imageBase: string | null;
      imageUrl: string | null;
      baseScore: number;
      setScore: number;
      finalScore: number;
      numberMatches: boolean;
    }>;
    rejectionReason: string | null;
  } = {
    requestedName: name,
    requestedSet: setName || null,
    requestedNumber: cardNumber || null,
    numberVariants,
    searchAttempts: [],
    candidatesFound: 0,
    shortlistedCandidates: 0,
    topCandidates: [],
    rejectionReason: null,
  };

  const listAttempts: URL[] = [];

  for (const numberVariant of numberVariants) {
    const url = new URL(
      "https://api.tcgdex.net/v2/en/cards"
    );

    url.searchParams.set(
      "name",
      name
    );
    url.searchParams.set(
      "localId",
      numberVariant
    );

    listAttempts.push(url);
  }

  const broadUrl = new URL(
    "https://api.tcgdex.net/v2/en/cards"
  );
  broadUrl.searchParams.set(
    "name",
    name
  );
  listAttempts.push(broadUrl);

  const briefs: TcgdexCardBrief[] = [];
  const seen = new Set<string>();

  for (const url of listAttempts) {
    const rows =
      await fetchJsonWithTimeout<
        TcgdexCardBrief[]
      >(url.toString());

    diagnostics.searchAttempts.push({
      url: url.toString(),
      resultCount:
        Array.isArray(rows)
          ? rows.length
          : null,
    });

    if (!Array.isArray(rows)) {
      continue;
    }

    for (const row of rows) {
      if (
        !row?.id ||
        seen.has(row.id)
      ) {
        continue;
      }

      seen.add(row.id);
      briefs.push(row);
    }

    if (briefs.length >= 40) {
      break;
    }
  }

  diagnostics.candidatesFound =
    briefs.length;

  if (!briefs.length) {
    diagnostics.rejectionReason =
      "no-tcgdex-candidates";

    return {
      match: null,
      diagnostics,
    };
  }

  const wantedName =
    normalize(name);

  const wantedNumbers =
    new Set(
      numberVariants.map((value) =>
        normalize(
          normalizeCardNumber(value)
        )
      )
    );

  const scoredBriefs = briefs
    .map((card) => {
      const candidateName =
        normalize(card.name);
      const candidateNumber =
        normalize(
          normalizeCardNumber(
            card.localId
          )
        );

      let score = 0;

      if (
        candidateName === wantedName
      ) {
        score += 1000;
      } else if (
        candidateName.includes(
          wantedName
        ) ||
        wantedName.includes(
          candidateName
        )
      ) {
        score += 250;
      } else {
        score -= 1000;
      }

      if (
        wantedNumbers.size &&
        wantedNumbers.has(
          candidateNumber
        )
      ) {
        score += 800;
      } else if (
        wantedNumbers.size
      ) {
        score -= 700;
      }

      if (card.image) {
        score += 25;
      }

      return {
        card,
        score,
      };
    })
    .sort(
      (a, b) => b.score - a.score
    );

  const shortlist = scoredBriefs
    .filter(
      ({ score }) => score >= 1000
    )
    .slice(0, 12);

  diagnostics.shortlistedCandidates =
    shortlist.length;

  const detailed = await Promise.all(
    shortlist.map(
      async ({ card, score }) => {
        if (!card.id) {
          return null;
        }

        const detail =
          await fetchJsonWithTimeout<
            TcgdexCardDetail
          >(
            `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(
              card.id
            )}`
          );

        if (!detail) {
          return null;
        }

        const setScore =
          setSimilarityScore(
            setName,
            detail.set?.name
          );

        const candidateNumber =
          normalize(
            normalizeCardNumber(
              detail.localId
            )
          );

        const numberMatches =
          !wantedNumbers.size ||
          wantedNumbers.has(
            candidateNumber
          );

        return {
          card: detail,
          baseScore: score,
          score: score + setScore,
          setScore,
          numberMatches,
        };
      }
    )
  );

  const ranked = detailed
    .filter(
      (
        entry
      ): entry is NonNullable<
        typeof entry
      > => Boolean(entry)
    )
    .sort(
      (a, b) => b.score - a.score
    );

  diagnostics.topCandidates =
    ranked
      .slice(0, 8)
      .map((entry) => ({
        id:
          entry.card.id || null,
        name:
          entry.card.name || null,
        setName:
          entry.card.set?.name || null,
        cardNumber:
          entry.card.localId || null,
        imageBase:
          entry.card.image || null,
        imageUrl:
          tcgdexImageUrl(
            entry.card.image
          ),
        baseScore:
          entry.baseScore,
        setScore:
          entry.setScore,
        finalScore:
          entry.score,
        numberMatches:
          entry.numberMatches,
      }));

  const best = ranked[0];

  if (!best) {
    diagnostics.rejectionReason =
      shortlist.length
        ? "tcgdex-detail-fetch-failed"
        : "no-candidate-passed-brief-confidence";

    // If nothing reached the detail stage, still expose the best brief
    // candidates so we can see their IDs/numbers/images.
    if (!diagnostics.topCandidates.length) {
      diagnostics.topCandidates =
        scoredBriefs
          .slice(0, 8)
          .map(({ card, score }) => ({
            id: card.id || null,
            name: card.name || null,
            setName: null,
            cardNumber:
              card.localId || null,
            imageBase:
              card.image || null,
            imageUrl:
              tcgdexImageUrl(
                card.image
              ),
            baseScore: score,
            setScore: 0,
            finalScore: score,
            numberMatches:
              !wantedNumbers.size ||
              wantedNumbers.has(
                normalize(
                  normalizeCardNumber(
                    card.localId
                  )
                )
              ),
          }));
    }

    return {
      match: null,
      diagnostics,
    };
  }

  if (
    cardNumber &&
    !best.numberMatches
  ) {
    diagnostics.rejectionReason =
      "collector-number-mismatch";

    return {
      match: null,
      diagnostics,
    };
  }

  if (
    setName &&
    best.setScore <= 0
  ) {
    diagnostics.rejectionReason =
      "set-mismatch";

    return {
      match: null,
      diagnostics,
    };
  }

  const imageUrl =
    tcgdexImageUrl(
      best.card.image
    );

  if (!imageUrl) {
    diagnostics.rejectionReason =
      "matched-card-has-no-image";

    return {
      match: null,
      diagnostics,
    };
  }

  diagnostics.rejectionReason = null;

  return {
    match: {
      imageUrl,
      match: {
        id: best.card.id || null,
        name:
          best.card.name || null,
        setName:
          best.card.set?.name || null,
        cardNumber:
          best.card.localId || null,
        score: best.score,
      },
    },
    diagnostics,
  };
}

function wait(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function isRetryableStatus(status: number) {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function fetchPokemonCards(
  url: string,
  apiKey: string
): Promise<FetchAttemptResult> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 10000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
      };
    }

    return {
      ok: true,
      response,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown upstream request error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runProviderQuery(
  query: string,
  apiKey: string
) {
  const url = new URL(
    "https://api.pokemontcg.io/v2/cards"
  );

  url.searchParams.set("q", query);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set(
    "select",
    "id,name,number,set,images"
  );

  const requestUrl = url.toString();

  let result =
    await fetchPokemonCards(
      requestUrl,
      apiKey
    );

  const shouldRetry =
    !result.ok &&
    (
      (
        result.status !== undefined &&
        isRetryableStatus(
          result.status
        )
      ) ||
      result.status === undefined
    );

  if (shouldRetry) {
    // Round 8: aborted/network failures used to skip the retry path
    // entirely because they have no HTTP status. Give the provider
    // one clean second attempt before declaring it unavailable.
    await wait(750);

    result =
      await fetchPokemonCards(
        requestUrl,
        apiKey
      );
  }

  if (!result.ok) {
    return {
      ok: false as const,
      cards: [] as PokemonTcgCard[],
      status: result.status,
      error: result.error,
    };
  }

  const payload =
    (await result.response.json()) as PokemonTcgResponse;

  return {
    ok: true as const,
    cards: payload.data || [],
  };
}

function dedupeCards(
  cards: PokemonTcgCard[]
) {
  const seen = new Set<string>();

  return cards.filter((card) => {
    const key =
      card.id ||
      [
        normalize(card.name),
        normalize(card.set?.name),
        normalize(card.number),
      ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export async function GET(request: NextRequest) {
  try {
    const name =
      request.nextUrl.searchParams
        .get("name")
        ?.trim() || "";

    const setName =
      request.nextUrl.searchParams
        .get("setName")
        ?.trim() || null;

    const rawCardNumber =
      request.nextUrl.searchParams
        .get("cardNumber")
        ?.trim() || null;

    const cardNumber =
      normalizeCardNumber(
        rawCardNumber
      ) || null;

    const parsedName =
      splitCanonicalNameAndVariant(
        name
      );

    const canonicalName =
      parsedName.canonicalName;

    const variant =
      parsedName.variant;

    if (!name) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          error: "Card name is required.",
        },
        { status: 400 }
      );
    }

    // -----------------------------------------
    // KNOWN MINT RADAR OVERRIDES
    // -----------------------------------------

    const knownOverride =
      findKnownImageOverride({
        name,
        setName,
        cardNumber,
      });

    if (knownOverride) {
      return NextResponse.json({
        ok: true,
        imageUrl: knownOverride.imageUrl,
        provider: "mintradar-override",
        match: {
          name: knownOverride.name,
          setName:
            knownOverride.setName || null,
          cardNumber:
            knownOverride.cardNumber || null,
        },
      });
    }

    // -----------------------------------------
    // TCGDEX PRIMARY IMAGE RESOLVER
    // -----------------------------------------

    const tcgdexResult =
      await resolveTcgdexImage({
        name: canonicalName,
        setName,
        cardNumber,
      });

    if (tcgdexResult.match) {
      return NextResponse.json({
        ok: true,
        imageUrl:
          tcgdexResult.match.imageUrl,
        provider: "tcgdex",
        match:
          tcgdexResult.match.match,
        tcgdexDiagnostics:
          tcgdexResult.diagnostics,
      });
    }

    const tcgdexDiagnostics =
      tcgdexResult.diagnostics;

    // -----------------------------------------
    // POKEMON TCG API FALLBACK
    // -----------------------------------------

    const apiKey =
      process.env.POKEMON_TCG_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          error:
            "Pokémon image fallback is not configured.",
        },
        { status: 503 }
      );
    }

    const safeName =
      escapeQueryValue(
        canonicalName
      );

    const queryAttempts: string[] = [];

    // Promo/subset collector numbers are not represented consistently
    // upstream, so try both the prefixed and numeric forms.
    for (
      const numberVariant of
      buildCollectorNumberVariants(
        cardNumber
      )
    ) {
      queryAttempts.push(
        `name:"${safeName}" number:"${escapeQueryValue(
          numberVariant
        )}"`
      );
    }

    // Keep the broad name lookup so local set/number scoring can recover
    // records where the prefix lives in the set rather than card.number.
    queryAttempts.push(
      `name:"${safeName}"`
    );

    const uniqueQueries =
      Array.from(
        new Set(queryAttempts)
      );

    let allCards: PokemonTcgCard[] = [];
    let lastUpstreamStatus:
      | number
      | undefined;
    let lastUpstreamError:
      | string
      | undefined;

    for (
      const query of uniqueQueries
    ) {
      const result =
        await runProviderQuery(
          query,
          apiKey
        );

      if (!result.ok) {
        lastUpstreamStatus =
          result.status;
        lastUpstreamError =
          result.error;
        continue;
      }

      allCards = dedupeCards([
        ...allCards,
        ...result.cards,
      ]);

      const rankedSoFar =
        allCards
          .map((card) => ({
            card,
            score: scoreCard(
              card,
              {
                name: canonicalName,
                setName,
                cardNumber,
              }
            ),
          }))
          .filter(
            ({ card, score }) =>
              score >= 1000 &&
              Boolean(
                card.images?.large ||
                card.images?.small
              )
          )
          .sort(
            (a, b) =>
              b.score - a.score
          );

      const currentBest =
        rankedSoFar[0];

      // Exact name + exact collector number is already a very strong
      // match. If set similarity also contributes, there is no reason
      // to make another broad provider request.
      if (
        currentBest &&
        currentBest.score >= 1700
      ) {
        break;
      }
    }

    if (
      allCards.length === 0 &&
      (lastUpstreamStatus ||
        lastUpstreamError)
    ) {
      return NextResponse.json(
        {
          ok: false,
          imageUrl: null,
          provider:
            "pokemon-tcg-api",
          upstreamStatus:
            lastUpstreamStatus || null,
          error:
            lastUpstreamError || null,
          reason:
            "upstream-unavailable",
          tcgdexDiagnostics,
        },
        { status: 502 }
      );
    }

    const ranked =
      allCards
        .map((card) => ({
          card,
          score: scoreCard(
            card,
            {
              name: canonicalName,
              setName,
              cardNumber,
            }
          ),
        }))
        .filter(
          ({ card, score }) =>
            score >= 1000 &&
            Boolean(
              card.images?.large ||
              card.images?.small
            )
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

    const bestEntry = ranked[0];
    const secondEntry = ranked[1];

    if (!bestEntry) {
      const topRejectedCandidates =
        allCards
          .map((card) => ({
            card,
            score: scoreCard(
              card,
              {
                name: canonicalName,
                setName,
                cardNumber,
              }
            ),
          }))
          .sort(
            (a, b) =>
              b.score - a.score
          )
          .slice(0, 8)
          .map(({ card, score }) => ({
            id: card.id || null,
            name: card.name || null,
            setName:
              card.set?.name || null,
            cardNumber:
              card.number || null,
            hasImage: Boolean(
              card.images?.large ||
              card.images?.small
            ),
            imageUrl:
              card.images?.large ||
              card.images?.small ||
              null,
            score,
          }));

      return NextResponse.json({
        ok: false,
        imageUrl: null,
        provider:
          "pokemon-tcg-api",
        reason:
          "no-confident-match",
        diagnostics: {
          requestedName: name,
          canonicalName,
          variant,
          requestedSet:
            setName || null,
          requestedNumber:
            cardNumber || null,
          candidatesChecked:
            allCards.length,
          topRejectedCandidates,
        },
        tcgdexDiagnostics,
      });
    }

    // If no collector number was supplied and two printings are nearly
    // tied, do not guess which artwork belongs to the user's card.
    if (
      !cardNumber &&
      secondEntry &&
      bestEntry.score -
        secondEntry.score <
        100
    ) {
      return NextResponse.json({
        ok: false,
        imageUrl: null,
        provider:
          "pokemon-tcg-api",
        reason:
          "ambiguous-match",
        diagnostics: {
          requestedName: name,
          canonicalName,
          variant,
          requestedSet:
            setName || null,
          candidatesChecked:
            allCards.length,
        },
      });
    }

    const best = bestEntry.card;

    return NextResponse.json({
      ok: true,
      imageUrl:
        best.images?.large ||
        best.images?.small ||
        null,
      provider:
        "pokemon-tcg-api",
      match: {
        id: best.id || null,
        name: best.name || null,
        number:
          best.number || null,
        setId:
          best.set?.id || null,
        setName:
          best.set?.name || null,
      },
      diagnostics: {
        requestedName: name,
        canonicalName,
        variant,
        requestedNumber:
          cardNumber || null,
        candidatesChecked:
          allCards.length,
        score:
          bestEntry.score,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error";

    return NextResponse.json(
      {
        ok: false,
        imageUrl: null,
        provider:
          "pokemon-tcg-api",
        error: message,
      },
      { status: 502 }
    );
  }
}
