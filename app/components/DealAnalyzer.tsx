"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";

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
type ScanMode = "single" | "continuous";
type ScanCapture = { id: string; image: string; matched: boolean };

function clampPercentage(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export default function DealAnalyzer({ inventory }: { inventory: VendorInventorySearchItem[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DealMode>("buy");
  const [rows, setRows] = useState<AnalyzerCardRow[]>(() => [newRow()]);
  const [defaultPercentage, setDefaultPercentage] = useState(70);
  const [creditBonus, setCreditBonus] = useState(0);
  const [targetInventory, setTargetInventory] = useState<VendorInventorySearchItem | null>(null);
  const [inventorySearch, setInventorySearch] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [scanMode, setScanMode] = useState<ScanMode>("single");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [captures, setCaptures] = useState<ScanCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  const tradeCredit = totals.cash * (1 + creditBonus / 100);
  const targetValue = Math.max(0, numericValue(targetPrice));
  const tradeDifference = targetValue - tradeCredit;

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
    setDefaultPercentage(70);
    setCreditBonus(0);
    setTargetInventory(null);
    setTargetPrice("");
    setInventorySearch("");
    setCaptures([]);
    setSelectedCaptureId(null);
    stopCamera();
  }
  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerOpen(false);
  }
  async function startCamera() {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Live camera is unavailable here. Use Take Photo / Upload instead.");
      return;
    }
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setScannerOpen(true);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Could not open the camera.");
    }
  }
  useEffect(() => {
    if (scannerOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => setCameraError("Tap the video to start the camera."));
    }
  }, [scannerOpen]);
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  function addCapture(image: string) {
    const id = crypto.randomUUID();
    setCaptures(current => [...current, { id, image, matched: false }]);
    setSelectedCaptureId(id);
    // Continuous mode keeps the camera running for the next capture.
    if (scanMode === "single") stopCamera();
  }
  function captureFrame() {
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
    addCapture(canvas.toDataURL("image/jpeg", 0.78));
  }
  function handleFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setCameraError("Choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") addCapture(reader.result);
    };
    reader.readAsDataURL(file);
  }
  const selectedCapture = captures.find(capture => capture.id === selectedCaptureId) ?? null;

  const inputClass = "w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400/60";
  const buttonClass = "rounded-xl border border-zinc-800 bg-black px-3 py-2 text-xs font-black text-zinc-300 transition hover:border-emerald-400/50 hover:text-white";

  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-emerald-400/30 bg-zinc-950 px-6 py-4 text-center font-black text-emerald-300 transition hover:bg-zinc-900">
      Deal Analyzer V2
    </button>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 p-0 sm:items-center sm:p-5" onMouseDown={event => { if (event.target === event.currentTarget) { stopCamera(); setOpen(false); } }}>
      <div role="dialog" aria-modal="true" aria-label="MintRadar Deal Analyzer V2" className="max-h-[96vh] w-full max-w-6xl overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-950 text-white shadow-2xl sm:rounded-3xl">
        <header className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-zinc-800 bg-zinc-950 p-5 sm:p-6">
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">MintRadar • Vendor Tools</p><h2 className="mt-1 text-2xl font-black sm:text-3xl">Deal Analyzer V2</h2><p className="mt-1 text-sm text-zinc-500">Build a buy or trade deal with the same card list.</p></div>
          <button type="button" aria-label="Close Deal Analyzer" onClick={() => { stopCamera(); setOpen(false); }} className="rounded-full border border-zinc-800 px-3 py-1.5 text-xl text-zinc-400">×</button>
        </header>
        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            {(["buy", "trade"] as const).map(value => <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-xl px-6 py-3 text-sm font-black uppercase ${mode === value ? "bg-emerald-400 text-black" : "border border-zinc-800 bg-black text-zinc-400"}`}>{value === "buy" ? "Buy from Customer" : "Trade with Customer"}</button>)}
            <button type="button" onClick={() => { if (window.confirm("Clear this deal and start over?")) resetDeal(); }} className={`${buttonClass} ml-auto`}>Reset Deal</button>
          </div>

          <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-black">Default Offer Rate</h3><p className="text-xs text-zinc-500">Applying a new default updates all cards. Individual rows can still be adjusted.</p></div><div className="flex items-center gap-2"><input aria-label="Default percentage" type="number" min="0" max="100" value={defaultPercentage} onChange={e => applyDefault(Number(e.target.value))} className="w-20 rounded-lg border border-zinc-800 bg-black px-2 py-2 text-center font-black"/><span>%</span></div></div>
            <div className="mt-3 flex flex-wrap gap-2">{QUICK_PERCENTAGES.map(rate => <button key={rate} type="button" onClick={() => applyDefault(rate)} className={`rounded-lg px-3 py-2 text-xs font-black ${defaultPercentage === rate ? "bg-emerald-400 text-black" : "border border-zinc-800 bg-black text-zinc-400"}`}>{rate}%</button>)}</div>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-black p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-black">Camera Intake</h3><p className="text-xs text-zinc-500">Capture images, then confirm exact card identities through catalog search. Recognition is not connected yet.</p></div><div className="flex gap-2"><button type="button" onClick={() => { setScanMode("single"); stopCamera(); }} className={`${buttonClass} ${scanMode === "single" ? "!border-emerald-400 !text-emerald-300" : ""}`}>Single</button><button type="button" onClick={() => { setScanMode("continuous"); stopCamera(); }} className={`${buttonClass} ${scanMode === "continuous" ? "!border-emerald-400 !text-emerald-300" : ""}`}>Continuous</button></div></div>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => { if (scannerOpen) stopCamera(); else void startCamera(); }}>{scannerOpen ? "Stop Camera" : "Open Camera"}</button><button type="button" className={buttonClass} onClick={() => fileRef.current?.click()}>Take Photo / Upload</button><input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ""; }}/></div>
            {cameraError && <p role="alert" className="mt-3 text-sm text-amber-300">{cameraError}</p>}
            {scannerOpen && <div className="mt-3 max-w-xl space-y-2"><video ref={videoRef} autoPlay muted playsInline className="aspect-[4/3] w-full rounded-xl bg-zinc-900 object-cover"/><button type="button" onClick={captureFrame} className="w-full rounded-xl bg-emerald-400 px-4 py-3 font-black text-black">Capture Card {scanMode === "continuous" ? "• Keep Scanning" : ""}</button></div>}
            {captures.length > 0 && <div className="mt-4"><p className="mb-2 text-xs font-bold text-zinc-400">Captured images ({captures.length}) • Tap one to review</p><div className="flex gap-2 overflow-x-auto pb-2">{captures.map(capture => <button key={capture.id} type="button" onClick={() => setSelectedCaptureId(capture.id)} className={`relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border-2 ${selectedCaptureId === capture.id ? "border-emerald-400" : "border-zinc-800"}`}><img src={capture.image} alt="Captured card for manual identification" className="h-full w-full object-cover"/>{capture.matched && <span className="absolute bottom-0 inset-x-0 bg-emerald-500 text-[9px] font-black text-black">Added</span>}</button>)}</div></div>}
            {selectedCapture && <div className="mt-3 rounded-xl border border-zinc-800 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-black">Review captured card</p><button type="button" onClick={() => { setCaptures(current => current.filter(c => c.id !== selectedCapture.id)); setSelectedCaptureId(null); }} className={buttonClass}>Discard Image</button></div><p className="mt-1 text-xs text-amber-300">This image has not been automatically identified. Search the catalog in an empty card row below, then confirm the exact printing.</p><button type="button" onClick={() => { addRow(); setSelectedCaptureId(null); }} className={`${buttonClass} mt-2`}>Add Empty Row to Identify</button></div>}
          </section>

          {mode === "trade" && <section className="rounded-2xl border border-zinc-800 bg-black p-4"><h3 className="text-lg font-black">Your Side of the Trade</h3><p className="mb-3 text-xs text-zinc-500">Choose the inventory item the customer wants. Your item remains at full asking value.</p>
            {targetInventory ? <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3"><div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-black"><ResilientCardImage src={targetInventory.cards?.image_url} name={targetInventory.cards?.name} setName={targetInventory.cards?.set_name} cardNumber={targetInventory.cards?.card_number} category={targetInventory.cards?.category} externalId={targetInventory.cards?.external_id}/></div><div className="min-w-0 flex-1"><p className="font-black">{inventoryTitle(targetInventory)}</p><p className="text-xs text-zinc-500">{inventorySubtitle(targetInventory)} • {inventoryOwnership(targetInventory)}</p><p className="text-xs text-zinc-500">Available: {targetInventory.quantity ?? 0}</p></div><button type="button" onClick={() => { setTargetInventory(null); setTargetPrice(""); }} className={buttonClass}>Change</button></div> : <><input value={inventorySearch} onChange={e => setInventorySearch(e.target.value)} placeholder="Search available vendor inventory..." className={inputClass}/><div className="mt-2 max-h-56 space-y-1 overflow-y-auto">{activeInventory.map(item => <button type="button" key={item.id} onClick={() => { setTargetInventory(item); setTargetPrice(item.price != null ? String(item.price) : ""); setInventorySearch(""); }} className="flex w-full items-center justify-between rounded-lg border border-zinc-900 p-3 text-left hover:border-emerald-400/40"><span><strong>{inventoryTitle(item)}</strong><span className="ml-2 text-xs text-zinc-500">{inventorySubtitle(item)}</span></span><span className="text-sm font-black text-emerald-300">{money(Number(item.price ?? 0))}</span></button>)}{activeInventory.length === 0 && <p className="p-3 text-xs text-zinc-500">No available inventory matches.</p>}</div></>}
            <label className="mt-3 block text-xs font-black text-zinc-400">Your Item Value ($)<input type="number" min="0" step="0.01" value={targetPrice} onChange={e => setTargetPrice(e.target.value)} className={`${inputClass} mt-1`}/></label>
          </section>}

          <section><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-xl font-black">Customer Cards</h3><p className="text-xs text-zinc-500">{rows.length} row(s) • Search, verify printing, then enter market value.</p></div><button type="button" onClick={() => addRow()} className="rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-black text-black">+ Add Card</button></div>
            <div className="space-y-4">{rows.map((row, index) => <article key={row.localId} className="rounded-2xl border border-zinc-800 bg-black p-4"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wider text-emerald-400">Card {index + 1}</p><button type="button" onClick={() => removeRow(row.localId)} className={buttonClass}>Remove</button></div>
              <CatalogCardSearch catalogType={row.catalogType} selectedCard={row.card} onCatalogTypeChange={catalogType => updateRow(row.localId, { catalogType, card: null })} onSelect={card => updateRow(row.localId, { card })} onClear={() => updateRow(row.localId, { card: null })}/>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><label className="text-xs font-black text-zinc-400">Type<select value={row.itemType} onChange={e => updateRow(row.localId, { itemType: e.target.value as AnalyzerCardRow["itemType"] })} className={`${inputClass} mt-1`}><option value="raw">Raw</option><option value="slab">Graded</option><option value="sealed">Sealed</option></select></label>
              {row.itemType === "raw" && <label className="text-xs font-black text-zinc-400">Condition<select value={row.condition} onChange={e => updateRow(row.localId, { condition: e.target.value })} className={`${inputClass} mt-1`}>{TCG_CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></label>}
              {row.itemType === "slab" && <><label className="text-xs font-black text-zinc-400">Grader<select value={row.gradingCompany} onChange={e => updateRow(row.localId, { gradingCompany: e.target.value })} className={`${inputClass} mt-1`}><option value="">Select...</option>{GRADING_COMPANIES.map(c => <option key={c}>{c}</option>)}</select></label><label className="text-xs font-black text-zinc-400">Grade<input value={row.grade} onChange={e => updateRow(row.localId, { grade: e.target.value })} className={`${inputClass} mt-1`}/></label><label className="text-xs font-black text-zinc-400">Cert #<input value={row.certNumber} onChange={e => updateRow(row.localId, { certNumber: e.target.value })} className={`${inputClass} mt-1`}/></label></>}
              {row.itemType === "sealed" && <label className="text-xs font-black text-zinc-400">Sealed Condition<select value={row.sealedCondition} onChange={e => updateRow(row.localId, { sealedCondition: e.target.value })} className={`${inputClass} mt-1`}>{SEALED_CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></label>}
              <label className="text-xs font-black text-zinc-400">Market Value ($)<input type="number" min="0" step="0.01" value={row.marketValue} onChange={e => updateRow(row.localId, { marketValue: e.target.value })} className={`${inputClass} mt-1`}/></label><label className="text-xs font-black text-zinc-400">Offer %<input type="number" min="0" max="100" step="1" value={row.percentage} onChange={e => updateRow(row.localId, { percentage: clampPercentage(Number(e.target.value)) })} className={`${inputClass} mt-1`}/></label></div>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-zinc-950 px-4 py-3"><span className="text-xs font-bold text-zinc-500">Customer offer for this card</span><strong className="text-lg text-emerald-400">{money(Math.max(0, numericValue(row.marketValue)) * row.percentage / 100)}</strong></div>
            </article>)}</div>
          </section>

          <section className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.05] p-5"><h3 className="text-lg font-black">Deal Summary</h3><div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4"><div><p className="text-xs text-zinc-500">Customer Market Value</p><p className="text-xl font-black">{money(totals.market)}</p></div><div><p className="text-xs text-zinc-500">Cash Offer</p><p className="text-xl font-black text-emerald-400">{money(totals.cash)}</p></div><div><p className="text-xs text-zinc-500">Effective Rate</p><p className="text-xl font-black">{totals.market > 0 ? (totals.cash / totals.market * 100).toFixed(1) : "0.0"}%</p></div><div><p className="text-xs text-zinc-500">Identified Cards</p><p className="text-xl font-black">{totals.identified}/{rows.length}</p></div></div>
            <label className="mt-4 block max-w-xs text-xs font-black text-zinc-400">Trade Credit Bonus (%)<input type="number" min="0" max="100" value={creditBonus} onChange={e => setCreditBonus(clampPercentage(Number(e.target.value)))} className={`${inputClass} mt-1`}/></label><div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3"><span className="font-bold">Customer Trade Credit</span><strong className="text-xl text-emerald-300">{money(tradeCredit)}</strong></div>
            {mode === "trade" && <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3"><div className="flex justify-between text-sm"><span>Your Item Value</span><strong>{money(targetValue)}</strong></div><div className="flex justify-between text-lg font-black"><span>{tradeDifference >= 0 ? "Cash Customer Owes" : "Credit Above Item Value"}</span><span className="text-emerald-300">{money(Math.abs(tradeDifference))}</span></div></div>}
            <p className="mt-4 text-xs leading-5 text-zinc-500">Estimate only. This version does not charge customers, change inventory, record sales, or submit trade offers. Verify identities and prices before completing a deal.</p>
          </section>
        </div>
      </div>
    </div>}
  </>;
}
