
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CatalogCardRow,
  CatalogSetRow,
} from "./normalize";

export type ExistingCard = {
  external_id: string;
  data_source: string;
  language: string;
  category: string | null;
  name: string | null;
  edition: string | null;
  finish: string | null;
  set_name: string | null;
  card_number: string | null;
  image_url: string | null;
  canonical_name: string | null;
  canonical_external_id: string | null;
  canonical_language: string | null;
  canonical_confidence: number | null;
};

export type ExistingSet = {
  external_id: string;
  data_source: string;
  language: string;
};

export type CrossProviderOverlap = {
  incoming_external_id: string;
  incoming_source: string;
  existing_external_id: string;
  existing_source: string;
  language: string;
  set_name: string;
  card_number: string;
  incoming_name: string;
  existing_name: string;
  incoming_edition: string;
  existing_edition: string;
  incoming_finish: string;
  existing_finish: string;
  review_status: "POSSIBLE_SAME_PRINTING" | "PRINTING_CONFLICT" | "INSUFFICIENT_EVIDENCE";
  review_reason: string;
};

export type ReconciliationResult = {
  sets: CatalogSetRow[];
  cards: CatalogCardRow[];

  existingCards: ExistingCard[];
  newCards: CatalogCardRow[];

  existingSets: ExistingSet[];
  newSets: CatalogSetRow[];

  crossProviderOverlaps: CrossProviderOverlap[];

  skippedSets: number;
  quarantined: Array<{
    external_id: string;
    reason: string;
  }>;
};

function sourceKey(
  source: string,
  language: string,
  id: string
): string {
  return JSON.stringify([source, language, id]);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function physicalKey(
  category: string,
  language: string,
  setName: string,
  cardNumber: string
): string {
  return JSON.stringify([
    normalizeText(category),
    language,
    normalizeText(setName),
    normalizeText(cardNumber),
  ]);
}

// Only recognize explicit, known printing-pattern tokens. Do not infer
// patterns from arbitrary provider ID suffixes or rarity labels.
function declaredPrintingPatterns(name: string, externalId: string, explicitPattern?: string | null): Set<string> {
  const tokens = [normalizeText(name), normalizeText(externalId), normalizeText(explicitPattern ?? "")];
  const patterns = new Set<string>();
  if (tokens.some((token) => token.includes("masterballpattern"))) {
    patterns.add("master_ball_pattern");
  }
  if (tokens.some((token) => token.includes("pokeballpattern"))) {
    patterns.add("poke_ball_pattern");
  }
  return patterns;
}

// Some providers append the collector number to the display name, e.g.
// "Dark Slowbro (29)". Remove it only when it exactly matches the
// separately supplied card number. Never strip arbitrary parentheticals.
function comparisonName(name: string, cardNumber: string): string {
  const match = name.trim().match(/^(.*?)\s*\(([^()]*)\)\s*$/u);
  if (match && normalizeText(match[2]) === normalizeText(cardNumber) && normalizeText(cardNumber)) {
    return normalizeText(match[1]);
  }
  return normalizeText(name);
}

// Diagnostic-only. A matching name/finish/edition is not proof of
// physical-printing equivalence. Unknown attributes never imply equality.
function printingReview(
  incoming: CatalogCardRow,
  existing: ExistingCard
): Pick<CrossProviderOverlap, "review_status" | "review_reason"> {
  const aName = comparisonName(incoming.name, incoming.card_number);
  const bName = comparisonName(existing.name ?? "", existing.card_number ?? "");
  const aEdition = normalizeText(incoming.edition ?? "");
  const bEdition = normalizeText(existing.edition ?? "");
  const aFinish = normalizeText(incoming.finish ?? "");
  const bFinish = normalizeText(existing.finish ?? "");

  const incomingPatterns = declaredPrintingPatterns(incoming.name, incoming.external_id, incoming.printing_pattern);
  const existingPatterns = declaredPrintingPatterns(existing.name ?? "", existing.external_id ?? "");
  const patternDifference = [...new Set([...incomingPatterns, ...existingPatterns])]
    .some((pattern) => incomingPatterns.has(pattern) !== existingPatterns.has(pattern));
  if (patternDifference) {
    // Diagnostic conflict only. A missing marker is not proof of a standard
    // printing, and no records are merged or approved based on this result.
    return { review_status: "PRINTING_CONFLICT", review_reason: "different_explicit_printing_pattern" };
  }

  // Unknown declared patterns cannot be treated as matching verified printings.
  // Keep the original text for diagnostics, but never infer equivalence.
  const explicit = normalizeText(incoming.printing_pattern ?? "");
  if (explicit && incomingPatterns.size === 0) {
    return { review_status: "INSUFFICIENT_EVIDENCE", review_reason: "unrecognized_explicit_printing_pattern" };
  }

  // Explicit name differences can indicate named parallels/patterns.
  if (aName && bName && aName !== bName) {
    return { review_status: "PRINTING_CONFLICT", review_reason: "different_card_or_pattern_name" };
  }
  if (aEdition && bEdition && aEdition !== bEdition) {
    return { review_status: "PRINTING_CONFLICT", review_reason: "different_edition" };
  }
  if (aFinish && bFinish && aFinish !== bFinish) {
    return { review_status: "PRINTING_CONFLICT", review_reason: "different_finish" };
  }
  if (!aName || !bName || !aEdition || !bEdition || !aFinish || !bFinish) {
    return { review_status: "INSUFFICIENT_EVIDENCE", review_reason: "one_or_more_identity_attributes_missing" };
  }
  return { review_status: "POSSIBLE_SAME_PRINTING", review_reason: "matching_declared_attributes_not_verified" };
}

export async function reconcileCatalog(
  supabase: SupabaseClient,
  sets: CatalogSetRow[],
  cards: CatalogCardRow[]
): Promise<ReconciliationResult> {
  const existingSourceIds = new Set<string>();

  const existingPhysicalIds = new Map<
    string,
    ExistingCard[]
  >();

  const existingCardMap = new Map<
    string,
    ExistingCard
  >();

  const existingCards: ExistingCard[] = [];
  const newCards: CatalogCardRow[] = [];

  const existingSets: ExistingSet[] = [];
  const newSets: CatalogSetRow[] = [];

  const crossProviderOverlaps: CrossProviderOverlap[] = [];

  const categories = [
    ...new Set(cards.map((card) => card.category)),
  ];

  // Read existing records without modifying Supabase.
  // Pagination prevents the default 1,000-row response cap.
  for (const category of categories) {
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from("cards")
        .select(
          [
            "external_id",
            "data_source",
            "language",
            "category",
            "name",
            "edition",
            "finish",
            "set_name",
            "card_number",
            "image_url",
            "canonical_name",
            "canonical_external_id",
            "canonical_language",
            "canonical_confidence",
          ].join(",")
        )
        .eq("category", category)
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(
          `Card reconciliation failed: ${error.message}`
        );
      }

      // Supabase's generated database types may not describe
      // this dynamic select correctly. The selected columns
      // are explicitly defined above.
      const rows = (data ?? []) as unknown as ExistingCard[];

      for (const row of rows) {
        if (row.data_source && row.external_id) {
          const identity = sourceKey(
            row.data_source,
            row.language,
            row.external_id
          );

          existingSourceIds.add(identity);
          existingCardMap.set(identity, row);
        }

        if (row.set_name && row.card_number) {
          const key = physicalKey(
            row.category ?? category,
            row.language,
            row.set_name,
            row.card_number
          );

          const matches = existingPhysicalIds.get(key) ?? [];
          matches.push(row);
          existingPhysicalIds.set(key, matches);
        }
      }

      if (rows.length < pageSize) break;

      offset += pageSize;
    }
  }

  const seenIncomingSourceIds = new Set<string>();

  for (const card of cards) {
    const identity = sourceKey(
      card.data_source,
      card.language,
      card.external_id
    );

    if (seenIncomingSourceIds.has(identity)) {
      throw new Error(
        `Duplicate source identity in manifest: ${card.data_source}/${card.language}/${card.external_id}`
      );
    }

    seenIncomingSourceIds.add(identity);

    const existing = existingCardMap.get(identity);

    if (existing) {
      existingCards.push(existing);
    } else {
      newCards.push(card);
    }

    // Physical overlaps are informational.
    // They never automatically discard incoming provider records.
    const physical = physicalKey(
      card.category,
      card.language,
      card.set_name,
      card.card_number
    );

    const matches = existingPhysicalIds.get(physical) ?? [];

    for (const match of matches) {
      if (
        match.data_source &&
        match.external_id &&
        match.data_source !== card.data_source
      ) {
        crossProviderOverlaps.push({
          incoming_external_id: card.external_id,
          incoming_source: card.data_source,
          existing_external_id: match.external_id,
          existing_source: match.data_source,
          language: card.language,
          set_name: card.set_name,
          card_number: card.card_number,
          incoming_name: card.name,
          existing_name: match.name ?? "",
          incoming_edition: card.edition ?? "",
          existing_edition: match.edition ?? "",
          incoming_finish: card.finish ?? "",
          existing_finish: match.finish ?? "",
          ...printingReview(card, match),
        });
      }
    }
  }

  // Reconcile set identities.
  for (const set of sets) {
    const { data, error } = await supabase
      .from("catalog_sets")
      .select("external_id,data_source,language")
      .eq("data_source", set.data_source)
      .eq("language", set.language)
      .eq("external_id", set.external_id)
      .limit(1);

    if (error) {
      throw new Error(
        `Set reconciliation failed: ${error.message}`
      );
    }

    if (data?.length) {
      existingSets.push(data[0] as ExistingSet);
    } else {
      newSets.push(set);
    }
  }

  return {
    sets,
    cards,
    existingCards,
    newCards,
    existingSets,
    newSets,
    crossProviderOverlaps,
    skippedSets: 0,
    quarantined: [],
  };
}
