
export type MintRadarDisplayCard = {
  name?: string | null;
  card_number?: string | null;
  category?: string | null;
  language?: string | null;
  variant?: string | null;
  edition?: string | null;
  rarity?: string | null;
  finish?: string | null;
};

type DisplayIdentity = {
  name: string;
  descriptors: string[];
};

const KNOWN_TAGS: Record<string, string> = {
  "alternate art": "Alternate Art",
  parallel: "Parallel",
  "full art": "Full Art",
  secret: "Secret Rare",
  "secret rare": "Secret Rare",
  sec: "SEC",
  "cosmo holo": "Cosmo Holo",
  "cosmos holo": "Cosmo Holo",
  "sp": "SP",
  "sp ver": "SP Ver.",
  "sp ver.": "SP Ver.",
  "pokemon center exclusive": "Pokémon Center Exclusive",
  "pokémon center exclusive": "Pokémon Center Exclusive",
  "holiday calendar": "Holiday Calendar",
  "one piece day": "One Piece Day",
};

function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function cardNumberMatches(
  tag: string,
  cardNumber?: string | null
): boolean {
  if (!cardNumber) return false;

  const clean = (value: string) =>
    value
      .trim()
      .replace(/^#/, "")
      .toUpperCase()
      .replace(/\s+/g, "");

  const requested = clean(tag);
  const actual = clean(cardNumber);

  if (requested === actual) return true;

  if (/^\d+$/.test(requested)) {
    const suffix = actual.match(
      /(?:^|[- ])(\d+)(?:\/\d+)?$/
    );

    if (suffix && suffix[1] === requested) {
      return true;
    }

    const promoSuffix = actual.match(
      /[A-Z]+(\d+)$/
    );

    if (
      promoSuffix &&
      promoSuffix[1] === requested
    ) {
      return true;
    }
  }

  return false;
}

function normalizeCharacterName(
  name: string
): string {
  return name
    .replace(
      /^Monkey D Luffy\b/i,
      "Monkey D. Luffy"
    )
    .replace(
      /^Marshall\.D\.Teach\b/i,
      "Marshall D. Teach"
    )
    .replace(
      /^Portgas\.D\.Ace\b/i,
      "Portgas D. Ace"
    )
    .trim();
}

export function getCardDisplayIdentity(
  card?: MintRadarDisplayCard | null
): DisplayIdentity {
  const original = (card?.name || "").trim();

  if (!original) {
    return {
      name: "Unknown Card",
      descriptors: [],
    };
  }

  let name = original;
  const descriptors: string[] = [];

  const existingMetadata = [
    card?.language,
    card?.variant,
    card?.edition,
    card?.rarity,
    card?.finish,
  ]
    .filter(Boolean)
    .map((value) =>
      String(value).toLowerCase()
    );

  function addDescriptor(value: string) {
    const normalized = value.toLowerCase();

    if (
      !existingMetadata.some(
        (item) =>
          item === normalized ||
          item.includes(normalized)
      ) &&
      !descriptors.some(
        (item) =>
          item.toLowerCase() === normalized
      )
    ) {
      descriptors.unshift(value);
    }
  }

  // Repeatedly remove recognized trailing
  // descriptors and matching card numbers.
  //
  // Example:
  // Crocodile - OP14-120 (Alternate Art)
  // -> Crocodile - OP14-120
  // -> Crocodile
  //
  // The underlying card record is untouched.

  for (let i = 0; i < 20; i++) {
    const trailingNumber = name.match(
      /\s+-\s+(#?[A-Z0-9/-]+)$/i
    );

    if (
      trailingNumber &&
      cardNumberMatches(
        trailingNumber[1],
        card?.card_number
      )
    ) {
      name = name
        .slice(0, trailingNumber.index)
        .trim();

      continue;
    }

    const match = name.match(
      /\s*[\[(]([^\[\]()]+)[\])]\s*$/
    );

    if (!match) break;

    const tag = match[1].trim();
    const normalized = normalizeTag(tag);

    // Remove language tags only when they
    // agree with the actual card language.
    if (
      normalized === "jp" ||
      normalized === "en"
    ) {
      if (
        card?.language?.toLowerCase() !==
        normalized
      ) {
        break;
      }

      name = name
        .slice(0, match.index)
        .trim();

      continue;
    }

    // Delta Species is part of the
    // meaningful card display identity.
    if (normalized === "delta species") {
      name =
        name.slice(0, match.index).trim() +
        " δ";

      continue;
    }

    if (
      cardNumberMatches(
        tag,
        card?.card_number
      )
    ) {
      name = name
        .slice(0, match.index)
        .trim();

      continue;
    }

    const illustrationBox = tag.match(
      /^illustration box\s*vol\.?\s*(\d+)$/i
    );

    const volume = tag.match(
      /^vol\.?\s*(\d+)$/i
    );

    const premiumCollection =
      /^premium card collection\b/i.test(
        tag
      );

    // One Piece promotional DON!! cards
    // can carry a collaboration identity.
    const netflixDon =
      /^don!!\s*card$/i.test(name) &&
      /^netflix\b/i.test(tag);

    const descriptor = illustrationBox
      ? `Illustration Box Vol. ${illustrationBox[1]}`
      : volume
        ? `Vol. ${volume[1]}`
        : premiumCollection
          ? tag.replace(/\s+/g, " ").trim()
          : netflixDon
            ? tag.replace(/\s+/g, " ").trim()
            : KNOWN_TAGS[normalized];

    // Unknown tags stay in the name.
    // We never blindly strip parentheses.
    if (!descriptor) break;

    name = name
      .slice(0, match.index)
      .trim();

    addDescriptor(descriptor);
  }

  return {
    name: normalizeCharacterName(
      name || original
    ),
    descriptors,
  };
}
