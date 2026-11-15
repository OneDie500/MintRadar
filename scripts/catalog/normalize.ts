
import type {
  ValidatedCatalogManifest,
  CatalogLanguage,
} from "./validate";

export type CatalogSetRow = {
  external_id: string;
  data_source: string;
  language: CatalogLanguage;
  name: string;
  category: string;
  code: string;
  card_count: number;
  released_at: string | null;
  set_type: string | null;
  series_id: string | null;
  logo_url: string | null;
  symbol_url: string | null;
  external_updated_at: string;
};

export type CatalogCardRow = {
  external_id: string;
  data_source: string;
  language: CatalogLanguage;
  name: string;
  set_name: string;
  set_id: string;
  card_number: string;
  image_url: string;
  category: string;
  rarity: string | null;
  edition: string | null;
  finish: string | null;
  // Import-only evidence; never insert into the cards table.
  printing_pattern?: string | null;
  canonical_name: string | null;
  canonical_external_id: string | null;
  canonical_language: string | null;
  canonical_confidence: number | null;
  external_updated_at: string;
};

export function normalizeCatalogManifest(
  manifest: ValidatedCatalogManifest,
  now: string = new Date().toISOString()
): {
  sets: CatalogSetRow[];
  cards: CatalogCardRow[];
} {
  const sets: CatalogSetRow[] = [];
  const cards: CatalogCardRow[] = [];

  for (const set of manifest.sets) {
    sets.push({
      external_id: set.id,
      data_source: manifest.source,
      language: manifest.language,
      name: set.name,
      category: manifest.category,
      code: set.id,
      card_count: set.cards.length,
      released_at: set.releaseDate ?? null,
      set_type: null,
      series_id: null,
      logo_url: null,
      symbol_url: null,
      external_updated_at: now,
    });

    for (const card of set.cards) {
      cards.push({
        external_id: `${set.id}-${card.id}`,
        data_source: manifest.source,
        language: manifest.language,
        name: card.name,
        set_name: set.name,
        set_id: set.id,
        card_number: card.collectorNumber ?? card.id,
        // Preserve the supplied source reference; publication rights must be
        // evaluated separately before using this URL in a public catalog.
        image_url: card.imageUrl?.trim() ?? "",
        category: manifest.category,
        rarity: card.rarity ?? null,
        edition: card.edition ?? null,
        finish: card.finish ?? null,
        printing_pattern: card.printingPattern ?? null,
        canonical_name: card.name,
        canonical_external_id: null,
        canonical_language: null,
        canonical_confidence: null,
        external_updated_at: now,
      });
    }
  }

  return { sets, cards };
}
