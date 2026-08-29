import { createClient } from "@supabase/supabase-js";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

type CatalogSetRow = {
  external_id: string;
  data_source: "tcgdex";
  name: string;
  category: "Pokemon";
  code: string;
  card_count: number;
  released_at: string | null;
  set_type: string | null;
  series_id: string | null;
  logo_url: string | null;
  symbol_url: string | null;
  external_updated_at: string;
};

type CardRow = {
  external_id: string;
  data_source: "tcgdex";
  name: string;
  set_name: string;
  card_number: string;
  image_url: string;
  category: "Pokemon";
  rarity: string | null;
  edition: string | null;
  finish: string | null;
  external_updated_at: string;
};

const ROOT = process.cwd();
const CACHE_DIR = join(
  ROOT,
  ".cache",
  "tcgdex-cards-database"
);
const DATA_DIR = join(CACHE_DIR, "data");

loadEnvFile(join(ROOT, ".env.local"));

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local."
  );
}

const supabase = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

async function main() {
  console.log(
    "\nMintRadar Pokémon catalog sync\n"
  );

  refreshRepository();

  const now = new Date().toISOString();
  const setRows: CatalogSetRow[] = [];
  const cardRows: CardRow[] = [];

  const seriesFolders = readdirSync(DATA_DIR)
    .map((name) => ({
      name,
      path: join(DATA_DIR, name),
    }))
    .filter((item) =>
      statSync(item.path).isDirectory()
    );

  for (const seriesFolder of seriesFolders) {
    const seriesFile = join(
      DATA_DIR,
      `${seriesFolder.name}.ts`
    );

    const seriesId = existsSync(seriesFile)
      ? readStringProperty(
          parseDefaultObject(seriesFile),
          "id"
        )
      : null;

    const setFiles = readdirSync(
      seriesFolder.path
    )
      .filter(
        (name) => extname(name) === ".ts"
      )
      .sort();

    for (const setFile of setFiles) {
      const setPath = join(
        seriesFolder.path,
        setFile
      );

      const setObject =
        parseDefaultObject(setPath);

      const setId =
        readStringProperty(setObject, "id");

      if (!setId) {
        continue;
      }

      const setName =
        readEnglishProperty(
          setObject,
          "name"
        ) || setId;

      const folderName =
        basename(setFile, ".ts");

      const cardsFolder = join(
        seriesFolder.path,
        folderName
      );

      const cardFiles = existsSync(cardsFolder)
        ? readdirSync(cardsFolder)
            .filter(
              (name) =>
                extname(name) === ".ts"
            )
            .sort()
        : [];

      const cardCount =
        cardFiles.length ||
        readNestedNumberProperty(
          setObject,
          "cardCount",
          "total"
        ) ||
        readNestedNumberProperty(
          setObject,
          "cardCount",
          "official"
        ) ||
        0;

      const releasedAt =
        normalizeDate(
          readStringProperty(
            setObject,
            "releaseDate"
          )
        );

      const assetBase = seriesId
        ? `https://assets.tcgdex.net/en/${seriesId}/${setId}`
        : null;

      setRows.push({
        external_id: setId,
        data_source: "tcgdex",
        name: setName,
        category: "Pokemon",
        code: setId,
        card_count: cardCount,
        released_at: releasedAt,
        set_type: null,
        series_id: seriesId,
        logo_url: assetBase
          ? `${assetBase}/logo.webp`
          : null,
        symbol_url: seriesId
          ? `https://assets.tcgdex.net/univ/${seriesId}/${setId}/symbol.webp`
          : null,
        external_updated_at: now,
      });

      for (const cardFile of cardFiles) {
        const cardPath = join(
          cardsFolder,
          cardFile
        );

        const cardObject =
          parseDefaultObject(cardPath);

        if (!cardObject) {
          continue;
        }

        const localId =
          basename(cardFile, ".ts");

        const cardName =
          readEnglishProperty(
            cardObject,
            "name"
          );

        if (!cardName) {
          continue;
        }

        const variant =
          readVariant(cardObject);

        cardRows.push({
          external_id:
            `${setId}-${localId}`,
          data_source: "tcgdex",
          name: cardName,
          set_name: setName,
          card_number: localId,
          image_url: assetBase
            ? `${assetBase}/${localId}/high.webp`
            : "",
          category: "Pokemon",
          rarity:
            readStringProperty(
              cardObject,
              "rarity"
            ),
          edition: variant.edition,
          finish: variant.finish,
          external_updated_at: now,
        });
      }

      console.log(
        `${setName}: ${cardFiles.length} cards`
      );
    }
  }

  console.log(
    `\nPrepared ${setRows.length} sets and ${cardRows.length} cards.`
  );

  await upsertBatches(
    "catalog_sets",
    setRows,
    250
  );

  await upsertBatches(
    "cards",
    cardRows,
    400
  );

  console.log(
    "\nPokémon catalog sync complete. MintRadar can now serve Pokémon from Supabase without waiting on api.tcgdex.net.\n"
  );
}

function refreshRepository() {
  mkdirSync(
    join(ROOT, ".cache"),
    { recursive: true }
  );

  if (
    existsSync(
      join(CACHE_DIR, ".git")
    )
  ) {
    console.log(
      "Refreshing TCGdex database mirror..."
    );

    execFileSync(
      "git",
      [
        "-C",
        CACHE_DIR,
        "fetch",
        "--depth",
        "1",
        "origin",
        "master",
      ],
      { stdio: "inherit" }
    );

    execFileSync(
      "git",
      [
        "-C",
        CACHE_DIR,
        "reset",
        "--hard",
        "origin/master",
      ],
      { stdio: "inherit" }
    );

    return;
  }

  if (existsSync(CACHE_DIR)) {
    rmSync(
      CACHE_DIR,
      {
        recursive: true,
        force: true,
      }
    );
  }

  console.log(
    "Cloning TCGdex database mirror..."
  );

  execFileSync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "https://github.com/tcgdex/cards-database.git",
      CACHE_DIR,
    ],
    { stdio: "inherit" }
  );
}

function parseDefaultObject(
  filePath: string
): ts.ObjectLiteralExpression | null {
  const sourceText =
    readFileSync(filePath, "utf8");

  const sourceFile =
    ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS
    );

  let found:
    ts.ObjectLiteralExpression | null =
      null;

  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement)
    ) {
      continue;
    }

    for (
      const declaration of
      statement.declarationList.declarations
    ) {
      if (
        declaration.initializer &&
        ts.isObjectLiteralExpression(
          declaration.initializer
        )
      ) {
        found = declaration.initializer;
        break;
      }
    }

    if (found) {
      break;
    }
  }

  return found;
}

function propertyName(
  property: ts.ObjectLiteralElementLike
) {
  if (!property.name) {
    return null;
  }

  if (
    ts.isIdentifier(property.name) ||
    ts.isStringLiteral(property.name) ||
    ts.isNumericLiteral(property.name)
  ) {
    return property.name.text;
  }

  return null;
}

function getPropertyInitializer(
  object:
    | ts.ObjectLiteralExpression
    | null,
  name: string
): ts.Expression | null {
  if (!object) {
    return null;
  }

  for (const property of object.properties) {
    if (
      !ts.isPropertyAssignment(property)
    ) {
      continue;
    }

    if (
      propertyName(property) === name
    ) {
      return property.initializer;
    }
  }

  return null;
}

function expressionString(
  expression:
    | ts.Expression
    | null
): string | null {
  if (!expression) {
    return null;
  }

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(
      expression
    )
  ) {
    return expression.text;
  }

  return null;
}

function expressionNumber(
  expression:
    | ts.Expression
    | null
): number | null {
  if (
    expression &&
    ts.isNumericLiteral(expression)
  ) {
    return Number(expression.text);
  }

  return null;
}

function readStringProperty(
  object:
    | ts.ObjectLiteralExpression
    | null,
  name: string
) {
  return expressionString(
    getPropertyInitializer(
      object,
      name
    )
  );
}

function readEnglishProperty(
  object:
    | ts.ObjectLiteralExpression
    | null,
  name: string
) {
  const value =
    getPropertyInitializer(
      object,
      name
    );

  const direct =
    expressionString(value);

  if (direct) {
    return direct;
  }

  if (
    value &&
    ts.isObjectLiteralExpression(value)
  ) {
    const english =
      expressionString(
        getPropertyInitializer(
          value,
          "en"
        )
      );

    if (english) {
      return english;
    }

    for (
      const property of value.properties
    ) {
      if (
        ts.isPropertyAssignment(property)
      ) {
        const fallback =
          expressionString(
            property.initializer
          );

        if (fallback) {
          return fallback;
        }
      }
    }
  }

  return null;
}

function readNestedNumberProperty(
  object:
    | ts.ObjectLiteralExpression
    | null,
  parent: string,
  child: string
) {
  const parentValue =
    getPropertyInitializer(
      object,
      parent
    );

  if (
    !parentValue ||
    !ts.isObjectLiteralExpression(
      parentValue
    )
  ) {
    return null;
  }

  return expressionNumber(
    getPropertyInitializer(
      parentValue,
      child
    )
  );
}

function normalizeDate(
  value: string | null
) {
  if (!value) {
    return null;
  }

  const match =
    value.match(
      /^\d{4}-\d{2}-\d{2}$/
    );

  return match
    ? value
    : null;
}

function readVariant(
  object:
    | ts.ObjectLiteralExpression
    | null
): {
  edition: string | null;
  finish: string | null;
} {
  const variants =
    getPropertyInitializer(
      object,
      "variants"
    );

  if (
    !variants ||
    !ts.isArrayLiteralExpression(
      variants
    )
  ) {
    return {
      edition: null,
      finish: null,
    };
  }

  const variantStrings =
    new Set<string>();

  for (
    const element of variants.elements
  ) {
    if (
      !ts.isObjectLiteralExpression(
        element
      )
    ) {
      continue;
    }

    for (
      const field of [
        "type",
        "subtype",
      ]
    ) {
      const value =
        readStringProperty(
          element,
          field
        );

      if (value) {
        variantStrings.add(
          value.toLowerCase()
        );
      }
    }

    const stamp =
      getPropertyInitializer(
        element,
        "stamp"
      );

    if (
      stamp &&
      ts.isArrayLiteralExpression(stamp)
    ) {
      for (
        const stampItem of
        stamp.elements
      ) {
        const value =
          expressionString(
            stampItem
          );

        if (value) {
          variantStrings.add(
            value.toLowerCase()
          );
        }
      }
    }
  }

  const edition =
    variantStrings.has(
      "1st-edition"
    )
      ? "1st Edition"
      : null;

  let finish:
    string | null = null;

  if (
    variantStrings.has("holo")
  ) {
    finish = "Holo";
  } else if (
    variantStrings.has("reverse")
  ) {
    finish = "Reverse Holo";
  } else if (
    variantStrings.has("normal")
  ) {
    finish = "Non-Holo";
  }

  return {
    edition,
    finish,
  };
}

async function upsertBatches(
  table: string,
  rows: Record<
    string,
    unknown
  >[],
  batchSize: number
) {
  for (
    let start = 0;
    start < rows.length;
    start += batchSize
  ) {
    const batch =
      rows.slice(
        start,
        start + batchSize
      );

    const { error } =
      await supabase
        .from(table)
        .upsert(
          batch,
          {
            onConflict:
              "data_source,external_id",
          }
        );

    if (error) {
      throw new Error(
        `${table} upsert failed at row ${start}: ${error.message}`
      );
    }

    console.log(
      `${table}: ${Math.min(
        start + batch.length,
        rows.length
      )}/${rows.length}`
    );
  }
}

function loadEnvFile(
  filePath: string
) {
  if (!existsSync(filePath)) {
    return;
  }

  const contents =
    readFileSync(
      filePath,
      "utf8"
    );

  for (
    const rawLine of
    contents.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const index =
      line.indexOf("=");

    if (index < 1) {
      continue;
    }

    const key =
      line
        .slice(0, index)
        .trim();

    let value =
      line
        .slice(index + 1)
        .trim();

    if (
      (value.startsWith('"') &&
        value.endsWith('"')) ||
      (value.startsWith("'") &&
        value.endsWith("'"))
    ) {
      value =
        value.slice(
          1,
          -1
        );
    }

    if (
      !process.env[key]
    ) {
      process.env[key] =
        value;
    }
  }
}

main().catch((error) => {
  console.error(
    "\nPokémon sync failed:",
    error
  );
  process.exit(1);
});
