"use client";

import { useEffect, useMemo, useState } from "react";

type CatalogType =
  | "Pokemon"
  | "Sports"
  | "Magic: The Gathering"
  | "Yu-Gi-Oh!"
  | "Lorcana"
  | "One Piece";

type CatalogCard = {
  external_id: string;
  data_source: string;
  name?: string | null;
  set_name?: string | null;
  set_id?: string | null;
  card_number?: string | null;
  image_url?: string | null;
  category?: string | null;
  rarity?: string | null;
  edition?: string | null;
  finish?: string | null;
  illustrator?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  release_name?: string | null;
  parallel_name?: string | null;
  sport?: string | null;
  print_run?: number | null;
  rookie?: boolean | null;
};

type VendorInventorySearchItem = {
  id: string;
  price?: number | null;
  quantity?: number | null;
  listing_type?: string | null;
  condition?: string | null;
  grading_company?: string | null;
  grade?: string | null;
  cert_number?: string | null;
  cards?: {
    id?: string | null;
    external_id?: string | null;
    name?: string | null;
    set_name?: string | null;
    card_number?: string | null;
    image_url?: string | null;
    category?: string | null;
    rarity?: string | null;
    edition?: string | null;
    finish?: string | null;
  } | null;
};

type AnalyzerCardRow = {
  localId: string;
  card: CatalogCard | null;
  catalogType: CatalogType;

  itemType: "raw" | "slab" | "sealed";

  condition: string;

  gradingCompany: string;
  grade: string;
  certNumber: string;

  sealedCondition: string;

  marketValue: string;
  percentage: number;
};

const CATALOG_TYPES: CatalogType[] = [
  "Pokemon",
  "Sports",
  "Magic: The Gathering",
  "Yu-Gi-Oh!",
  "Lorcana",
  "One Piece",
];

const QUICK_PERCENTAGES = [60, 65, 70, 75, 80];

const TCG_CONDITIONS = [
  "NM",
  "LP",
  "MP",
  "HP",
  "DMG",
];

const GRADING_COMPANIES = [
  "PSA",
  "BGS",
  "CGC",
  "SGC",
  "TAG",
  "Other",
];

const SEALED_CONDITIONS = [
  "Factory Sealed",
  "Sealed - Minor Wear",
  "Sealed - Damaged Box",
];

function newRow(): AnalyzerCardRow {
  return {
    localId: crypto.randomUUID(),
    card: null,
    catalogType: "Pokemon",

    itemType: "raw",

    condition: "NM",

    gradingCompany: "",
    grade: "",
    certNumber: "",

    sealedCondition: "Factory Sealed",

    marketValue: "",
    percentage: 70,
  };
}

function catalogEndpoint(
  catalogType: CatalogType
) {
  switch (catalogType) {
    case "Magic: The Gathering":
      return "/api/catalog/mtg";
    case "Yu-Gi-Oh!":
      return "/api/catalog/yugioh";
    case "Lorcana":
      return "/api/catalog/lorcana";
    case "One Piece":
      return "/api/catalog/onepiece";
    case "Sports":
      return "/api/catalog/sports";
    default:
      return "/api/catalog/search";
  }
}

function numericValue(
  value: string | number | null | undefined
) {
  const number = Number(value ?? 0);
  return Number.isFinite(number)
    ? number
    : 0;
}

function money(value: number) {
  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency: "USD",
    }
  ).format(value);
}

function cardSecondaryLine(
  card: CatalogCard
) {
  return [
    card.year,
    card.manufacturer,
    card.release_name ||
      card.set_name,
  ]
    .filter(Boolean)
    .join(" • ");
}

function cardDetailLine(
  card: CatalogCard
) {
  return [
    card.parallel_name ||
      card.finish,
    card.card_number
      ? `#${card.card_number}`
      : null,
    card.rarity,
    card.edition,
  ]
    .filter(Boolean)
    .join(" • ");
}

function isTcgCatalog(
  catalogType: CatalogType
) {
  return catalogType !== "Sports";
}

function isSportsCard(
  card: CatalogCard
) {
  const value = [
    card.category,
    card.sport,
    card.data_source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return [
    "sports",
    "baseball",
    "basketball",
    "football",
    "soccer",
    "hockey",
    "wrestling",
    "racing",
    "golf",
  ].some((term) =>
    value.includes(term)
  );
}

function inventorySearchText(
  item: VendorInventorySearchItem
) {
  return [
    item.cards?.name,
    item.cards?.set_name,
    item.cards?.card_number,
    item.cards?.finish,
    item.cards?.edition,
    item.condition,
    item.grading_company,
    item.grade,
    item.cert_number,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inventoryTitle(
  item: VendorInventorySearchItem
) {
  return (
    item.cards?.name ||
    "Unknown Collectible"
  );
}

function inventorySubtitle(
  item: VendorInventorySearchItem
) {
  return [
    item.cards?.set_name,
    item.cards?.card_number
      ? `#${item.cards.card_number}`
      : null,
    item.cards?.finish,
    item.cards?.edition,
  ]
    .filter(Boolean)
    .join(" • ");
}

function inventoryOwnership(
  item: VendorInventorySearchItem
) {
  if (
    item.listing_type === "graded" ||
    item.grading_company ||
    item.grade
  ) {
    return (
      [
        item.grading_company,
        item.grade,
      ]
        .filter(Boolean)
        .join(" ") || "Slab"
    );
  }

  return (
    item.condition ||
    "Raw"
  );
}


type ResilientCardImageProps = {
  src?: string | null;
  name?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  category?: string | null;
  dataSource?: string | null;
  externalId?: string | null;
  className?: string;
  emptyLabel?: string;
};

function ResilientCardImage({
  src,
  name,
  setName,
  cardNumber,
  category,
  dataSource,
  externalId,
  className = "h-full w-full object-contain",
  emptyLabel = "No Image",
}: ResilientCardImageProps) {
  const [currentSrc, setCurrentSrc] =
    useState<string | null>(src || null);

  const [
    pokemonFallbackAttempted,
    setPokemonFallbackAttempted,
  ] = useState(false);

  const [
    sportsFallbackAttempted,
    setSportsFallbackAttempted,
  ] = useState(false);

  const [imageFailed, setImageFailed] =
    useState(false);

  const normalizedCategory =
    (category || "").trim().toLowerCase();

  const normalizedSource =
    (dataSource || "").trim().toLowerCase();

  const isPokemon =
    normalizedCategory === "pokemon" ||
    normalizedSource.includes("tcgdex");

  const isSports =
    normalizedSource.includes("cardsight") ||
    [
      "sports",
      "baseball",
      "basketball",
      "football",
      "soccer",
      "hockey",
      "wrestling",
      "racing",
      "golf",
    ].some((term) =>
      normalizedCategory.includes(term)
    );

  useEffect(() => {
    setCurrentSrc(src || null);
    setPokemonFallbackAttempted(false);
    setSportsFallbackAttempted(false);
    setImageFailed(false);
  }, [
    src,
    name,
    setName,
    cardNumber,
    category,
    dataSource,
    externalId,
  ]);

  async function tryPokemonFallback() {
    if (
      !isPokemon ||
      pokemonFallbackAttempted ||
      !name?.trim()
    ) {
      return false;
    }

    setPokemonFallbackAttempted(true);

    try {
      const params = new URLSearchParams({
        name: name.trim(),
      });

      if (setName?.trim()) {
        params.set(
          "setName",
          setName.trim()
        );
      }

      if (cardNumber?.trim()) {
        params.set(
          "cardNumber",
          cardNumber.trim()
        );
      }

      const response = await fetch(
        `/api/catalog/pokemon-image-fallback?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      if (!response.ok) {
        return false;
      }

      const payload = (await response.json()) as {
        ok?: boolean;
        imageUrl?: string | null;
      };

      if (
        !payload.ok ||
        !payload.imageUrl
      ) {
        return false;
      }

      setCurrentSrc(payload.imageUrl);
      setImageFailed(false);
      return true;
    } catch (error) {
      console.error(
        "Pokémon image fallback failed:",
        error
      );
      return false;
    }
  }

  function trySportsFallback() {
    if (
      !isSports ||
      sportsFallbackAttempted ||
      !externalId?.trim()
    ) {
      return false;
    }

    setSportsFallbackAttempted(true);
    setCurrentSrc(
      `/api/catalog/sports-image?id=${encodeURIComponent(
        externalId.trim()
      )}`
    );
    setImageFailed(false);
    return true;
  }

  async function tryNextFallback() {
    if (isPokemon) {
      const ok =
        await tryPokemonFallback();

      if (ok) return;
    }

    if (isSports) {
      const started =
        trySportsFallback();

      if (started) return;
    }

    setImageFailed(true);
  }

  useEffect(() => {
    if (
      !currentSrc &&
      !imageFailed
    ) {
      void tryNextFallback();
    }
  }, [
    currentSrc,
    imageFailed,
    isPokemon,
    isSports,
    pokemonFallbackAttempted,
    sportsFallbackAttempted,
  ]);

  if (imageFailed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
        <p className="text-[9px] font-black uppercase tracking-[0.12em] text-emerald-400">
          MintRadar
        </p>
        <p className="mt-1 text-[10px] text-zinc-700">
          {emptyLabel}
        </p>
      </div>
    );
  }

  if (!currentSrc) {
    return (
      <div className="flex h-full w-full items-center justify-center p-2 text-center text-[10px] text-zinc-700">
        Loading...
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={name || "Trading card"}
      className={className}
      onError={() => {
        const usingSportsRoute =
          currentSrc.startsWith(
            "/api/catalog/sports-image?"
          );

        if (usingSportsRoute) {
          setImageFailed(true);
          return;
        }

        void tryNextFallback();
      }}
    />
  );
}

function TradeCompButtons({
  card,
}: {
  card: CatalogCard;
}) {
  const baseQuery = [
    card.name,
    card.year,
    card.manufacturer,
    card.release_name ||
      card.set_name,
    card.card_number
      ? `#${card.card_number}`
      : null,
    card.parallel_name ||
      card.finish,
  ]
    .filter(Boolean)
    .join(" ");

  const encodedQuery =
    encodeURIComponent(
      baseQuery.trim()
    );

  const links = isSportsCard(card)
    ? [
        {
          name: "Card Ladder",
          logo: "/market-logos/cardladder.png",
          href: `https://www.cardladder.com/ladder?query=${encodedQuery}`,
        },
        {
          name: "130point",
          logo: "/market-logos/130point.png",
          href: "https://130point.com/search/",
        },
        {
          name: "eBay Sold",
          logo: "/market-logos/ebay.png",
          href: `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&LH_Sold=1&LH_Complete=1`,
        },
      ]
    : [
        {
          name: "TCGplayer",
          logo: "/market-logos/tcgplayer.png",
          href: `https://www.tcgplayer.com/search/all/product?q=${encodedQuery}`,
        },
        {
          name: "PriceCharting",
          logo: "/market-logos/pricecharting.png",
          href: `https://www.pricecharting.com/search-products?q=${encodedQuery}&type=prices`,
        },
        {
          name: "Collectr",
          logo: "/market-logos/collectr.svg",
          href: "https://app.getcollectr.com/",
        },
        {
          name: "130point",
          logo: "/market-logos/130point.png",
          href: "https://130point.com/search/",
        },
        {
          name: "eBay Sold",
          logo: "/market-logos/ebay.png",
          href: `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&LH_Sold=1&LH_Complete=1`,
        },
      ];

  return (
    <div className="mt-3 rounded-xl border border-emerald-400/20 bg-black p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">
        Check Comps
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {links.map(
          (market) => (
            <a
              key={market.name}
              href={market.href}
              target="_blank"
              rel="noreferrer"
              className="group flex min-h-12 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 transition hover:border-emerald-400/40"
              title={market.name}
            >
              <span className="text-xs font-black text-zinc-300 transition group-hover:text-emerald-300">
                {market.name}
              </span>
            </a>
          )
        )}
      </div>
    </div>
  );
}

function CatalogCardSearch({
  catalogType,
  selectedCard,
  onCatalogTypeChange,
  onSelect,
  onClear,
}: {
  catalogType: CatalogType;
  selectedCard: CatalogCard | null;
  onCatalogTypeChange: (
    value: CatalogType
  ) => void;
  onSelect: (
    card: CatalogCard
  ) => void;
  onClear: () => void;
}) {
  const [query, setQuery] =
    useState("");

  const [results, setResults] =
    useState<CatalogCard[]>([]);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    const cleanQuery =
      query.trim();

    if (
      selectedCard ||
      cleanQuery.length < 2
    ) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }

    const controller =
      new AbortController();

    const timer =
      window.setTimeout(
        async () => {
          try {
            setLoading(true);
            setError("");

            const response =
              await fetch(
                `${catalogEndpoint(
                  catalogType
                )}?q=${encodeURIComponent(
                  cleanQuery
                )}&page=1`,
                {
                  signal:
                    controller.signal,
                }
              );

            const data =
              await response.json();

            if (!response.ok) {
              throw new Error(
                data?.error ||
                  "Catalog search failed."
              );
            }

            setResults(
              Array.isArray(
                data?.results
              )
                ? data.results
                : []
            );
          } catch (err) {
            if (
              err instanceof Error &&
              err.name ===
                "AbortError"
            ) {
              return;
            }

            console.error(
              "Trade analyzer catalog search error:",
              err
            );

            setError(
              err instanceof Error
                ? err.message
                : "Something went wrong while searching."
            );

            setResults([]);
          } finally {
            if (
              !controller
                .signal.aborted
            ) {
              setLoading(false);
            }
          }
        },
        350
      );

    return () => {
      window.clearTimeout(
        timer
      );
      controller.abort();
    };
  }, [
    query,
    catalogType,
    selectedCard,
  ]);

  if (selectedCard) {
    return (
      <div className="rounded-2xl border border-zinc-900 bg-black p-4">
        <div className="flex gap-4">
          <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            <ResilientCardImage
              src={selectedCard.image_url}
              name={selectedCard.name}
              setName={selectedCard.set_name}
              cardNumber={selectedCard.card_number}
              category={selectedCard.category}
              dataSource={selectedCard.data_source}
              externalId={selectedCard.external_id}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-black text-white">
                  {selectedCard.name ||
                    "Unknown Card"}
                </p>

                <p className="mt-1 text-xs text-zinc-500">
                  {cardSecondaryLine(
                    selectedCard
                  )}
                </p>

                <p className="mt-1 text-xs text-zinc-700">
                  {cardDetailLine(
                    selectedCard
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClear();
                  setQuery("");
                  setResults([]);
                }}
                className="shrink-0 text-xs font-black uppercase tracking-wider text-zinc-600 transition hover:text-white"
              >
                Change
              </button>
            </div>

            <TradeCompButtons
              card={selectedCard}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-900 bg-black p-4">
      <div className="flex flex-wrap gap-2">
        {CATALOG_TYPES.map(
          (type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                onCatalogTypeChange(
                  type
                );
                setQuery("");
                setResults([]);
              }}
              className={`rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-wider transition ${
                catalogType === type
                  ? "border-emerald-400 bg-emerald-400 text-black"
                  : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-white"
              }`}
            >
              {type ===
              "Magic: The Gathering"
                ? "MTG"
                : type}
            </button>
          )
        )}
      </div>

      <input
        type="text"
        value={query}
        onChange={(event) =>
          setQuery(
            event.target.value
          )
        }
        placeholder="Search card name, set, number, parallel..."
        className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-zinc-700 focus:border-emerald-400/50"
      />

      {loading && (
        <p className="mt-3 text-sm font-bold text-emerald-400">
          Searching catalog...
        </p>
      )}

      {error && (
        <p className="mt-3 text-sm font-bold text-red-300">
          {error}
        </p>
      )}

      {!loading &&
        query.trim().length >= 2 &&
        !error &&
        results.length === 0 && (
          <p className="mt-3 text-sm text-zinc-600">
            No matching cards found.
          </p>
        )}

      {results.length > 0 && (
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
          {results
            .slice(0, 30)
            .map(
              (card, index) => (
                <button
                  key={`${card.data_source}-${card.external_id}-${index}`}
                  type="button"
                  onClick={() => {
                    onSelect(card);
                    setQuery("");
                    setResults([]);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-zinc-900 bg-zinc-950 p-3 text-left transition hover:border-emerald-400/30 hover:bg-zinc-900"
                >
                  <div className="flex h-20 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-900 bg-black">
                    <ResilientCardImage
                      src={card.image_url}
                      name={card.name}
                      setName={card.set_name}
                      cardNumber={card.card_number}
                      category={card.category}
                      dataSource={card.data_source}
                      externalId={card.external_id}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-black text-white">
                      {card.name ||
                        "Unknown Card"}
                    </p>

                    <p className="mt-1 text-xs text-zinc-500">
                      {cardSecondaryLine(
                        card
                      )}
                    </p>

                    <p className="mt-1 text-xs text-zinc-700">
                      {cardDetailLine(
                        card
                      )}
                    </p>
                  </div>
                </button>
              )
            )}
        </div>
      )}
    </div>
  );
}

export default function TradeAnalyzer({
  inventory,
}: {
  inventory: VendorInventorySearchItem[];
}) {
  const [open, setOpen] =
    useState(false);

  const [
    targetInventory,
    setTargetInventory,
  ] =
    useState<VendorInventorySearchItem | null>(
      null
    );

  const [
    inventorySearch,
    setInventorySearch,
  ] = useState("");

  const [
    targetMarketValue,
    setTargetMarketValue,
  ] = useState("");

  const [
    offeredRows,
    setOfferedRows,
  ] =
    useState<AnalyzerCardRow[]>([
      newRow(),
    ]);

  const filteredInventory =
    useMemo(() => {
      const query =
        inventorySearch
          .trim()
          .toLowerCase();

      const activeInventory =
        inventory.filter(
          (item) =>
            Number(
              item.quantity || 0
            ) > 0
        );

      if (!query) {
        return activeInventory.slice(
          0,
          30
        );
      }

      return activeInventory
        .filter((item) =>
          inventorySearchText(
            item
          ).includes(query)
        )
        .slice(0, 30);
    }, [
      inventory,
      inventorySearch,
    ]);

  const offeredMarketTotal =
    useMemo(
      () =>
        offeredRows.reduce(
          (sum, row) =>
            sum +
            numericValue(
              row.marketValue
            ),
          0
        ),
      [offeredRows]
    );

  const offeredTradeTotal =
    useMemo(
      () =>
        offeredRows.reduce(
          (sum, row) =>
            sum +
            numericValue(
              row.marketValue
            ) *
              (row.percentage /
                100),
          0
        ),
      [offeredRows]
    );

  const targetValue =
    numericValue(
      targetMarketValue
    );

  const difference =
    targetValue -
    offeredTradeTotal;

  function updateRow(
    localId: string,
    patch: Partial<AnalyzerCardRow>
  ) {
    setOfferedRows(
      (current) =>
        current.map((row) =>
          row.localId ===
          localId
            ? {
                ...row,
                ...patch,
              }
            : row
        )
    );
  }

  function addRow() {
    setOfferedRows(
      (current) => [
        ...current,
        newRow(),
      ]
    );
  }

  function removeRow(
    localId: string
  ) {
    setOfferedRows(
      (current) => {
        if (
          current.length === 1
        ) {
          return [newRow()];
        }

        return current.filter(
          (row) =>
            row.localId !==
            localId
        );
      }
    );
  }

  function resetAnalyzer() {
    setTargetInventory(null);
    setInventorySearch("");
    setTargetMarketValue("");
    setOfferedRows([
      newRow(),
    ]);
  }

  function selectTargetInventory(
    item: VendorInventorySearchItem
  ) {
    setTargetInventory(item);
    setInventorySearch("");

    if (
      item.price != null
    ) {
      setTargetMarketValue(
        String(item.price)
      );
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() =>
          setOpen(true)
        }
        className="bg-zinc-950 hover:bg-zinc-900 border border-emerald-400/30 text-emerald-300 font-black px-6 py-4 rounded-xl text-center transition"
      >
        Trade Analyzer
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-5"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setOpen(false);
            }
          }}
        >
          <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-900 p-5 sm:p-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                  MintRadar
                </p>

                <h2 className="mt-2 text-3xl font-black">
                  Trade Analyzer
                </h2>

                <p className="mt-1 max-w-2xl text-sm text-zinc-500">
                  Build an in-person multi-card trade from your live inventory. Your listing stays at full market value while each customer card gets its own comp and trade percentage.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setOpen(false)
                }
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-black text-xl text-zinc-400 transition hover:text-white"
                aria-label="Close Trade Analyzer"
              >
                ×
              </button>
            </div>

            <div className="space-y-6 p-5 sm:p-6">
              <section>
                <div className="mb-3">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                    Search Inventory
                  </p>

                  <p className="mt-1 text-sm text-zinc-600">
                    Choose the card the customer is shopping from your current inventory.
                  </p>
                </div>

                {!targetInventory ? (
                  <div className="rounded-2xl border border-zinc-900 bg-black p-4">
                    <input
                      type="text"
                      value={
                        inventorySearch
                      }
                      onChange={(
                        event
                      ) =>
                        setInventorySearch(
                          event.target.value
                        )
                      }
                      placeholder="Search your inventory by card, set, number, grade..."
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-zinc-700 focus:border-emerald-400/50"
                    />

                    <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                      {filteredInventory.length ===
                      0 ? (
                        <p className="py-5 text-center text-sm text-zinc-600">
                          No active inventory matches that search.
                        </p>
                      ) : (
                        filteredInventory.map(
                          (item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() =>
                                selectTargetInventory(
                                  item
                                )
                              }
                              className="flex w-full items-center gap-3 rounded-xl border border-zinc-900 bg-zinc-950 p-3 text-left transition hover:border-emerald-400/30 hover:bg-zinc-900"
                            >
                              <div className="flex h-20 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-900 bg-black">
                                <ResilientCardImage
                                  src={item.cards?.image_url}
                                  name={item.cards?.name}
                                  setName={item.cards?.set_name}
                                  cardNumber={item.cards?.card_number}
                                  category={item.cards?.category}
                                  externalId={item.cards?.external_id}
                                />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate font-black text-white">
                                      {inventoryTitle(
                                        item
                                      )}
                                    </p>

                                    <p className="mt-1 text-xs text-zinc-500">
                                      {inventorySubtitle(
                                        item
                                      )}
                                    </p>

                                    <p className="mt-1 text-xs text-zinc-700">
                                      {inventoryOwnership(
                                        item
                                      )}{" "}
                                      • Qty{" "}
                                      {item.quantity ?? 0}
                                    </p>
                                  </div>

                                  <p className="shrink-0 font-black text-emerald-300">
                                    {money(
                                      numericValue(
                                        item.price
                                      )
                                    )}
                                  </p>
                                </div>
                              </div>
                            </button>
                          )
                        )
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-emerald-400/20 bg-black p-4">
                    <div className="flex gap-4">
                      <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
                        <ResilientCardImage
                          src={targetInventory.cards?.image_url}
                          name={targetInventory.cards?.name}
                          setName={targetInventory.cards?.set_name}
                          cardNumber={targetInventory.cards?.card_number}
                          category={targetInventory.cards?.category}
                          externalId={targetInventory.cards?.external_id}
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-lg font-black text-white">
                              {inventoryTitle(
                                targetInventory
                              )}
                            </p>

                            <p className="mt-1 text-xs text-zinc-500">
                              {inventorySubtitle(
                                targetInventory
                              )}
                            </p>

                            <p className="mt-2 text-xs text-zinc-700">
                              {inventoryOwnership(
                                targetInventory
                              )}{" "}
                              • Qty{" "}
                              {targetInventory.quantity ??
                                0}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setTargetInventory(
                                null
                              );
                              setTargetMarketValue(
                                ""
                              );
                            }}
                            className="shrink-0 text-xs font-black uppercase tracking-wider text-zinc-600 transition hover:text-white"
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-3">
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                    Inventory Market Value
                  </label>

                  <div className="mt-2 flex items-center rounded-xl border border-zinc-800 bg-black px-4 focus-within:border-emerald-400">
                    <span className="font-black text-zinc-500">
                      $
                    </span>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={
                        targetMarketValue
                      }
                      onChange={(
                        event
                      ) =>
                        setTargetMarketValue(
                          event.target
                            .value
                        )
                      }
                      placeholder="500.00"
                      className="w-full bg-transparent px-2 py-4 text-xl font-black text-white outline-none"
                    />
                  </div>

                  {targetInventory?.price !=
                    null && (
                    <p className="mt-1.5 text-xs text-zinc-700">
                      Started from your current listing price. Adjust if the market has moved.
                    </p>
                  )}
                </div>
              </section>

              <section>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                      Customer Cards
                    </p>

                    <p className="mt-1 text-sm text-zinc-600">
                      Add every raw card, slab, or sealed product the customer is offering and comp each item separately.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={addRow}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-sm font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black"
                  >
                    + Add Another Card
                  </button>
                </div>

                <div className="mt-4 space-y-4">
                  {offeredRows.map(
                    (row, index) => {
                      const marketValue =
                        numericValue(
                          row.marketValue
                        );

                      const tradeValue =
                        marketValue *
                        (row.percentage /
                          100);

                      return (
                        <article
                          key={
                            row.localId
                          }
                          className="rounded-2xl border border-zinc-900 bg-black p-4"
                        >
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-sm font-black text-white">
                              Customer Card{" "}
                              {index + 1}
                            </p>

                            <button
                              type="button"
                              onClick={() =>
                                removeRow(
                                  row.localId
                                )
                              }
                              className="text-xs font-black uppercase tracking-wider text-zinc-700 transition hover:text-red-300"
                            >
                              Remove
                            </button>
                          </div>

                          <CatalogCardSearch
                            catalogType={
                              row.catalogType
                            }
                            selectedCard={
                              row.card
                            }
                            onCatalogTypeChange={(
                              value
                            ) =>
                              updateRow(
                                row.localId,
                                {
                                  catalogType:
                                    value,
                                  card: null,
                                }
                              )
                            }
                            onSelect={(
                              card
                            ) =>
                              updateRow(
                                row.localId,
                                {
                                  card,
                                }
                              )
                            }
                            onClear={() =>
                              updateRow(
                                row.localId,
                                {
                                  card: null,
                                }
                              )
                            }
                          />

                          <div className="mt-4">
                            <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                              Item Type
                            </label>

                            <div className="mt-2 grid grid-cols-3 gap-2">
                              {[
                                ["raw", "Raw Card"],
                                ["slab", "Slab"],
                                ["sealed", "Sealed Product"],
                              ].map(
                                ([value, label]) => (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() =>
                                      updateRow(
                                        row.localId,
                                        {
                                          itemType:
                                            value as
                                              | "raw"
                                              | "slab"
                                              | "sealed",
                                        }
                                      )
                                    }
                                    className={`rounded-xl border px-3 py-3 text-xs font-black transition ${
                                      row.itemType ===
                                      value
                                        ? "border-emerald-400 bg-emerald-400 text-black"
                                        : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-white"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                )
                              )}
                            </div>
                          </div>

                          {row.itemType ===
                            "raw" &&
                            isTcgCatalog(
                              row.catalogType
                            ) && (
                            <div className="mt-4">
                              <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                                Condition
                              </label>

                              <div className="mt-2 grid grid-cols-5 gap-2">
                                {TCG_CONDITIONS.map(
                                  (
                                    condition
                                  ) => (
                                    <button
                                      key={
                                        condition
                                      }
                                      type="button"
                                      onClick={() =>
                                        updateRow(
                                          row.localId,
                                          {
                                            condition,
                                          }
                                        )
                                      }
                                      className={`rounded-lg border px-2 py-2 text-xs font-black transition ${
                                        row.condition ===
                                        condition
                                          ? "border-emerald-400 bg-emerald-400 text-black"
                                          : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-white"
                                      }`}
                                    >
                                      {
                                        condition
                                      }
                                    </button>
                                  )
                                )}
                              </div>
                            </div>
                          )}

                          {row.itemType ===
                            "slab" && (
                            <div className="mt-4 grid gap-4 md:grid-cols-3">
                              <div>
                                <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                                  Grading Company
                                </label>

                                <select
                                  value={
                                    row.gradingCompany
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    updateRow(
                                      row.localId,
                                      {
                                        gradingCompany:
                                          event.target
                                            .value,
                                      }
                                    )
                                  }
                                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm font-black text-white outline-none focus:border-emerald-400/50"
                                >
                                  <option value="">
                                    Select
                                  </option>

                                  {GRADING_COMPANIES.map(
                                    (
                                      company
                                    ) => (
                                      <option
                                        key={
                                          company
                                        }
                                        value={
                                          company
                                        }
                                      >
                                        {
                                          company
                                        }
                                      </option>
                                    )
                                  )}
                                </select>
                              </div>

                              <div>
                                <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                                  Grade
                                </label>

                                <input
                                  type="text"
                                  value={
                                    row.grade
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    updateRow(
                                      row.localId,
                                      {
                                        grade:
                                          event.target
                                            .value,
                                      }
                                    )
                                  }
                                  placeholder="10"
                                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm font-black text-white outline-none placeholder:text-zinc-700 focus:border-emerald-400/50"
                                />
                              </div>

                              <div>
                                <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                                  Cert # — Optional
                                </label>

                                <input
                                  type="text"
                                  value={
                                    row.certNumber
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    updateRow(
                                      row.localId,
                                      {
                                        certNumber:
                                          event.target
                                            .value,
                                      }
                                    )
                                  }
                                  placeholder="Certification number"
                                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm font-black text-white outline-none placeholder:text-zinc-700 focus:border-emerald-400/50"
                                />
                              </div>
                            </div>
                          )}

                          {row.itemType ===
                            "sealed" && (
                            <div className="mt-4">
                              <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                                Sealed Condition
                              </label>

                              <select
                                value={
                                  row.sealedCondition
                                }
                                onChange={(
                                  event
                                ) =>
                                  updateRow(
                                    row.localId,
                                    {
                                      sealedCondition:
                                        event.target
                                          .value,
                                    }
                                  )
                                }
                                className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm font-black text-white outline-none focus:border-emerald-400/50"
                              >
                                {SEALED_CONDITIONS.map(
                                  (
                                    condition
                                  ) => (
                                    <option
                                      key={
                                        condition
                                      }
                                      value={
                                        condition
                                      }
                                    >
                                      {
                                        condition
                                      }
                                    </option>
                                  )
                                )}
                              </select>
                            </div>
                          )}

                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                                Market Value
                              </label>

                              <div className="mt-2 flex items-center rounded-xl border border-zinc-800 bg-zinc-950 px-3 focus-within:border-emerald-400">
                                <span className="font-black text-zinc-600">
                                  $
                                </span>

                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={
                                    row.marketValue
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    updateRow(
                                      row.localId,
                                      {
                                        marketValue:
                                          event
                                            .target
                                            .value,
                                      }
                                    )
                                  }
                                  placeholder="0.00"
                                  className="w-full bg-transparent px-2 py-3 font-black text-white outline-none"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                                Trade Percentage
                              </label>

                              <div className="mt-2 flex items-center rounded-xl border border-zinc-800 bg-zinc-950 px-3 focus-within:border-emerald-400">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="1"
                                  value={
                                    row.percentage
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    updateRow(
                                      row.localId,
                                      {
                                        percentage:
                                          Math.min(
                                            100,
                                            Math.max(
                                              0,
                                              Number(
                                                event
                                                  .target
                                                  .value
                                              ) ||
                                                0
                                            )
                                          ),
                                      }
                                    )
                                  }
                                  className="w-full bg-transparent py-3 font-black text-white outline-none"
                                />

                                <span className="font-black text-zinc-600">
                                  %
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-5 gap-2">
                            {QUICK_PERCENTAGES.map(
                              (
                                percentage
                              ) => (
                                <button
                                  key={
                                    percentage
                                  }
                                  type="button"
                                  onClick={() =>
                                    updateRow(
                                      row.localId,
                                      {
                                        percentage,
                                      }
                                    )
                                  }
                                  className={`rounded-lg border px-2 py-2 text-xs font-black transition ${
                                    row.percentage ===
                                    percentage
                                      ? "border-emerald-400 bg-emerald-400 text-black"
                                      : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-white"
                                  }`}
                                >
                                  {
                                    percentage
                                  }
                                  %
                                </button>
                              )
                            )}
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
                            <div>
                              <span className="text-sm font-bold text-zinc-400">
                                Adjusted Trade Value
                              </span>

                              {row.itemType ===
                                "raw" &&
                                isTcgCatalog(
                                  row.catalogType
                                ) && (
                                <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                                  Raw • Condition:{" "}
                                  {row.condition}
                                </p>
                              )}

                              {row.itemType ===
                                "slab" && (
                                <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                                  Slab
                                  {row.gradingCompany
                                    ? ` • ${row.gradingCompany}`
                                    : ""}
                                  {row.grade
                                    ? ` ${row.grade}`
                                    : ""}
                                </p>
                              )}

                              {row.itemType ===
                                "sealed" && (
                                <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                                  Sealed •{" "}
                                  {
                                    row.sealedCondition
                                  }
                                </p>
                              )}
                            </div>

                            <span className="text-xl font-black text-emerald-300">
                              {money(
                                tradeValue
                              )}
                            </span>
                          </div>
                        </article>
                      );
                    }
                  )}
                </div>
              </section>

              <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.06] p-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                  Deal Summary
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-2xl border border-zinc-900 bg-black p-4">
                    <p className="text-[10px] font-black uppercase tracking-wider text-zinc-700">
                      Inventory Market
                    </p>

                    <p className="mt-2 text-2xl font-black">
                      {money(
                        targetValue
                      )}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-zinc-900 bg-black p-4">
                    <p className="text-[10px] font-black uppercase tracking-wider text-zinc-700">
                      Customer Market
                    </p>

                    <p className="mt-2 text-2xl font-black">
                      {money(
                        offeredMarketTotal
                      )}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-zinc-900 bg-black p-4">
                    <p className="text-[10px] font-black uppercase tracking-wider text-zinc-700">
                      Customer Trade Credit
                    </p>

                    <p className="mt-2 text-2xl font-black text-emerald-300">
                      {money(
                        offeredTradeTotal
                      )}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-zinc-900 bg-black p-4">
                    <p className="text-[10px] font-black uppercase tracking-wider text-zinc-700">
                      Difference
                    </p>

                    <p className={`mt-2 text-2xl font-black ${
                      difference > 0
                        ? "text-amber-300"
                        : difference < 0
                          ? "text-emerald-300"
                          : "text-white"
                    }`}>
                      {money(
                        Math.abs(
                          difference
                        )
                      )}
                    </p>

                    <p className="mt-1 text-xs font-bold text-zinc-600">
                      {difference > 0
                        ? "Customer owes"
                        : difference < 0
                          ? "Vendor owes / over trade"
                          : "Even trade"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-zinc-900 bg-black p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-bold text-zinc-500">
                      Final Deal Position
                    </span>

                    <span className="text-xl font-black text-white">
                      {difference > 0
                        ? `${money(
                            difference
                          )} cash/additional value needed`
                        : difference < 0
                          ? `${money(
                              Math.abs(
                                difference
                              )
                            )} over inventory value`
                          : "Even trade"}
                    </span>
                  </div>
                </div>
              </section>

              <button
                type="button"
                onClick={
                  resetAnalyzer
                }
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm font-black text-zinc-400 transition hover:text-white"
              >
                Reset Analyzer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
