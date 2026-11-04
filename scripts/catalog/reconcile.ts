
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
