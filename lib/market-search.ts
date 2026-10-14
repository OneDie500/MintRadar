
/** Shared, provider-aware card search terms for MintRadar market links. */
export type MarketSearchCard = {
  name?: string | null;
  canonical_name?: string | null;
  set_name?: string | null;
  card_number?: string | null;
  category?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  release_name?: string | null;
  parallel_name?: string | null;
  edition?: string | null;
  finish?: string | null;
  language?: string | null;
  variant?: string | null;
};

export type MarketSearchProvider =
  | "tcgplayer"
  | "pricecharting"
  | "ebay"
  | "130point"
  | "cardladder";

function tidy(value?: string | null): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function join(...parts: Array<string | null | undefined>): string {
  return parts.map(tidy).filter(Boolean).join(" ");
}

function cardName(card: MarketSearchCard): string {
  const onePiece = /one\s*piece/i.test(card.category || "");
  const original = onePiece && tidy(card.canonical_name)
    ? card.canonical_name
    : card.name;

  return tidy(original).replace(
    /\bTeam Rocket['’]S\b/gi,
    "Team Rocket's"
  );
}

function number(card: MarketSearchCard): string {
  return tidy(card.card_number).replace(/^#/, "");
}

function isSports(card: MarketSearchCard): boolean {
  return /sports|baseball|basketball|football|soccer|hockey|wrestling|racing|golf/i.test(
    card.category || ""
  );
}

/**
 * Preserve identifying card numbers, ex/EX/VSTAR,
 * and meaningful variants.
 *
 * Generic foil finishes often make marketplace
 * searches unnecessarily restrictive.
 */
export function marketSearchQuery(
  card: MarketSearchCard,
  provider: MarketSearchProvider,
  grading?: {
    company?: string | null;
    grade?: string | null;
  }
): string {
  const name = cardName(card);
  const id = number(card);
  const sports = isSports(card);

  const variant = tidy(
    card.parallel_name || card.variant || card.edition
  );

  const grade = join(
    grading?.company,
    grading?.grade
  );

  const language = /^(JP|JA|CN|ZH|KR|KO)$/i.test(
    tidy(card.language)
  )
    ? tidy(card.language).toUpperCase()
    : "";

  if (sports) {
    return join(
      card.year,
      card.manufacturer,
      card.release_name || card.set_name,
      name,
      id,
      variant,
      grade
    );
  }

  switch (provider) {
    case "tcgplayer":
    case "pricecharting":
      return join(
        name,
        id,
        variant &&
          !/^(holo|holofoil|reverse holo|reverse holofoil|non-holo|non holo)$/i.test(
            variant
          )
          ? variant
          : "",
        language,
        grade
      );

    case "ebay":
    case "130point":
    case "cardladder":
      return join(
        name,
        id,
        variant,
        language,
        grade
      );
  }
}

export function marketSearchFallbacks(
  card: MarketSearchCard
): string[] {
  const name = cardName(card);
  const id = number(card);

  return [
    ...new Set(
      [
        join(name, id),
        name
      ].filter(Boolean)
    )
  ];
}
