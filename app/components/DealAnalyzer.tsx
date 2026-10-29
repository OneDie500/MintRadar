"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "../../lib/supabase";
import { decodeListingId } from "../../lib/listing-short-code";

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

const QUICK_PERCENTAGES = [60, 65, 70, 75, 80, 85];

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

const ResilientCardImage = memo(function ResilientCardImage({
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
});

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


type DealMode = "buy" | "trade";
type ScanMode = "cards" | "qr";
type ScanPrice = { printing?: string; market_price?: number | null; low_price?: number | null; median_price?: number | null; last_updated_at?: string | null };
type ScanCandidate = { card_id?: number; tcgplayer_id?: number; name?: string; number?: string; rarity?: string; image_url?: string; suggested_printing?: string; set?: { name?: string }; game?: { slug?: string; name?: string }; prices?: ScanPrice[] };
type ScanResult = { ok?: boolean; error?: string; data?: { status?: string; message?: string | null; candidates?: ScanCandidate[]; warnings?: string[] }; meta?: { scans_remaining?: number } };
type ScanCapture = { id: string; image: string; matched: boolean; status: "identifying" | "review" | "error" | "added"; result?: ScanResult; error?: string; selectedIndex: number };

function scanCandidatePrice(candidate: ScanCandidate): ScanPrice | null {
  return candidate.prices?.find(price => price.printing === candidate.suggested_printing) ?? candidate.prices?.[0] ?? null;
}
function scanGameType(candidate: ScanCandidate): CatalogType {
  const slug = (candidate.game?.slug ?? candidate.game?.name ?? "").toLowerCase();
  if (slug.includes("magic")) return "Magic: The Gathering";
  if (slug.includes("yugioh") || slug.includes("yu-gi")) return "Yu-Gi-Oh!";
  if (slug.includes("lorcana")) return "Lorcana";
  if (slug.includes("onepiece") || slug.includes("one piece")) return "One Piece";
  return "Pokemon";
}
function dataUrlToFile(dataUrl: string): File {
  const [header, base64] = dataUrl.split(",");
  if (!header || !base64 || !header.includes("base64")) throw new Error("Camera returned an invalid image.");
  const mime = header.match(/^data:([^;]+)/)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], "mintradar-scan.jpg", { type: mime });
}

function clampPercentage(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export default function DealAnalyzer({ inventory, vendorId }: { inventory: VendorInventorySearchItem[]; vendorId: string | null }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DealMode>("buy");
  const [view, setView] = useState<"scanner" | "summary">("scanner");
  const [cashRate, setCashRate] = useState(70);
  const [tradeRate, setTradeRate] = useState(80);
  const [addedNotice, setAddedNotice] = useState("");
  const [vendorItems, setVendorItems] = useState<VendorInventorySearchItem[]>([]);
  const [qrText, setQrText] = useState("");
  const [qrError, setQrError] = useState("");
  const [rows, setRows] = useState<AnalyzerCardRow[]>(() => [newRow()]);
  const [defaultPercentage, setDefaultPercentage] = useState(70);
  const [creditBonus, setCreditBonus] = useState(0);
  const [targetInventory, setTargetInventory] = useState<VendorInventorySearchItem | null>(null);
  const [inventorySearch, setInventorySearch] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("cards");
  const [qrCandidate, setQrCandidate] = useState<VendorInventorySearchItem | null>(null);
  const [qrScanMessage, setQrScanMessage] = useState("");
  const qrBusyRef = useRef(false);
  const qrLookupRef = useRef(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraBackend, setCameraBackend] = useState<"web" | "native" | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [captures, setCaptures] = useState<ScanCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraRef = useRef(false);
  const nativeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stableFramesRef = useRef(0);
  const [detectionStatus, setDetectionStatus] = useState("Looking for a card…");
  const nativeBusyRef = useRef(false);
  const [nativeCameraBusy, setNativeCameraBusy] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const scanRequestRef = useRef(false);
  const scanSessionRef = useRef(0);

  const activeInventory = useMemo(() => {
    if (!open || mode !== "trade" || targetInventory) return [];
    const query = inventorySearch.trim().toLowerCase();
    return inventory.filter(item => Number(item.quantity ?? 0) > 0 && (!query || inventorySearchText(item).includes(query))).slice(0, 40);
  }, [inventory, inventorySearch, open, mode, targetInventory]);

  const totals = useMemo(() => rows.reduce((sum, row) => {
    const value = Math.max(0, numericValue(row.marketValue));
    return {
      market: sum.market + value,
      cash: sum.cash + value * row.percentage / 100,
      identified: sum.identified + (row.card ? 1 : 0),
    };
  }, { market: 0, cash: 0, identified: 0 }), [rows]);

  const cashOffer = totals.market * cashRate / 100;
  const tradeCredit = totals.market * tradeRate / 100;
  const vendorTotal = vendorItems.reduce((sum, item) => sum + Math.max(0, Number(item.price ?? 0)), 0);
  const targetValue = Math.max(0, numericValue(targetPrice));
  const tradeDifference = vendorTotal - tradeCredit;
  const dealCards = rows.filter(row => row.card);

  function updateRow(id: string, patch: Partial<AnalyzerCardRow>) {
    setRows(current => current.map(row => row.localId === id ? { ...row, ...patch } : row));
  }
  function addRow(card: CatalogCard | null = null) {
    setRows(current => [...current, { ...newRow(), card, percentage: defaultPercentage }]);
  }
  function removeRow(id: string) {
    setRows(current => current.length === 1 ? [{ ...newRow(), percentage: defaultPercentage }] : current.filter(row => row.localId !== id));
  }
  function applyDefault(value: number) {
    const percentage = clampPercentage(value);
    setDefaultPercentage(percentage);
    setRows(current => current.map(row => ({ ...row, percentage })));
  }
  function resetDeal() {
    setRows([{ ...newRow(), percentage: 70 }]);
    setView("scanner");
    setAddedNotice("");
    setVendorItems([]);
    setQrText("");
    setQrError("");
    setQrCandidate(null);
    setQrScanMessage("");
    setScanMode("cards");
    setCashRate(70);
    setTradeRate(80);
    setDefaultPercentage(70);
    setCreditBonus(0);
    setTargetInventory(null);
    setTargetPrice("");
    setInventorySearch("");
    stopCamera();
    scanSessionRef.current += 1;
    setCaptures([]);
    setSelectedCaptureId(null);
  }
  function stopCamera() {
    if (detectionTimerRef.current) { clearInterval(detectionTimerRef.current); detectionTimerRef.current = null; }
    stableFramesRef.current = 0;
    if (nativeTimerRef.current) {
      clearTimeout(nativeTimerRef.current);
      nativeTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (nativeCameraRef.current) {
      nativeCameraRef.current = false;
      void import("@capacitor-community/camera-preview")
        .then(({ CameraPreview }) => CameraPreview.stop())
        .catch(error => console.warn("Native camera cleanup:", error));
    }
    nativeBusyRef.current = false;
    qrBusyRef.current = false;
    setNativeCameraBusy(false);
    setScannerOpen(false);
    setCameraBackend(null);
  }

  async function startCamera() {
    setCameraError("");
    setQrScanMessage("");
    if (nativeBusyRef.current || scanRequestRef.current) return;
    stopCamera();

    // Prefer the WebView camera: it renders INSIDE the scanner frame, so the
    // alignment guides and capture control remain visible on an iPhone.
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1920 } },
          audio: false,
        });
        streamRef.current = stream;
        setCameraBackend("web");
        setScannerOpen(true);
        return;
      } catch (error) {
        if (!Capacitor.isNativePlatform()) {
          setCameraError(error instanceof Error ? error.message : "Camera permission denied.");
          return;
        }
        console.warn("Embedded camera unavailable; trying native preview", error);
      }
    }

    if (!Capacitor.isNativePlatform()) {
      setCameraError("Live camera is unavailable on this device or browser.");
      return;
    }

    // Never fall back to the old timed native capture: it spends credits on blank frames.
    // WebView getUserMedia is required for local detection. A native frame processor
    // can be added later for devices that do not expose getUserMedia.
    setCameraError("Automatic card detection requires camera frame access. Enable camera permission for MintRadar and reopen the scanner.");
  }

  // Start on entry to the Scanner tab; a manual start control remains available
  // for iOS permission prompts that require a direct user gesture.
  useEffect(() => {
    if (!open || view !== "scanner" || scannerOpen || identifying || selectedCaptureId || qrCandidate) return;
    void startCamera();
    // Run only on entering the scanner view, not when camera state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, scanMode, qrCandidate]);

  function changeScannerMode(next: ScanMode) {
    if (next === scanMode) return;
    stopCamera();
    setSelectedCaptureId(null);
    setQrCandidate(null);
    setQrScanMessage("");
    setCameraError("");
    setScanMode(next);
  }

  // MintRadar prints /l/<Base62> labels; older labels may use /listing/<UUID>.
  // A QR is a locator, not authorization. All database lookups are vendor-scoped.
  function listingIdFromQr(value: string): string | null {
    let candidate = value.trim();
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length !== 2) return null;
      if (segments[0] === "listing") candidate = segments[1];
      else if (segments[0] === "l") candidate = decodeListingId(segments[1]) ?? "";
      else return null;
    } catch {
      // Plain UUIDs and short codes can also be pasted directly.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
        candidate = decodeListingId(candidate) ?? "";
      }
    }
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
      ? candidate.toLowerCase() : null;
  }

  async function fetchVendorListing(id: string): Promise<VendorInventorySearchItem | null> {
    if (!vendorId) throw new Error("Select an active vendor before scanning inventory.");
    const { data, error } = await supabase.from("inventory")
      .select(`id, vendor_id, card_id, listing_type, condition, grading_company, grade, cert_number, price, quantity,
        cards (id, external_id, name, set_name, card_number, image_url, category, rarity, edition, finish)`)
      .eq("id", id).eq("vendor_id", vendorId).maybeSingle();
    if (error) throw error;
    return data as unknown as VendorInventorySearchItem | null;
  }

  async function reviewQrValue(value: string) {
    if (qrLookupRef.current) return;
    const id = listingIdFromQr(value);
    if (!id) {
      setQrScanMessage("This is not a recognized MintRadar listing QR or ID.");
      return;
    }
    if (vendorItems.some(entry => entry.id.toLowerCase() === id)) {
      setQrScanMessage("This listing is already in the current transaction.");
      return;
    }
    qrLookupRef.current = true;
    setQrScanMessage("Looking up listing…");
    try {
      // Do not trust a possibly truncated or stale dashboard inventory array.
      const item = await fetchVendorListing(id);
      if (!item) {
        setQrScanMessage("Listing not found for the active vendor. Check that this label belongs to the selected vendor.");
        return;
      }
      if (Number(item.quantity ?? 0) <= 0 || item.price == null) {
        setQrScanMessage("This listing is out of stock or missing an asking price.");
        return;
      }
      stopCamera();
      setQrScanMessage("");
      setQrCandidate(item);
    } catch (error) {
      setQrScanMessage(error instanceof Error ? error.message : "Could not look up this listing.");
    } finally {
      qrLookupRef.current = false;
    }
  }

  async function confirmQrCandidate() {
    if (!qrCandidate || qrLookupRef.current) return;
    qrLookupRef.current = true;
    try {
      const currentItem = await fetchVendorListing(qrCandidate.id);
      if (!currentItem || Number(currentItem.quantity ?? 0) <= 0 || currentItem.price == null ||
          vendorItems.some(item => item.id === qrCandidate.id)) {
        setQrCandidate(null);
        setQrScanMessage("Listing is no longer available or is already in this transaction.");
        return;
      }
      setVendorItems(current => current.some(item => item.id === currentItem.id) ? current : [...current, currentItem]);
      setAddedNotice(`${inventoryTitle(currentItem)} added to vendor side`);
      setQrCandidate(null);
    } catch (error) {
      setQrScanMessage(error instanceof Error ? error.message : "Could not verify this listing.");
    } finally {
      qrLookupRef.current = false;
    }
  }

  // Conservative, on-device card-shape screening. This does not call the paid API.
  // We require a lit, detailed frame with a strong rectangular boundary in the
  // center and several consecutive stable samples before submitting one frame.
  function cardPresent(video: HTMLVideoElement): boolean {
    if (video.videoWidth < 160 || video.videoHeight < 160) return false;
    const canvas = document.createElement("canvas");
    canvas.width = 120; canvas.height = 160;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const sourceWidth = video.videoWidth * 0.72;
    const sourceHeight = video.videoHeight * 0.84;
    ctx.drawImage(video, (video.videoWidth-sourceWidth)/2, (video.videoHeight-sourceHeight)/2, sourceWidth, sourceHeight, 0, 0, 120, 160);
    const pixels = ctx.getImageData(0, 0, 120, 160).data;
    const luminance = (x: number, y: number) => { const i = (y*120+x)*4; return (pixels[i]*0.299+pixels[i+1]*0.587+pixels[i+2]*0.114); };
    let brightness=0, detail=0, count=0;
    for (let y=10;y<150;y+=4) for (let x=10;x<110;x+=4) {
      const l=luminance(x,y); brightness+=l; detail+=Math.abs(l-luminance(x+3,y))+Math.abs(l-luminance(x,y+3)); count++;
    }
    if (brightness/count < 42 || brightness/count > 235 || detail/count < 26) return false;
    // Compare the perimeter of a card-sized central region with nearby pixels.
    // The paired contrasts reject featureless desks and dark/blank scenes.
    let edge=0, hits=0;
    for (let y=22;y<=138;y+=6) {
      for (const x of [24,96]) {
        const diff=Math.abs(luminance(x,y)-luminance(x+(x<60?-7:7),y));
        edge+=diff; if(diff>19)hits++;
      }
    }
    for (let x=24;x<=96;x+=6) {
      for (const y of [22,138]) {
        const diff=Math.abs(luminance(x,y)-luminance(x,y+(y<80?-7:7)));
        edge+=diff; if(diff>19)hits++;
      }
    }
    return hits >= 19 && edge >= 1350;
  }

  useEffect(() => {
    if (!scannerOpen || cameraBackend !== "web" || !videoRef.current || !streamRef.current || selectedCaptureId || qrCandidate) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    void video.play().catch(() => setCameraError("Camera playback was blocked. Reopen the scanner."));
    // Decode QR frames locally with jsQR, including iOS WebViews that lack BarcodeDetector.
    // A QR scan never calls the paid card-recognition endpoint.
    let cancelled = false;
    let qrDecoder: typeof import("jsqr").default | null = null;
    let qrLoading = false;
    const qrCanvas = document.createElement("canvas");
    const qrContext = qrCanvas.getContext("2d", { willReadFrequently: true });
    if (scanMode === "qr") {
      qrLoading = true;
      void import("jsqr").then(module => {
        if (!cancelled) {
          qrDecoder = module.default;
          setQrScanMessage("");
        }
      }).catch(() => {
        if (!cancelled) setQrScanMessage("QR reader could not load. Check that jsqr is installed, or paste the listing URL below.");
      }).finally(() => { qrLoading = false; });
    }
    detectionTimerRef.current = setInterval(() => {
      if (cancelled || scanRequestRef.current || video.readyState < 2) return;
      if (scanMode === "qr") {
        if (!qrDecoder || !qrContext || qrBusyRef.current || qrLoading || qrCandidate) return;
        qrBusyRef.current = true;
        try {
          // Full frame rather than the card crop: QR labels may be anywhere in view.
          const width = Math.min(800, video.videoWidth);
          const height = Math.round(width * video.videoHeight / video.videoWidth);
          if (width < 160 || height < 160) return;
          if (qrCanvas.width !== width) qrCanvas.width = width;
          if (qrCanvas.height !== height) qrCanvas.height = height;
          qrContext.drawImage(video, 0, 0, width, height);
          const frame = qrContext.getImageData(0, 0, width, height);
          const code = qrDecoder(frame.data, width, height, { inversionAttempts: "attemptBoth" });
          if (code?.data && !cancelled && !qrLookupRef.current) void reviewQrValue(code.data);
        } catch (error) {
          console.warn("QR frame decode failed:", error);
        } finally {
          qrBusyRef.current = false;
        }
        return;
      }
      const present = cardPresent(video);
      stableFramesRef.current = present ? stableFramesRef.current + 1 : 0;
      setDetectionStatus(present ? "Card detected · Hold steady…" : "Align a card inside the blue corners");
      if (stableFramesRef.current >= 5) {
        stableFramesRef.current = 0;
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 960/video.videoWidth);
        canvas.width = Math.round(video.videoWidth*scale);
        canvas.height = Math.round(video.videoHeight*scale);
        canvas.getContext("2d")?.drawImage(video,0,0,canvas.width,canvas.height);
        stopCamera();
        void addCapture(canvas.toDataURL("image/jpeg",0.82));
      }
    }, 350);
    return () => { cancelled = true; if (detectionTimerRef.current) clearInterval(detectionTimerRef.current); detectionTimerRef.current=null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen, cameraBackend, selectedCaptureId, scanMode, qrCandidate]);
  useEffect(() => () => {
    if (nativeTimerRef.current) clearTimeout(nativeTimerRef.current);
    if (detectionTimerRef.current) clearInterval(detectionTimerRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (nativeCameraRef.current) {
      void import("@capacitor-community/camera-preview")
        .then(({ CameraPreview }) => CameraPreview.stop())
        .catch(() => {});
    }
  }, []);

  async function addCapture(image: string) {
    if (scanRequestRef.current) return;
    const id = crypto.randomUUID();
    const session = scanSessionRef.current;
    scanRequestRef.current = true;
    setIdentifying(true);
    setCameraError("");
    setCaptures(current => [...current, { id, image, matched: false, status: "identifying", selectedIndex: 0 }]);
    setSelectedCaptureId(id);
    // A live browser camera may remain open, but we never send overlapping recognition requests.
    if (cameraBackend === "web") stopCamera();
    try {
      const file = dataUrlToFile(image);
      if (file.size > 8 * 1024 * 1024) throw new Error("Captured image is too large (8 MB maximum).");
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/scanner/identify", { method: "POST", body: form, cache: "no-store" });
      const payload = await response.json() as ScanResult;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Card recognition failed.");
      if (session !== scanSessionRef.current) return;
      const hasCandidates = (payload.data?.candidates?.length ?? 0) > 0;
      const needsRetake = payload.data?.status === "retake" || !hasCandidates;
      setCaptures(current => current.map(item => item.id === id ? {
        ...item, result: payload, status: needsRetake ? "error" : "review",
        error: needsRetake ? (payload.data?.message || "No reliable match. Try scanning again.") : undefined,
      } : item));
    } catch (error) {
      if (session !== scanSessionRef.current) return;
      setCaptures(current => current.map(item => item.id === id ? {
        ...item, status: "error", error: error instanceof Error ? error.message : "Card recognition failed.",
      } : item));
    } finally {
      scanRequestRef.current = false;
      if (session === scanSessionRef.current) setIdentifying(false);
    }
  }

  function confirmScan(capture: ScanCapture) {
    if (capture.matched || capture.status !== "review") return;
    const candidate = capture.result?.data?.candidates?.[capture.selectedIndex];
    if (!candidate?.name || !candidate.number) return;
    const price = scanCandidatePrice(candidate);
    const gameType = scanGameType(candidate);
    const card: CatalogCard = {
      external_id: candidate.tcgplayer_id != null ? `tcgplayer-${candidate.tcgplayer_id}` : `tcgapi-${candidate.card_id ?? crypto.randomUUID()}`,
      data_source: "tcgapi", name: candidate.name, set_name: candidate.set?.name ?? "",
      card_number: candidate.number, image_url: candidate.image_url ?? null,
      category: gameType, rarity: candidate.rarity ?? null,
      finish: price?.printing ?? candidate.suggested_printing ?? null,
    };
    const row: AnalyzerCardRow = {
      ...newRow(), card, catalogType: gameType, percentage: defaultPercentage,
      marketValue: typeof price?.market_price === "number" && Number.isFinite(price.market_price)
        ? String(price.market_price) : "",
    };
    setRows(current => {
      const firstEmpty = current.findIndex(item => !item.card && !item.marketValue.trim());
      if (firstEmpty < 0) return [...current, row];
      return current.map((item, index) => index === firstEmpty ? { ...row, localId: item.localId } : item);
    });
    setCaptures(current => current.map(item => item.id === capture.id ? { ...item, matched: true, status: "added" } : item));
    setAddedNotice(`${candidate.name} added to your deal`);
  }

  async function addVendorListing(value: string) {
    setQrError("");
    const id = listingIdFromQr(value);
    if (!id) { setQrError("Paste a MintRadar /l/ URL, /listing/ URL, or listing UUID."); return; }
    if (vendorItems.some(entry => entry.id.toLowerCase() === id)) {
      setQrError("This listing is already in the trade."); return;
    }
    try {
      const item = await fetchVendorListing(id);
      if (!item) { setQrError("Listing not found for the active vendor."); return; }
      if (Number(item.quantity ?? 0) <= 0 || item.price == null) {
        setQrError("This listing is unavailable or has no asking price."); return;
      }
      setVendorItems(current => current.some(entry => entry.id === item.id) ? current : [...current, item]);
      setQrText("");
    } catch (error) {
      setQrError(error instanceof Error ? error.message : "Could not look up this listing.");
    }
  }

  function captureFrame() {
    if (scanMode !== "cards") return;
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError("Camera is still starting. Try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 960 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    void addCapture(canvas.toDataURL("image/jpeg", 0.78));
  }

  const selectedCapture = captures.find(capture => capture.id === selectedCaptureId) ?? null;
  const selectedCandidate = selectedCapture?.result?.data?.candidates?.[selectedCapture.selectedIndex] ?? null;
  const selectedPrice = selectedCandidate ? scanCandidatePrice(selectedCandidate) : null;

  const inputClass = "w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400/60";
  const buttonClass = "rounded-xl border border-zinc-800 bg-black px-3 py-2 text-xs font-black text-zinc-300 transition hover:border-emerald-400/50 hover:text-white";

  return <>
    <button type="button" onClick={() => { setView("scanner"); setOpen(true); }} className="rounded-xl border border-emerald-400/30 bg-zinc-950 px-6 py-4 text-center font-black text-emerald-300 transition hover:bg-zinc-900">
      Scanner
    </button>
    {open && <div className="fixed inset-0 z-[100] flex bg-[#090d16]" onMouseDown={event => { if (event.target === event.currentTarget) { stopCamera(); setOpen(false); } }}>
      <div role="dialog" aria-modal="true" aria-label="MintRadar Deal Analyzer V2" className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#090d16] text-white">
        <header className="z-20 flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 bg-[#090d16] px-4 py-3">
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">MintRadar • Vendor Tools</p><h2 className="mt-1 text-2xl font-black sm:text-3xl">MintRadar Scanner</h2><p className="mt-1 text-sm text-zinc-500">Scan customer cards, add them intentionally, then review the deal.</p></div>
          <button type="button" aria-label="Close Deal Analyzer" onClick={() => { stopCamera(); setOpen(false); }} className="rounded-full border border-zinc-800 px-3 py-1.5 text-xl text-zinc-400">×</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2"><button type="button" onClick={() => { setView("scanner"); }} className={`rounded-xl px-4 py-3 text-sm font-black ${view === "scanner" ? "bg-emerald-400 text-black" : "border border-zinc-800 text-zinc-300"}`}>Scan Customer Card</button><button type="button" onClick={() => { stopCamera(); setView("summary"); }} className={`relative rounded-xl px-4 py-3 text-sm font-black ${view === "summary" ? "bg-emerald-400 text-black" : "border border-zinc-800 text-zinc-300"}`}>Summary <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-xs text-black">{dealCards.length}</span>{addedNotice && view === "scanner" && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-black"/>}</button></div>
            <button type="button" onClick={() => { if (window.confirm("Clear this deal and start over?")) resetDeal(); }} className={buttonClass}>Reset Deal</button>
          </div>
          {addedNotice && view === "scanner" && <div role="status" className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300">✓ Card Added! {addedNotice} · Summary ({dealCards.length})</div>}
          {view === "summary" && <div className="space-y-5">
            <section className="rounded-2xl border border-zinc-800 bg-black p-4"><div className="flex items-center justify-between"><h3 className="text-xl font-black">Customer Cards <span className="text-emerald-400">({dealCards.length})</span></h3><button type="button" onClick={() => setView("scanner")} className={buttonClass}>Scan More</button></div>
              {dealCards.length === 0 ? <p className="mt-4 text-sm text-zinc-500">No cards added yet. Scan a card and tap Add Card.</p> : <div className="mt-4 space-y-3">{dealCards.map(row => <div key={row.localId} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3"><div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-black"><ResilientCardImage src={row.card?.image_url} name={row.card?.name} setName={row.card?.set_name} cardNumber={row.card?.card_number} category={row.card?.category} dataSource={row.card?.data_source} externalId={row.card?.external_id}/></div><div className="min-w-0 flex-1"><p className="font-black">{row.card?.name}</p><p className="text-xs text-zinc-400">{row.card?.set_name} · #{row.card?.card_number} · {row.card?.finish || "Raw"}</p><label className="mt-2 block text-xs text-zinc-400">Market price ($)<input type="number" min="0" step="0.01" value={row.marketValue} onChange={e => updateRow(row.localId, { marketValue: e.target.value })} className={`${inputClass} mt-1 max-w-36`}/></label></div><div className="text-right"><strong className="text-lg text-emerald-400">{money(Math.max(0, numericValue(row.marketValue)))}</strong><button type="button" onClick={() => removeRow(row.localId)} className="mt-3 block text-xs text-red-300">Remove</button></div></div>)}</div>}
              <div className="mt-4 flex justify-between border-t border-zinc-800 pt-4"><span className="font-bold">Total Market Value</span><strong className="text-2xl text-emerald-400">{money(totals.market)}</strong></div>
            </section>
            <section className="rounded-2xl border border-zinc-800 bg-black p-4"><h3 className="text-lg font-black">Offer Preview</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">{([{ title: "Cash Offer", value: cashRate, change: setCashRate, presets: [60,65,70,75,80], amount: cashOffer, label: "Pay Customer" }, { title: "Trade Credit", value: tradeRate, change: setTradeRate, presets: [70,75,80,85,90], amount: tradeCredit, label: "Available Trade Credit" }] as const).map(option => <div key={option.title} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"><label className="text-sm font-black">{option.title} (%)<input type="number" min="0" max="100" step="any" value={option.value} onChange={e => option.change(clampPercentage(Number(e.target.value)))} className={`${inputClass} mt-2`}/></label><div className="mt-3 flex flex-wrap gap-2">{option.presets.map(rate => <button type="button" key={rate} onClick={() => option.change(rate)} className={buttonClass}>{rate}%</button>)}</div><p className="mt-4 text-xs text-zinc-400">{option.label}</p><p className="text-3xl font-black text-emerald-400">{money(option.amount)}</p></div>)}</div></section>
            <section className="rounded-2xl border border-zinc-800 bg-black p-4"><h3 className="text-lg font-black">Vendor Inventory · Trade</h3><p className="mt-1 text-xs text-zinc-400">Add a published listing by its MintRadar QR destination URL or listing ID. Listings are verified against the active vendor in Supabase.</p><div className="mt-3 flex gap-2"><input value={qrText} onChange={e => setQrText(e.target.value)} placeholder="Paste /l/ URL, /listing/ URL or UUID" className={inputClass}/><button type="button" onClick={() => addVendorListing(qrText)} className="rounded-xl bg-emerald-400 px-4 font-black text-black">Add</button></div>{qrError && <p role="alert" className="mt-2 text-xs text-amber-300">{qrError}</p>}<div className="mt-3 max-h-44 space-y-2 overflow-y-auto">{inventory.filter(item => Number(item.quantity ?? 0) > 0 && item.price != null).slice(0, 30).map(item => <button key={item.id} type="button" onClick={() => addVendorListing(item.id)} className="flex w-full justify-between rounded-lg border border-zinc-800 px-3 py-2 text-left text-xs hover:border-emerald-400"><span>{inventoryTitle(item)} · {inventorySubtitle(item)}</span><strong>{money(Number(item.price))} +</strong></button>)}</div>{vendorItems.map(item => <div key={item.id} className="mt-2 flex items-center justify-between rounded-lg bg-zinc-950 p-3 text-sm"><span>{inventoryTitle(item)} · {money(Number(item.price))}</span><button type="button" onClick={() => setVendorItems(current => current.filter(entry => entry.id !== item.id))} className="text-red-300">Remove</button></div>)}<div className="mt-4 space-y-2 border-t border-zinc-800 pt-4"><div className="flex justify-between"><span>Vendor Asking Total</span><strong>{money(vendorTotal)}</strong></div><div className="flex justify-between"><span>Customer Trade Credit</span><strong>{money(tradeCredit)}</strong></div><div className="flex justify-between text-lg font-black"><span>{tradeDifference >= 0 ? "Customer Owes" : "Credit Remaining"}</span><strong className="text-emerald-400">{money(Math.abs(tradeDifference))}</strong></div></div></section>
            <p className="text-xs text-zinc-500">Estimate only. No payment, inventory update, or sale is recorded. Verify card identities, prices, and condition before completing a deal.</p>
          </div>}
          {view === "scanner" && <div className="flex min-h-full flex-col">
          <section className="flex flex-1 flex-col rounded-2xl bg-[#090d16] p-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-lg font-black">MintRadar Live Scanner</h3><p className="text-xs text-zinc-500">{scanMode === "cards" ? "Identify customer cards and check market prices." : "Scan a MintRadar inventory label into this same transaction. No recognition credits used."}</p></div>

            </div>
            <div className="mx-auto mt-3 flex w-full max-w-lg rounded-xl border border-slate-700 bg-slate-950 p-1" role="group" aria-label="Scanner mode">
              <button type="button" aria-pressed={scanMode === "cards"} onClick={() => changeScannerMode("cards")} className={`flex-1 rounded-lg px-4 py-3 text-sm font-black ${scanMode === "cards" ? "bg-sky-500 text-white" : "text-slate-400"}`}>Cards</button>
              <button type="button" aria-pressed={scanMode === "qr"} onClick={() => changeScannerMode("qr")} className={`flex-1 rounded-lg px-4 py-3 text-sm font-black ${scanMode === "qr" ? "bg-sky-500 text-white" : "text-slate-400"}`}>QR</button>
            </div>
            <div className="mt-3 mx-auto w-full max-w-lg">
              <div className="relative h-[min(56dvh,650px)] overflow-hidden rounded-2xl border border-sky-500/50 bg-[#0a1424]">
                {scannerOpen && cameraBackend === "web" && (
                  <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-cover" />
                )}
                {!scannerOpen && !selectedCapture && !qrCandidate && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-slate-400">
                    <span className="text-4xl">▣</span>
                    <span className="text-sm font-semibold">{scanMode === "qr" ? "Ready to scan an inventory QR" : "Ready to scan a card"}</span>
                  </div>
                )}
                {!scannerOpen && selectedCapture && (
                  <img src={selectedCapture.image} alt="Most recent card scan" className="absolute inset-0 h-full w-full object-contain opacity-80" />
                )}
                <div className="pointer-events-none absolute inset-x-[12%] inset-y-[9%] rounded-lg border border-white/25">
                  <span className="absolute -left-0.5 -top-0.5 h-9 w-9 rounded-tl-lg border-l-4 border-t-4 border-sky-400" />
                  <span className="absolute -right-0.5 -top-0.5 h-9 w-9 rounded-tr-lg border-r-4 border-t-4 border-sky-400" />
                  <span className="absolute -bottom-0.5 -left-0.5 h-9 w-9 rounded-bl-lg border-b-4 border-l-4 border-sky-400" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-9 w-9 rounded-br-lg border-b-4 border-r-4 border-sky-400" />
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-5 text-center text-xs font-bold text-white drop-shadow-lg">
                  {scanMode === "qr" ? (scannerOpen ? "Align MintRadar QR label inside the corners" : "Ready for inventory QR") : identifying ? "Identifying card…" : scannerOpen ? detectionStatus : "Ready for the next card"}
                </div>
              </div>
              {scanMode === "qr" && qrScanMessage && <p role="status" className="mt-3 text-sm text-amber-300">{qrScanMessage}</p>}
              {scanMode === "qr" && <div className="mt-3 flex gap-2"><input aria-label="MintRadar listing URL or UUID" value={qrText} onChange={e => setQrText(e.target.value)} placeholder="Paste QR listing URL or UUID" className={inputClass}/><button type="button" onClick={() => { void reviewQrValue(qrText); setQrText(""); }} className="rounded-xl bg-sky-500 px-4 font-black text-white">Find</button></div>}
              {scanMode === "qr" && qrCandidate && <div className="mt-3 rounded-xl border border-emerald-400/40 bg-slate-950 p-4"><p className="text-xs font-black uppercase text-emerald-400">Inventory match · Review before adding</p><p className="mt-2 font-black">{inventoryTitle(qrCandidate)}</p><p className="text-sm text-slate-400">{inventorySubtitle(qrCandidate)}</p><p className="mt-2 text-xl font-black text-emerald-400">{money(Number(qrCandidate.price))}</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setQrCandidate(null); void startCamera(); }} className={buttonClass}>Scan Again</button><button type="button" onClick={confirmQrCandidate} className="rounded-xl bg-emerald-400 px-3 py-3 font-black text-black">Add to Trade</button></div></div>}
              {cameraError && <p role="alert" className="mt-3 text-sm text-amber-300">{cameraError}</p>}
              {cameraError && <button type="button" onClick={() => void startCamera()} className="mt-3 w-full rounded-xl bg-sky-500 px-4 py-3 font-black text-white">Retry Camera</button>}
            </div>
            {scanMode === "cards" && selectedCapture && <div className="sticky bottom-0 z-20 mt-3 rounded-2xl border border-slate-700 bg-[#121c2b] p-4 shadow-2xl">
              <div className="flex items-center justify-between gap-2"><p className="text-sm font-black">{selectedCapture.status === "identifying" ? "Identifying your card..." : selectedCapture.matched ? "Card added to deal" : "Review Card Match"}</p><button type="button" onClick={() => { setCaptures(current => current.filter(c => c.id !== selectedCapture.id)); setSelectedCaptureId(null); }} className={buttonClass}>Dismiss</button></div>
              {selectedCapture.status === "identifying" && <p className="mt-3 text-sm text-emerald-300">Checking card identity and current market pricing...</p>}
              {selectedCapture.error && <p role="alert" className="mt-3 text-sm text-amber-300">{selectedCapture.error}</p>}
              {selectedCapture.result?.data?.status === "ambiguous" && <p className="mt-2 text-xs text-amber-300">Multiple possible matches. Verify the exact printing before confirming.</p>}
              {(selectedCapture.result?.data?.candidates?.length ?? 0) > 1 && !selectedCapture.matched && <div className="mt-3 space-y-2">{selectedCapture.result?.data?.candidates?.map((candidate, index) => <button key={`${candidate.card_id ?? index}-${index}`} type="button" onClick={() => setCaptures(current => current.map(c => c.id === selectedCapture.id ? { ...c, selectedIndex: index } : c))} className={`block w-full rounded-lg border p-2 text-left text-xs ${selectedCapture.selectedIndex === index ? "border-emerald-400 text-emerald-200" : "border-zinc-800 text-zinc-400"}`}>{candidate.name} · {candidate.set?.name} · #{candidate.number}</button>)}</div>}
              {selectedCandidate && <div className="mt-3 flex gap-4"><div className="h-36 w-24 shrink-0 overflow-hidden rounded-lg bg-black">{selectedCandidate.image_url ? <img src={selectedCandidate.image_url} alt={selectedCandidate.name ?? "Matched card"} className="h-full w-full object-contain"/> : <img src={selectedCapture.image} alt="Captured card" className="h-full w-full object-contain"/>}</div><div className="min-w-0 flex-1"><p className="font-black">{selectedCandidate.name}</p><p className="mt-1 text-xs text-zinc-400">{selectedCandidate.set?.name} · #{selectedCandidate.number}</p><p className="mt-1 text-xs text-zinc-500">{selectedCandidate.rarity} · {selectedPrice?.printing ?? selectedCandidate.suggested_printing ?? "Printing not specified"}</p><p className="mt-3 text-xs text-zinc-500">TCGplayer Market Price</p><p className="text-2xl font-black text-emerald-400">{typeof selectedPrice?.market_price === "number" ? money(selectedPrice.market_price) : "Not available"}</p><p className="mt-1 text-xs text-zinc-500">Offer at {defaultPercentage}%: {typeof selectedPrice?.market_price === "number" ? money(selectedPrice.market_price * defaultPercentage / 100) : "Enter market price manually"}</p></div></div>}
              {typeof selectedCapture.result?.meta?.scans_remaining === "number" && <p className="mt-2 text-xs text-zinc-500">API test credits remaining: {selectedCapture.result.meta.scans_remaining}</p>}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button type="button" disabled={identifying || nativeCameraBusy} onClick={() => { setAddedNotice(""); setSelectedCaptureId(null); void startCamera(); }} className={buttonClass}>Scan More</button>
                <button type="button" disabled={selectedCapture.status !== "review" || !selectedCandidate?.name || !selectedCandidate.number} onClick={() => confirmScan(selectedCapture)} className="rounded-xl bg-sky-500 px-6 py-3 font-black text-white disabled:opacity-40">{selectedCapture.matched ? "✓ Card Added" : "Add Card"}</button>
              </div>
              <button type="button" onClick={() => { stopCamera(); setView("summary"); }} className="mt-3 w-full rounded-xl border border-slate-600 py-3 text-sm font-black">Summary ({dealCards.length})</button>
            </div>}
            {scanMode === "qr" && <button type="button" onClick={() => { stopCamera(); setView("summary"); }} className="mx-auto mt-3 w-full max-w-lg rounded-xl border border-slate-600 py-3 text-sm font-black">Summary · {dealCards.length} customer / {vendorItems.length} vendor</button>}
          </section>

          </div>}
        </div>
      </div>
    </div>}
  </>;
}
