"use client";

import {
  useMemo,
  useState,
  useEffect,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import {
  getActiveVendorMembership,
  type ActiveVendorMembership,
} from "../../../lib/active-vendor";

type SourcePreset =
  | "tcgplayer"
  | "collectr"
  | "pricecharting"
  | "generic";

type ListingType =
  | "raw"
  | "graded"
  | "sealed";

type CsvRow = Record<string, string>;

type NormalizedRow = {
  rowNumber: number;
  source: SourcePreset;

  category: string;
  setName: string;
  name: string;
  cardNumber: string;
  rarity: string;

  edition: string;
  finish: string;

  listingType: ListingType;
  condition: string;

  gradingCompany: string;
  grade: string;
  certNumber: string;

  imageUrl: string;

  marketPrice: number | null;

  quantity: number;
  notes: string;

  sourceExternalId: string;
  sourceSecondaryId: string;

  averageCostPaid: number | null;
  portfolioName: string;

  errors: string[];
  warnings: string[];
};

type ImportResult = {
  rowNumber: number;
  ok: boolean;
  message: string;
};

const CONDITIONS: Record<string, string> = {
  "near mint": "NM",
  nm: "NM",
  "lightly played": "LP",
  lp: "LP",
  "moderately played": "MP",
  mp: "MP",
  "heavily played": "HP",
  hp: "HP",
  damaged: "DMG",
  dmg: "DMG",
  "normal wear": "NM",
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()/]+/g, "");
}

function numberOrNull(value: unknown) {
  const raw = clean(value)
    .replace(/\$/g, "")
    .replace(/,/g, "");

  if (!raw) return null;

  const valueNumber = Number(raw);

  return Number.isFinite(valueNumber)
    ? valueNumber
    : null;
}

function positiveInteger(
  value: unknown,
  fallback = 1
) {
  const parsed =
    Number.parseInt(clean(value), 10);

  if (
    Number.isFinite(parsed) &&
    parsed > 0
  ) {
    return parsed;
  }

  return fallback;
}

function normalizeCondition(
  value: string
) {
  const normalized =
    value.trim().toLowerCase();

  return (
    CONDITIONS[normalized] ||
    value.trim().toUpperCase() ||
    "NM"
  );
}

function normalizeCategory(
  value: string
) {
  const raw = value.trim();

  if (!raw) return "Other";

  const normalized =
    raw.toLowerCase();

  if (
    normalized === "pokemon" ||
    normalized === "pokémon"
  ) {
    return "Pokemon";
  }

  if (
    normalized.includes("one piece")
  ) {
    return "One Piece";
  }

  if (
    normalized.includes("magic") ||
    normalized === "mtg"
  ) {
    return "Magic: The Gathering";
  }

  if (
    normalized.includes("yu-gi") ||
    normalized.includes("yugioh")
  ) {
    return "Yu-Gi-Oh!";
  }

  if (
    normalized.includes("lorcana")
  ) {
    return "Lorcana";
  }

  if (
    normalized.includes("baseball") ||
    normalized.includes("basketball") ||
    normalized.includes("football") ||
    normalized.includes("hockey") ||
    normalized.includes("soccer") ||
    normalized.includes("sports")
  ) {
    return "Sports";
  }

  return raw;
}

function parsePrinting(
  printing: string
) {
  const value = printing.trim();

  if (!value) {
    return {
      edition: "",
      finish: "",
    };
  }

  const lower =
    value.toLowerCase();

  let edition = "";
  let finish = value;

  if (
    lower.includes("1st edition")
  ) {
    edition = "1st Edition";
    finish = finish
      .replace(
        /1st edition/gi,
        ""
      )
      .trim();
  } else if (
    lower.includes("unlimited")
  ) {
    edition = "Unlimited";
    finish = finish
      .replace(
        /unlimited/gi,
        ""
      )
      .trim();
  } else if (
    lower.includes("shadowless")
  ) {
    edition = "Shadowless";
    finish = finish
      .replace(
        /shadowless/gi,
        ""
      )
      .trim();
  }

  return {
    edition,
    finish:
      finish || "",
  };
}

function parseCollectrVariance(
  variance: string
) {
  return parsePrinting(variance);
}

function parseGrade(
  rawGrade: string
) {
  const gradeText =
    rawGrade.trim();

  if (
    !gradeText ||
    gradeText.toLowerCase() ===
      "ungraded"
  ) {
    return {
      listingType:
        "raw" as const,
      gradingCompany: "",
      grade: "",
    };
  }

  const match =
    gradeText.match(
      /^([A-Za-z]+)\s+([0-9]+(?:\.[0-9]+)?)/i
    );

  if (match) {
    const rawNumeric =
      Number(match[2]);

    const normalizedGrade =
      Number.isInteger(rawNumeric)
        ? String(rawNumeric)
        : String(rawNumeric);

    return {
      listingType:
        "graded" as const,
      gradingCompany:
        match[1].toUpperCase(),
      grade: normalizedGrade,
    };
  }

  return {
    listingType:
      "graded" as const,
    gradingCompany: "",
    grade: gradeText,
  };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (
    let i = 0;
    i < text.length;
    i += 1
  ) {
    const char = text[i];
    const next =
      text[i + 1];

    if (char === '"') {
      if (
        quoted &&
        next === '"'
      ) {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }

      continue;
    }

    if (
      char === "," &&
      !quoted
    ) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (
      (char === "\n" ||
        char === "\r") &&
      !quoted
    ) {
      if (
        char === "\r" &&
        next === "\n"
      ) {
        i += 1;
      }

      row.push(cell);
      cell = "";

      if (
        row.some(
          (value) =>
            value.trim() !== ""
        )
      ) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  if (
    cell.length > 0 ||
    row.length > 0
  ) {
    row.push(cell);

    if (
      row.some(
        (value) =>
          value.trim() !== ""
      )
    ) {
      rows.push(row);
    }
  }

  if (rows.length < 2) {
    return {
      headers: [] as string[],
      rows: [] as CsvRow[],
    };
  }

  const headers =
    rows[0].map((value) =>
      value
        .replace(/^\uFEFF/, "")
        .trim()
    );

  const objectRows =
    rows.slice(1).map(
      (values) => {
        const record: CsvRow =
          {};

        headers.forEach(
          (header, index) => {
            record[header] =
              values[index] ?? "";
          }
        );

        return record;
      }
    );

  return {
    headers,
    rows: objectRows,
  };
}

function detectPreset(
  headers: string[]
): SourcePreset {
  const normalized =
    new Set(
      headers.map(
        normalizeKey
      )
    );

  if (
    normalized.has(
      "tcgplayerid"
    ) ||
    normalized.has(
      "tcgmarketprice"
    ) ||
    normalized.has(
      "productline"
    )
  ) {
    return "tcgplayer";
  }

  if (
    normalized.has(
      "portfolioname"
    ) ||
    normalized.has(
      "variance"
    ) ||
    normalized.has(
      "cardcondition"
    )
  ) {
    return "collectr";
  }

  if (
    normalized.has(
      "priceinpennies"
    ) ||
    normalized.has(
      "consolename"
    ) ||
    normalized.has(
      "costbasisinpennies"
    )
  ) {
    return "pricecharting";
  }

  return "generic";
}

function getByAliases(
  row: CsvRow,
  aliases: string[]
) {
  const lookup =
    new Map(
      Object.entries(row).map(
        ([key, value]) => [
          normalizeKey(key),
          value,
        ]
      )
    );

  for (const alias of aliases) {
    const found =
      lookup.get(
        normalizeKey(alias)
      );

    if (found != null) {
      return found;
    }
  }

  return "";
}

function priceChartingMoney(
  value: unknown
) {
  const pennies =
    numberOrNull(value);

  if (pennies == null) {
    return null;
  }

  return Number(
    (pennies / 100).toFixed(2)
  );
}

function parsePriceChartingConsole(
  value: string
) {
  const raw = value.trim();

  if (!raw) {
    return {
      category: "Other",
      setName: "",
    };
  }

  const lower =
    raw.toLowerCase();

  if (
    lower.startsWith("pokemon ")
  ) {
    return {
      category: "Pokemon",
      setName:
        raw
          .replace(
            /^pokemon\s+/i,
            ""
          )
          .trim(),
    };
  }

  if (
    lower.startsWith(
      "one piece "
    )
  ) {
    return {
      category: "One Piece",
      setName:
        raw
          .replace(
            /^one piece\s+/i,
            ""
          )
          .trim(),
    };
  }

  if (
    lower.startsWith("magic ")
  ) {
    return {
      category:
        "Magic: The Gathering",
      setName:
        raw
          .replace(
            /^magic\s+/i,
            ""
          )
          .trim(),
    };
  }

  if (
    lower.startsWith(
      "yu-gi-oh "
    ) ||
    lower.startsWith(
      "yugioh "
    )
  ) {
    return {
      category: "Yu-Gi-Oh!",
      setName:
        raw
          .replace(
            /^(yu-gi-oh|yugioh)\s+/i,
            ""
          )
          .trim(),
    };
  }

  if (
    lower.startsWith(
      "lorcana "
    )
  ) {
    return {
      category: "Lorcana",
      setName:
        raw
          .replace(
            /^lorcana\s+/i,
            ""
          )
          .trim(),
    };
  }

  return {
    category:
      normalizeCategory(raw),
    setName: raw,
  };
}

function parsePriceChartingProductName(
  value: string
) {
  const raw = value.trim();

  const match =
    raw.match(
      /^(.*?)(?:\s+#([^#]+))$/
    );

  if (!match) {
    return {
      name: raw,
      cardNumber: "",
    };
  }

  return {
    name:
      match[1].trim(),
    cardNumber:
      match[2].trim(),
  };
}

function collectrMarketPrice(
  row: CsvRow
) {
  const entry =
    Object.entries(row).find(
      ([key]) =>
        normalizeKey(
          key
        ).startsWith(
          "marketpriceasof"
        )
    );

  return entry?.[1] || "";
}

function buildNotes({
  notes,
  averageCostPaid,
  portfolioName,
}: {
  notes: string;
  averageCostPaid: number | null;
  portfolioName: string;
}) {
  const parts: string[] = [];

  if (notes.trim()) {
    parts.push(notes.trim());
  }

  // Preserve useful import metadata without requiring schema changes.
  if (
    averageCostPaid != null &&
    averageCostPaid > 0
  ) {
    parts.push(
      `Imported cost: $${averageCostPaid.toFixed(
        2
      )}`
    );
  }

  if (portfolioName.trim()) {
    parts.push(
      `Portfolio: ${portfolioName.trim()}`
    );
  }

  return parts.join(" • ");
}

function normalizeRows({
  rows,
  preset,
}: {
  rows: CsvRow[];
  preset: SourcePreset;
}) {
  return rows.map(
    (
      row,
      index
    ): NormalizedRow => {
      let category = "";
      let setName = "";
      let name = "";
      let cardNumber = "";
      let rarity = "";
      let edition = "";
      let finish = "";
      let listingType:
        ListingType = "raw";
      let condition = "NM";
      let gradingCompany = "";
      let grade = "";
      let certNumber = "";
      let imageUrl = "";
      let marketPrice:
        number | null = null;
      let quantity = 1;
      let notes = "";
      let sourceExternalId = "";
      let sourceSecondaryId = "";
      let averageCostPaid:
        number | null = null;
      let portfolioName = "";

      if (
        preset === "tcgplayer"
      ) {
        category =
          normalizeCategory(
            getByAliases(
              row,
              [
                "Product Line",
                "Category",
              ]
            )
          );

        setName =
          getByAliases(
            row,
            ["Set Name", "Set"]
          );

        name =
          getByAliases(
            row,
            [
              "Product Name",
              "Name",
              "Title",
            ]
          );

        cardNumber =
          getByAliases(
            row,
            [
              "Number",
              "Card Number",
            ]
          );

        rarity =
          getByAliases(
            row,
            ["Rarity"]
          );

        const printing =
          parsePrinting(
            getByAliases(
              row,
              [
                "Printing",
                "Variance",
              ]
            )
          );

        edition =
          printing.edition;
        finish =
          printing.finish;

        condition =
          normalizeCondition(
            getByAliases(
              row,
              ["Condition"]
            )
          );

        marketPrice =
          numberOrNull(
            getByAliases(
              row,
              [
                "TCG Marketplace Price",
                "TCG Market Price",
                "Market Price",
              ]
            )
          );

        quantity =
          positiveInteger(
            getByAliases(
              row,
              [
                "Add to Quantity",
                "Total Quantity",
                "Quantity",
              ]
            ),
            1
          );

        imageUrl =
          getByAliases(
            row,
            [
              "Photo URL",
              "Image URL",
            ]
          );

        notes =
          getByAliases(
            row,
            ["Notes"]
          );

        sourceExternalId =
          getByAliases(
            row,
            ["Product ID"]
          );

        sourceSecondaryId =
          getByAliases(
            row,
            ["TCGplayer Id"]
          );
      } else if (
        preset === "collectr"
      ) {
        category =
          normalizeCategory(
            getByAliases(
              row,
              ["Category"]
            )
          );

        setName =
          getByAliases(
            row,
            ["Set", "Set Name"]
          );

        name =
          getByAliases(
            row,
            [
              "Product Name",
              "Name",
            ]
          );

        cardNumber =
          getByAliases(
            row,
            [
              "Card Number",
              "Number",
            ]
          );

        rarity =
          getByAliases(
            row,
            ["Rarity"]
          );

        const variance =
          parseCollectrVariance(
            getByAliases(
              row,
              ["Variance"]
            )
          );

        edition =
          variance.edition;
        finish =
          variance.finish;

        const gradeInfo =
          parseGrade(
            getByAliases(
              row,
              ["Grade"]
            )
          );

        listingType =
          gradeInfo.listingType;

        gradingCompany =
          gradeInfo.gradingCompany;

        grade =
          gradeInfo.grade;

        condition =
          normalizeCondition(
            getByAliases(
              row,
              [
                "Card Condition",
                "Condition",
              ]
            )
          );

        marketPrice =
          numberOrNull(
            collectrMarketPrice(
              row
            )
          );


        quantity =
          positiveInteger(
            getByAliases(
              row,
              ["Quantity"]
            ),
            1
          );

        notes =
          getByAliases(
            row,
            ["Notes"]
          );

        averageCostPaid =
          numberOrNull(
            getByAliases(
              row,
              [
                "Average Cost Paid",
              ]
            )
          );

        portfolioName =
          getByAliases(
            row,
            [
              "Portfolio Name",
            ]
          );

        sourceExternalId =
          [
            category,
            setName,
            name,
            cardNumber,
            edition,
            finish,
          ]
            .map(
              (value) =>
                normalizeKey(value)
            )
            .join(":");
      } else if (
        preset ===
        "pricecharting"
      ) {
        const consoleInfo =
          parsePriceChartingConsole(
            getByAliases(
              row,
              ["console-name"]
            )
          );

        category =
          consoleInfo.category;

        setName =
          consoleInfo.setName;

        const productInfo =
          parsePriceChartingProductName(
            getByAliases(
              row,
              ["product-name"]
            )
          );

        name =
          productInfo.name;

        cardNumber =
          productInfo.cardNumber;

        rarity = "";

        const includeString =
          getByAliases(
            row,
            ["include-string"]
          );

        const gradingCompanyValue =
          getByAliases(
            row,
            ["grading-company"]
          );

        const certValue =
          getByAliases(
            row,
            ["grading-cert-id"]
          );

        if (
          gradingCompanyValue.trim() ||
          (
            includeString.trim() &&
            includeString
              .trim()
              .toLowerCase() !==
              "ungraded"
          )
        ) {
          listingType =
            "graded";

          gradingCompany =
            gradingCompanyValue
              .trim()
              .toUpperCase();

          grade =
            includeString
              .replace(
                /graded/gi,
                ""
              )
              .trim();

          certNumber =
            certValue.trim();
        } else {
          listingType =
            "raw";

          condition =
            normalizeCondition(
              getByAliases(
                row,
                [
                  "condition-string",
                ]
              )
            );
        }

        marketPrice =
          priceChartingMoney(
            getByAliases(
              row,
              [
                "price-in-pennies",
              ]
            )
          );

        quantity =
          positiveInteger(
            getByAliases(
              row,
              ["quantity"]
            ),
            1
          );

        averageCostPaid =
          priceChartingMoney(
            getByAliases(
              row,
              [
                "cost-basis-in-pennies",
              ]
            )
          );

        notes =
          getByAliases(
            row,
            ["notes"]
          );

        portfolioName =
          getByAliases(
            row,
            ["folder"]
          );

        sourceExternalId =
          getByAliases(
            row,
            ["id"]
          );

        sourceSecondaryId =
          getByAliases(
            row,
            ["sku"]
          );
      } else {
        category =
          normalizeCategory(
            getByAliases(
              row,
              [
                "Category",
                "Product Line",
              ]
            )
          );

        setName =
          getByAliases(
            row,
            ["Set", "Set Name"]
          );

        name =
          getByAliases(
            row,
            [
              "Product Name",
              "Name",
              "Title",
            ]
          );

        cardNumber =
          getByAliases(
            row,
            [
              "Card Number",
              "Number",
            ]
          );

        rarity =
          getByAliases(
            row,
            ["Rarity"]
          );

        condition =
          normalizeCondition(
            getByAliases(
              row,
              [
                "Condition",
                "Card Condition",
              ]
            )
          );

        quantity =
          positiveInteger(
            getByAliases(
              row,
              [
                "Quantity",
                "Add to Quantity",
              ]
            ),
            1
          );

        marketPrice =
          numberOrNull(
            getByAliases(
              row,
              [
                "Market Price",
                "Price",
              ]
            )
          );

        imageUrl =
          getByAliases(
            row,
            [
              "Image URL",
              "Photo URL",
            ]
          );

        notes =
          getByAliases(
            row,
            ["Notes"]
          );

        sourceExternalId =
          [
            category,
            setName,
            name,
            cardNumber,
          ]
            .map(
              (value) =>
                normalizeKey(value)
            )
            .join(":");
      }


      const errors: string[] =
        [];
      const warnings: string[] =
        [];

      if (!name.trim()) {
        errors.push(
          "Missing product name"
        );
      }

      if (
        !quantity ||
        quantity < 1
      ) {
        errors.push(
          "Invalid quantity"
        );
      }


      if (
        listingType ===
          "graded" &&
        !gradingCompany
      ) {
        warnings.push(
          "Grading company could not be parsed"
        );
      }

      if (
        listingType ===
          "graded" &&
        !grade
      ) {
        warnings.push(
          "Grade could not be parsed"
        );
      }

      if (!setName.trim()) {
        warnings.push(
          "No set name"
        );
      }

      if (
        preset ===
          "pricecharting" &&
        getByAliases(
          row,
          [
            "condition-string",
          ]
        )
          .trim()
          .toLowerCase() ===
          "normal wear"
      ) {
        warnings.push(
          "PriceCharting 'Normal wear' mapped to NM — review condition before importing"
        );
      }

      return {
        rowNumber:
          index + 2,
        source: preset,

        category:
          category || "Other",
        setName,
        name,
        cardNumber,
        rarity,

        edition,
        finish,

        listingType,
        condition,

        gradingCompany,
        grade,
        certNumber,

        imageUrl,

        marketPrice,

        quantity,
        notes,

        sourceExternalId,
        sourceSecondaryId,

        averageCostPaid,
        portfolioName,

        errors,
        warnings,
      };
    }
  );
}

function sourceLabel(
  source: SourcePreset
) {
  if (source === "tcgplayer") {
    return "TCGplayer";
  }

  if (source === "collectr") {
    return "Collectr";
  }

  if (
    source === "pricecharting"
  ) {
    return "PriceCharting";
  }

  return "Generic CSV";
}

function itemLabel(
  row: NormalizedRow
) {
  if (
    row.listingType ===
    "graded"
  ) {
    return [
      row.gradingCompany,
      row.grade,
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (
    row.listingType ===
    "sealed"
  ) {
    return "Sealed";
  }

  return row.condition || "Raw";
}

function cardMatchFilter(
  row: NormalizedRow
) {
  return {
    name: row.name.trim(),
    setName: row.setName.trim(),
    cardNumber:
      row.cardNumber.trim(),
    category:
      row.category.trim(),
  };
}

async function findExistingCard(
  row: NormalizedRow
) {
  const filter =
    cardMatchFilter(row);

  let query = supabase
    .from("cards")
    .select(
      "id, image_url, external_id, data_source"
    )
    .ilike(
      "name",
      filter.name
    );

  if (filter.setName) {
    query = query.ilike(
      "set_name",
      filter.setName
    );
  }

  if (filter.cardNumber) {
    query = query.ilike(
      "card_number",
      filter.cardNumber
    );
  }

  const {
    data,
    error,
  } = await query.limit(10);

  if (error) {
    throw error;
  }

  const rows =
    Array.isArray(data)
      ? data
      : [];

  if (rows.length === 0) {
    return null;
  }

  // Prefer a local card that already has provider identity.
  const providerCard =
    rows.find(
      (candidate: any) =>
        candidate.external_id &&
        candidate.data_source &&
        !String(
          candidate.data_source
        ).includes("_import")
    );

  return (
    providerCard ||
    rows[0]
  );
}

async function createImportedCard(
  row: NormalizedRow
) {
  const fallbackExternalId =
    row.sourceExternalId ||
    [
      row.category,
      row.setName,
      row.name,
      row.cardNumber,
      row.edition,
      row.finish,
    ]
      .map(
        (value) =>
          normalizeKey(value)
      )
      .join(":");

  const dataSource =
    row.source === "tcgplayer"
      ? "tcgplayer_import"
      : row.source === "collectr"
        ? "collectr_import"
        : row.source === "pricecharting"
          ? "pricecharting_import"
          : "csv_import";

  const {
    data,
    error,
  } = await supabase
    .from("cards")
    .insert({
      name:
        row.name ||
        "Unknown Collectible",
      set_name:
        row.setName || null,
      card_number:
        row.cardNumber || null,
      image_url:
        row.imageUrl || null,
      category:
        row.category || "Other",
      rarity:
        row.rarity || null,
      edition:
        row.edition || null,
      finish:
        row.finish || null,

      external_id:
        fallbackExternalId,
      data_source:
        dataSource,

      external_updated_at:
        new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id as string;
}

async function getOrCreateCard(
  row: NormalizedRow
) {
  const existing =
    await findExistingCard(row);

  if (existing?.id) {
    // Fill missing image when the CSV has one.
    if (
      row.imageUrl &&
      !existing.image_url
    ) {
      await supabase
        .from("cards")
        .update({
          image_url:
            row.imageUrl,
        })
        .eq(
          "id",
          existing.id
        );
    }

    return existing.id as string;
  }

  return createImportedCard(row);
}

export default function VendorImportPage() {
  const router = useRouter();

  const [
    membership,
    setMembership,
  ] =
    useState<ActiveVendorMembership | null>(
      null
    );

  const [
    authLoading,
    setAuthLoading,
  ] = useState(true);

  const [
    fileName,
    setFileName,
  ] = useState("");

  const [
    headers,
    setHeaders,
  ] = useState<string[]>([]);

  const [
    rawRows,
    setRawRows,
  ] = useState<CsvRow[]>([]);

  const [
    preset,
    setPreset,
  ] =
    useState<SourcePreset>(
      "generic"
    );


  const [
    importing,
    setImporting,
  ] = useState(false);

  const [
    importProgress,
    setImportProgress,
  ] = useState({
    current: 0,
    total: 0,
  });

  const [
    results,
    setResults,
  ] =
    useState<ImportResult[]>(
      []
    );

  const [
    pageError,
    setPageError,
  ] = useState("");

  useEffect(() => {
    async function loadVendor() {
      try {
        setAuthLoading(true);
        setPageError("");

        const {
          data: { session },
          error: sessionError,
        } =
          await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session) {
          router.replace(
            "/vendor/login"
          );
          return;
        }

        const activeMembership =
          await getActiveVendorMembership(
            supabase,
            session.user.id
          );

        if (!activeMembership) {
          setMembership(null);
          setPageError(
            "This account is not connected to a vendor."
          );
          return;
        }

        setMembership(
          activeMembership
        );
      } catch (error: any) {
        console.error(
          "CSV import membership error:",
          error
        );

        setMembership(null);
        setPageError(
          error?.message ||
            "MintRadar could not verify your active vendor."
        );
      } finally {
        setAuthLoading(false);
      }
    }

    void loadVendor();
  }, [router]);

  const normalizedRows =
    useMemo(
      () =>
        normalizeRows({
          rows: rawRows,
          preset,
        }),
      [
        rawRows,
        preset,
      ]
    );

  const validRows =
    useMemo(
      () =>
        normalizedRows.filter(
          (row) =>
            row.errors.length ===
            0
        ),
      [normalizedRows]
    );

  const invalidRows =
    normalizedRows.length -
    validRows.length;

  const warningCount =
    normalizedRows.reduce(
      (sum, row) =>
        sum +
        row.warnings.length,
      0
    );

  const totalImportQuantity =
    validRows.reduce(
      (sum, row) =>
        sum + row.quantity,
      0
    );

  async function handleFile(
    file: File
  ) {
    setPageError("");
    setResults([]);

    if (
      !file.name
        .toLowerCase()
        .endsWith(".csv")
    ) {
      setPageError(
        "Choose a .csv file."
      );
      return;
    }

    try {
      const text =
        await file.text();

      const parsed =
        parseCsv(text);

      if (
        parsed.headers.length ===
          0 ||
        parsed.rows.length === 0
      ) {
        throw new Error(
          "MintRadar could not find CSV rows in that file."
        );
      }

      const detected =
        detectPreset(
          parsed.headers
        );

      setFileName(file.name);
      setHeaders(
        parsed.headers
      );
      setRawRows(
        parsed.rows
      );
      setPreset(detected);
    } catch (error: any) {
      console.error(
        "CSV parse error:",
        error
      );

      setPageError(
        error?.message ||
          "MintRadar could not read that CSV."
      );
    }
  }

  async function importRows() {
    if (
      !membership?.vendor_id
    ) {
      setPageError(
        "Vendor account could not be verified."
      );
      return;
    }

    if (
      validRows.length === 0
    ) {
      setPageError(
        "There are no valid rows to import."
      );
      return;
    }

    setPageError("");
    setResults([]);
    setImporting(true);
    setImportProgress({
      current: 0,
      total:
        validRows.length,
    });

    const importResults:
      ImportResult[] = [];

    for (
      let index = 0;
      index < validRows.length;
      index += 1
    ) {
      const row =
        validRows[index];

      try {
        const cardId =
          await getOrCreateCard(
            row
          );

        const notes =
          buildNotes({
            notes: row.notes,
            averageCostPaid:
              row.averageCostPaid,
            portfolioName:
              row.portfolioName,
          });

        const {
          error:
            inventoryError,
        } = await supabase
          .from("inventory")
          .insert({
            vendor_id:
              membership.vendor_id,
            card_id: cardId,

            listing_type:
              row.listingType,

            condition:
              row.listingType ===
              "raw"
                ? row.condition ||
                  "NM"
                : null,

            grading_company:
              row.listingType ===
              "graded"
                ? row.gradingCompany ||
                  null
                : null,

            grade:
              row.listingType ===
              "graded"
                ? row.grade ||
                  null
                : null,

            cert_number:
              row.listingType ===
              "graded"
                ? row.certNumber ||
                  null
                : null,

            price: null,

            quantity:
              row.quantity,

            notes:
              notes || null,
          });

        if (inventoryError) {
          throw inventoryError;
        }

        importResults.push({
          rowNumber:
            row.rowNumber,
          ok: true,
          message:
            `${row.name} imported.`,
        });
      } catch (error: any) {
        console.error(
          `CSV import row ${row.rowNumber} error:`,
          error
        );

        importResults.push({
          rowNumber:
            row.rowNumber,
          ok: false,
          message:
            error?.message ||
            `Could not import ${row.name}.`,
        });
      }

      setImportProgress({
        current:
          index + 1,
        total:
          validRows.length,
      });
    }

    setResults(
      importResults
    );
    setImporting(false);
  }

  const successfulImports =
    results.filter(
      (result) => result.ok
    ).length;

  const failedImports =
    results.filter(
      (result) => !result.ok
    ).length;

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="font-black text-emerald-400">
          Loading CSV importer...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 pb-16 pt-20 text-white sm:px-5 sm:pt-24">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/vendor"
              className="w-fit"
            >
              <Image
                src="/mintradar-logo.png"
                alt="MintRadar by OnlySlabs"
                width={600}
                height={300}
                priority
                className="h-auto w-[210px] sm:w-[260px]"
              />
            </Link>

            <Link
              href="/vendor"
              className="w-fit rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-black text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
            >
              ← Vendor Dashboard
            </Link>
          </div>

          <div className="mt-8">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Vendor Tools
            </p>

            <h1 className="mt-2 text-4xl font-black sm:text-5xl">
              Import Inventory
            </h1>

            <p className="mt-3 max-w-3xl text-zinc-500">
              Upload a TCGplayer, Collectr, or PriceCharting CSV, review how MintRadar reads it, then import the inventory details. Pricing is intentionally left blank so vendors can comp and price items when they are ready to sell.
            </p>
          </div>
        </header>

        {pageError && (
          <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm font-bold text-red-300">
            {pageError}
          </div>
        )}

        {results.length >
          0 && (
          <div
            className={`mb-5 rounded-2xl border p-4 ${
              failedImports === 0
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border-amber-400/30 bg-amber-400/10 text-amber-200"
            }`}
          >
            <p className="font-black">
              Import finished:{" "}
              {successfulImports} imported
              {failedImports > 0
                ? `, ${failedImports} failed`
                : ""}.
            </p>

            {successfulImports >
              0 && (
              <Link
                href="/vendor"
                className="mt-3 inline-block text-sm font-black underline"
              >
                View imported inventory →
              </Link>
            )}
          </div>
        )}

        {/* UPLOAD */}

        <section className="rounded-3xl border border-zinc-900 bg-zinc-950 p-5 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
            Step 1
          </p>

          <h2 className="mt-2 text-2xl font-black">
            Choose CSV
          </h2>

          <label className="mt-5 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-black px-5 py-10 text-center transition hover:border-emerald-400/50">
            <span className="text-lg font-black">
              {fileName ||
                "Drop in your inventory export"}
            </span>

            <span className="mt-2 text-sm text-zinc-600">
              TCGplayer, Collectr, PriceCharting, or a compatible CSV
            </span>

            <span className="mt-4 rounded-xl bg-emerald-400 px-4 py-2 text-sm font-black text-black">
              Select CSV
            </span>

            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={importing}
              onChange={(event) => {
                const file =
                  event.target
                    .files?.[0];

                if (file) {
                  void handleFile(
                    file
                  );
                }

                event.currentTarget.value =
                  "";
              }}
            />
          </label>

          {rawRows.length >
            0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
                Detected:{" "}
                {sourceLabel(
                  preset
                )}
              </span>

              <span className="rounded-full border border-zinc-800 bg-black px-3 py-1 text-xs font-black text-zinc-500">
                {rawRows.length} rows
              </span>

              <span className="rounded-full border border-zinc-800 bg-black px-3 py-1 text-xs font-black text-zinc-500">
                {headers.length} columns
              </span>
            </div>
          )}
        </section>

        {rawRows.length >
          0 && (
          <>
            {/* SOURCE */}

            <section className="mt-6 rounded-3xl border border-zinc-900 bg-zinc-950 p-5 sm:p-6">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                Step 2
              </p>

              <h2 className="mt-2 text-2xl font-black">
                Review Import Source
              </h2>

              <div className="mt-5 max-w-xl">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Source Preset
                </label>

                <select
                  value={preset}
                  onChange={(event) =>
                    setPreset(
                      event.target
                        .value as SourcePreset
                    )
                  }
                  disabled={importing}
                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 font-black text-white outline-none focus:border-emerald-400/50"
                >
                  <option value="tcgplayer">
                    TCGplayer
                  </option>
                  <option value="collectr">
                    Collectr
                  </option>
                  <option value="pricecharting">
                    PriceCharting
                  </option>
                  <option value="generic">
                    Generic CSV
                  </option>
                </select>

                <p className="mt-2 text-xs leading-5 text-zinc-600">
                  MintRadar auto-detected this from the column names. Pricing is not imported; vendors will comp and set prices later.
                </p>
              </div>
            </section>

            {/* STATS */}

            <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Valid Rows
                </p>
                <p className="mt-2 text-3xl font-black text-emerald-400">
                  {validRows.length}
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Blocked Rows
                </p>
                <p className="mt-2 text-3xl font-black">
                  {invalidRows}
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Warnings
                </p>
                <p className="mt-2 text-3xl font-black">
                  {warningCount}
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-400/20 bg-zinc-950 p-5">
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Total Items
                </p>
                <p className="mt-2 text-3xl font-black text-emerald-400">
                  {totalImportQuantity}
                </p>
              </div>
            </section>

            {/* PREVIEW */}

            <section className="mt-6 overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950">
              <div className="border-b border-zinc-900 p-5 sm:p-6">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                  Step 3
                </p>

                <h2 className="mt-2 text-2xl font-black">
                  Preview
                </h2>

                <p className="mt-2 text-sm text-zinc-600">
                  Showing the first 50 rows. Rows with red errors will not be imported.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[1050px] w-full text-left text-sm">
                  <thead className="bg-black text-[10px] font-black uppercase tracking-wider text-zinc-600">
                    <tr>
                      <th className="px-4 py-3">
                        Row
                      </th>
                      <th className="px-4 py-3">
                        Item
                      </th>
                      <th className="px-4 py-3">
                        Type
                      </th>
                      <th className="px-4 py-3">
                        Condition / Grade
                      </th>
                      <th className="px-4 py-3">
                        Qty
                      </th>
                      <th className="px-4 py-3">
                        Status
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {normalizedRows
                      .slice(
                        0,
                        50
                      )
                      .map(
                        (row) => (
                          <tr
                            key={
                              row.rowNumber
                            }
                            className="border-t border-zinc-900"
                          >
                            <td className="px-4 py-4 text-zinc-700">
                              {
                                row.rowNumber
                              }
                            </td>

                            <td className="px-4 py-4">
                              <p className="font-black text-white">
                                {row.name ||
                                  "Missing name"}
                              </p>

                              <p className="mt-1 text-xs text-zinc-600">
                                {[
                                  row.category,
                                  row.setName,
                                  row.cardNumber
                                    ? `#${row.cardNumber}`
                                    : null,
                                  row.finish,
                                ]
                                  .filter(
                                    Boolean
                                  )
                                  .join(
                                    " • "
                                  )}
                              </p>
                            </td>

                            <td className="px-4 py-4">
                              <span className="rounded-full border border-zinc-800 bg-black px-2 py-1 text-[10px] font-black uppercase text-zinc-500">
                                {row.listingType}
                              </span>

                              <p className="mt-2 text-xs font-bold text-zinc-500">
                                {itemLabel(
                                  row
                                )}
                              </p>
                            </td>

                            <td className="px-4 py-4">
                              <p className="font-black text-zinc-300">
                                {itemLabel(row)}
                              </p>
                              <p className="mt-1 text-xs text-zinc-700">
                                Price set later by vendor
                              </p>
                            </td>

                            <td className="px-4 py-4 font-black">
                              {
                                row.quantity
                              }
                            </td>

                            <td className="px-4 py-4">
                              {row.errors
                                .length >
                              0 ? (
                                <div>
                                  <p className="font-black text-red-300">
                                    Blocked
                                  </p>
                                  <p className="mt-1 max-w-xs text-xs text-red-300/70">
                                    {row.errors.join(
                                      " • "
                                    )}
                                  </p>
                                </div>
                              ) : row
                                  .warnings
                                  .length >
                                0 ? (
                                <div>
                                  <p className="font-black text-amber-300">
                                    Ready with warning
                                  </p>
                                  <p className="mt-1 max-w-xs text-xs text-amber-300/70">
                                    {row.warnings.join(
                                      " • "
                                    )}
                                  </p>
                                </div>
                              ) : (
                                <p className="font-black text-emerald-400">
                                  Ready
                                </p>
                              )}
                            </td>
                          </tr>
                        )
                      )}
                  </tbody>
                </table>
              </div>

              {normalizedRows.length >
                50 && (
                <div className="border-t border-zinc-900 px-5 py-4 text-sm text-zinc-600">
                  +{" "}
                  {normalizedRows.length -
                    50}{" "}
                  more rows ready for the import run.
                </div>
              )}
            </section>

            {/* IMPORT */}

            <section className="mt-6 rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5 sm:p-6">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                Step 4
              </p>

              <h2 className="mt-2 text-2xl font-black">
                Import to Vendor Inventory
              </h2>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">
                MintRadar will try to match each row to a card you already have in the database first. If there is no match, it creates an imported catalog record and then creates the vendor inventory listing with no price. Vendors can comp and price items later.
              </p>

              {membership?.vendor_id && (
                <div className="mt-5 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">
                    Importing To
                  </p>

                  <p className="mt-1 text-lg font-black text-white">
                    {membership.vendor?.business_name?.trim() ||
                      "MintRadar Vendor"}
                  </p>

                  <p className="mt-1 text-xs text-zinc-500">
                    CSV rows will be added only to this active vendor&apos;s inventory.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  void importRows()
                }
                disabled={
                  importing ||
                  validRows.length ===
                    0 ||
                  !membership?.vendor_id
                }
                className="mt-5 w-full rounded-xl bg-emerald-400 px-5 py-4 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {importing
                  ? `Importing ${importProgress.current} / ${importProgress.total}...`
                  : `Import ${validRows.length} Valid Row${
                      validRows.length ===
                      1
                        ? ""
                        : "s"
                    }`}
              </button>

              {importing && (
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-black">
                  <div
                    className="h-full bg-emerald-400 transition-all"
                    style={{
                      width:
                        importProgress.total >
                        0
                          ? `${Math.round(
                              (importProgress.current /
                                importProgress.total) *
                                100
                            )}%`
                          : "0%",
                    }}
                  />
                </div>
              )}

              <p className="mt-4 text-xs leading-5 text-zinc-600">
                Note: Source market prices are ignored during import. Collectr Average Cost Paid / PriceCharting cost basis are still preserved in notes for future profit reporting, but they do not set the listing price.
              </p>
            </section>

            {results.length >
              0 &&
              failedImports >
                0 && (
                <section className="mt-6 rounded-3xl border border-red-400/20 bg-zinc-950 p-5">
                  <h2 className="text-xl font-black">
                    Rows that failed
                  </h2>

                  <div className="mt-4 space-y-2">
                    {results
                      .filter(
                        (result) =>
                          !result.ok
                      )
                      .slice(
                        0,
                        30
                      )
                      .map(
                        (
                          result
                        ) => (
                          <div
                            key={
                              result.rowNumber
                            }
                            className="rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300"
                          >
                            Row{" "}
                            {
                              result.rowNumber
                            }
                            :{" "}
                            {
                              result.message
                            }
                          </div>
                        )
                      )}
                  </div>
                </section>
              )}
          </>
        )}
      </div>
    </main>
  );
}
