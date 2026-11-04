
export type CatalogLanguage = "EN" | "JP" | "CN" | "CN-TW";

export type CatalogCard = {
  id: string;
  name: string;
  imageUrl?: string;
  rarity?: string;
  finish?: string;
  edition?: string;
};

export type CatalogSet = {
  id: string;
  name: string;
  releaseDate?: string;
  cards: CatalogCard[];
};

export type CatalogManifest = {
  source: string;
  category?: string;
  language?: CatalogLanguage;
  sets: CatalogSet[];
};

export type ValidatedCatalogManifest = {
  source: string;
  category: string;
  language: CatalogLanguage;
  sets: CatalogSet[];
};

const LANGUAGES = new Set(["EN", "JP", "CN", "CN-TW"]);

function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid or missing ${field}`);
  }

  return value.trim();
}

export function validateCatalogManifest(
  input: unknown
): ValidatedCatalogManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Manifest must be an object");
  }

  const raw = input as Record<string, unknown>;

  const source = required(raw.source, "source");

  if (!/^[a-z][a-z0-9_]{2,50}$/.test(source)) {
    throw new Error("Invalid source identifier");
  }

  const category = required(raw.category ?? "Pokemon", "category");
  const language = required(raw.language ?? "EN", "language");

  if (!LANGUAGES.has(language)) {
    throw new Error(`Unsupported language: ${language}`);
  }

  if (!Array.isArray(raw.sets) || raw.sets.length === 0) {
    throw new Error("Manifest requires at least one set");
  }

  const seenSets = new Set<string>();

  const sets: CatalogSet[] = raw.sets.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Invalid set at index ${index}`);
    }

    const set = entry as Record<string, unknown>;

    const id = required(set.id, `sets[${index}].id`);
    const name = required(set.name, `sets[${index}].name`);

    if (seenSets.has(id)) {
      throw new Error(`Duplicate set ID: ${id}`);
    }

    seenSets.add(id);

    if (!Array.isArray(set.cards) || set.cards.length === 0) {
      throw new Error(`Set ${id} has no cards`);
    }

    const seenCards = new Set<string>();

    const cards: CatalogCard[] = set.cards.map((cardEntry, cardIndex) => {
      if (!cardEntry || typeof cardEntry !== "object") {
        throw new Error(`Invalid card in ${id} at ${cardIndex}`);
      }

      const card = cardEntry as Record<string, unknown>;

      const cardId = required(
        card.id,
        `${id}.cards[${cardIndex}].id`
      );

      const cardName = required(
        card.name,
        `${id}.cards[${cardIndex}].name`
      );

      if (seenCards.has(cardId)) {
        throw new Error(`Duplicate card ID in ${id}: ${cardId}`);
      }

      seenCards.add(cardId);

      const result: CatalogCard = {
        id: cardId,
        name: cardName,
      };

      for (const field of [
        "imageUrl",
        "rarity",
        "finish",
        "edition",
      ] as const) {
        const value = card[field];

        if (value !== undefined && value !== null) {
          if (typeof value !== "string") {
            throw new Error(`Invalid ${field} for ${id}-${cardId}`);
          }

          result[field] = value.trim();
        }
      }

      return result;
    });

    const result: CatalogSet = {
      id,
      name,
      cards,
    };

    if (set.releaseDate !== undefined && set.releaseDate !== null) {
      const date = required(set.releaseDate, `${id}.releaseDate`);

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`Invalid release date for ${id}`);
      }

      const parsed = new Date(`${date}T00:00:00Z`);

      if (
        Number.isNaN(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date
      ) {
        throw new Error(`Invalid release date for ${id}`);
      }

      result.releaseDate = date;
    }

    return result;
  });

  return {
    source,
    category,
    language: language as CatalogLanguage,
    sets,
  };
}
