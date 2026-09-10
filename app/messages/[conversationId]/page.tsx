"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { getActiveVendorMembership } from "../../../lib/active-vendor";

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string | null;
  sender_vendor_id: string | null;
  sender_display_name: string | null;
  sender_vendor_name: string | null;
  body: string;
  message_type: "text" | "trade_offer";
  trade_offer_id: string | null;
  created_at: string;
  is_mine: boolean;
};

type ConversationSnapshot = {
  card_name?: string | null;
  set_name?: string | null;
  card_number?: string | null;
  image_url?: string | null;
  price?: number | string | null;
  condition?: string | null;
  grading_company?: string | null;
  grade?: string | null;
  vendor_name?: string | null;
};

type InboxRow = {
  conversation_id: string;
  counterpart_name: string | null;
  context_inventory_id: string | null;
  context_card_id: string | null;
  context_snapshot: ConversationSnapshot | null;
};

type TradeOfferSnapshot = {
  card_name?: string | null;
  set_name?: string | null;
  set_id?: string | null;
  card_number?: string | null;
  image_url?: string | null;
  condition?: string | null;
  grading_company?: string | null;
  grade?: string | null;
  cert_number?: string | null;
  vendor_name?: string | null;
  source?: string | null;
  inventory_listing_price?: number | string | null;
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
  external_id?: string | null;
  data_source?: string | null;
};

type TradeOfferItem = {
  id: string;
  inventory_id: string | null;
  card_id: string | null;
  snapshot: TradeOfferSnapshot | null;
  quantity: number | string;
  market_value: number | string;
  trade_percentage: number | string;
  adjusted_trade_value: number | string;
};

type TradeOffer = {
  id: string;
  conversation_id: string;
  sender_user_id: string | null;
  sender_vendor_id: string | null;
  target_inventory_id: string | null;
  target_card_id: string | null;
  target_snapshot: TradeOfferSnapshot | null;
  target_market_value: number | string;
  offered_market_total: number | string;
  offered_trade_total: number | string;
  difference: number | string;
  status:
    | "pending"
    | "accepted"
    | "declined"
    | "countered"
    | "cancelled";
  parent_offer_id: string | null;
  created_at: string;
  responded_at: string | null;
  items: TradeOfferItem[];
};

type TradeOfferMap = Record<string, TradeOffer>;

type TradeTransaction = {
  id: string;
  trade_offer_id: string;
  conversation_id: string;
  status:
    | "awaiting_completion"
    | "completed"
    | "cancelled";
  offer_sender_user_id: string;
  offer_recipient_user_id: string;
  sender_confirmed_at: string | null;
  recipient_confirmed_at: string | null;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  current_user_role:
    | "sender"
    | "recipient"
    | null;
  current_user_confirmed: boolean;
  other_side_confirmed: boolean;
};

type TradeTransactionMap =
  Record<string, TradeTransaction>;

type CatalogType =
  | "Pokemon"
  | "Sports"
  | "One Piece"
  | "Magic: The Gathering"
  | "Yu-Gi-Oh!"
  | "Lorcana";

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

type InventoryTradeItem = {
  id: string;
  vendor_id: string;
  card_id: string | null;
  listing_type?: string | null;
  condition?: string | null;
  grading_company?: string | null;
  grade?: string | null;
  cert_number?: string | null;
  price?: number | string | null;
  quantity?: number | null;
  notes?: string | null;
  cards?: {
    id: string;
    external_id?: string | null;
    name?: string | null;
    set_name?: string | null;
    card_number?: string | null;
    image_url?: string | null;
    rarity?: string | null;
    category?: string | null;
    edition?: string | null;
    finish?: string | null;
  } | null;
};

type OfferDraftItem = {
  localId: string;
  selectedCard: CatalogCard | null;
  selectedInventory: InventoryTradeItem | null;
  selectionSource: "catalog" | "inventory";
  quantity: number;
  marketValue: string;
  tradePercentage: number;
};

const QUICK_PERCENTAGES = [70, 75, 80, 85, 90, 100];

const TRADE_CATALOGS: CatalogType[] = [
  "Pokemon",
  "Sports",
  "Magic: The Gathering",
  "Yu-Gi-Oh!",
  "Lorcana",
  "One Piece",
];

function money(value: number | string | null | undefined) {
  const number = Number(value ?? 0);

  if (!Number.isFinite(number)) {
    return "$0.00";
  }

  return number.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function numericValue(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function newOfferDraftItem(): OfferDraftItem {
  return {
    localId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    selectedCard: null,
    selectedInventory: null,
    selectionSource: "catalog",
    quantity: 1,
    marketValue: "",
    tradePercentage: 80,
  };
}


function catalogEndpoint(catalogType: CatalogType) {
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

function cardSecondaryLine(card: CatalogCard) {
  return [
    card.year,
    card.manufacturer,
    card.release_name || card.set_name,
  ]
    .filter(Boolean)
    .join(" • ");
}

function cardDetailLine(card: CatalogCard) {
  return [
    card.parallel_name || card.finish,
    card.card_number ? `#${card.card_number}` : null,
    card.rarity,
  ]
    .filter(Boolean)
    .join(" • ");
}

function isSportsCard(card: CatalogCard) {
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
  ].some((term) => value.includes(term));
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
    card.release_name || card.set_name,
    card.card_number ? `#${card.card_number}` : null,
    card.parallel_name || card.finish,
  ]
    .filter(Boolean)
    .join(" ");

  const encodedQuery = encodeURIComponent(baseQuery.trim());

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
    <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-black p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
          📡 Check Comps
        </p>
        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-700">
          Opens new tab
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {links.map((market) => (
          <a
            key={market.name}
            href={market.href}
            target="_blank"
            rel="noreferrer"
            className="group flex min-h-14 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04]"
            title={market.name}
          >
            <img
              src={market.logo}
              alt={`${market.name} logo`}
              className="max-h-7 max-w-full object-contain"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

function inventoryCardToCatalogCard(
  inventoryItem: InventoryTradeItem
): CatalogCard {
  const card = inventoryItem.cards;

  return {
    external_id:
      card?.external_id ||
      card?.id ||
      inventoryItem.card_id ||
      inventoryItem.id,
    data_source: "MintRadar Inventory",
    name: card?.name || null,
    set_name: card?.set_name || null,
    set_id: null,
    card_number: card?.card_number || null,
    image_url: card?.image_url || null,
    category: card?.category || null,
    rarity: card?.rarity || null,
    edition: card?.edition || null,
    finish: card?.finish || null,
    illustrator: null,
    year: null,
    manufacturer: null,
    release_name: null,
    parallel_name: null,
    sport: null,
    print_run: null,
    rookie: null,
  };
}

function inventoryLabel(item: InventoryTradeItem) {
  if (
    item.listing_type === "graded" ||
    item.grading_company ||
    item.grade
  ) {
    return [
      item.grading_company,
      item.grade,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return item.condition || "Raw";
}

function TradeOfferCatalogCardEditor({
  item,
  index,
  inventory,
  inventoryLoading,
  activeVendorName,
  onUpdate,
  onRemove,
}: {
  item: OfferDraftItem;
  index: number;
  inventory: InventoryTradeItem[];
  inventoryLoading: boolean;
  activeVendorName: string | null;
  onUpdate: (
    localId: string,
    patch: Partial<OfferDraftItem>
  ) => void;
  onRemove: (localId: string) => void;
}) {
  const [catalogType, setCatalogType] =
    useState<CatalogType>("Pokemon");

  const [searchTerm, setSearchTerm] =
    useState("");

  const [inventorySearch, setInventorySearch] =
    useState("");

  const [results, setResults] =
    useState<CatalogCard[]>([]);

  const [searching, setSearching] =
    useState(false);

  const [searchError, setSearchError] =
    useState("");

  useEffect(() => {
    const query = searchTerm.trim();

    if (
      item.selectionSource !== "catalog" ||
      item.selectedCard ||
      query.length < 2
    ) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }

    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        setSearching(true);
        setSearchError("");

        const response = await fetch(
          `${catalogEndpoint(catalogType)}?q=${encodeURIComponent(
            query
          )}&page=1`,
          {
            signal: controller.signal,
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data?.error ||
              "Catalog search failed."
          );
        }

        setResults(
          (data.results || []) as CatalogCard[]
        );
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          error.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "Trade catalog search error:",
          error
        );

        setResults([]);

        setSearchError(
          error instanceof Error
            ? error.message
            : "Something went wrong while searching."
        );
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    catalogType,
    searchTerm,
    item.selectedCard,
    item.selectionSource,
  ]);

  const selectedCard = item.selectedCard;

  const itemMarket =
    numericValue(item.marketValue);

  const itemQuantity = Math.max(
    1,
    Number(item.quantity) || 1
  );

  const itemTrade =
    itemMarket *
    itemQuantity *
    (Math.max(
      0,
      Number(item.tradePercentage) || 0
    ) /
      100);

  const filteredInventory =
    inventory
      .filter((inventoryItem) => {
        const available =
          inventoryItem.quantity == null ||
          inventoryItem.quantity > 0;

        if (!available) return false;

        const query =
          inventorySearch
            .trim()
            .toLowerCase();

        if (!query) return true;

        const card =
          inventoryItem.cards;

        const haystack = [
          card?.name,
          card?.set_name,
          card?.card_number,
          card?.rarity,
          card?.category,
          card?.edition,
          card?.finish,
          inventoryItem.condition,
          inventoryItem.grading_company,
          inventoryItem.grade,
          inventoryItem.cert_number,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
      .slice(0, 40);

  function chooseSource(
    source: "catalog" | "inventory"
  ) {
    onUpdate(item.localId, {
      selectionSource: source,
      selectedCard: null,
      selectedInventory: null,
      quantity: 1,
      marketValue: "",
    });

    setSearchTerm("");
    setInventorySearch("");
    setResults([]);
    setSearchError("");
  }

  function selectCatalogCard(
    card: CatalogCard
  ) {
    onUpdate(item.localId, {
      selectedCard: card,
      selectedInventory: null,
      selectionSource: "catalog",
      quantity: 1,
      marketValue: "",
    });

    setSearchTerm("");
    setResults([]);
    setSearchError("");
  }

  function selectInventoryCard(
    inventoryItem: InventoryTradeItem
  ) {
    const card =
      inventoryCardToCatalogCard(
        inventoryItem
      );

    onUpdate(item.localId, {
      selectedCard: card,
      selectedInventory:
        inventoryItem,
      selectionSource: "inventory",
      quantity: 1,
      marketValue:
        inventoryItem.price != null
          ? String(inventoryItem.price)
          : "",
    });

    setInventorySearch("");
    setSearchError("");
  }

  function changeCard() {
    onUpdate(item.localId, {
      selectedCard: null,
      selectedInventory: null,
      quantity: 1,
      marketValue: "",
    });

    setSearchTerm("");
    setInventorySearch("");
    setResults([]);
    setSearchError("");
  }

  const selectedInventory =
    item.selectedInventory;

  const maxInventoryQuantity =
    selectedInventory?.quantity ??
    null;

  return (
    <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-white">
            Card {index + 1}
          </p>

          <p className="mt-1 text-xs text-zinc-600">
            Search the catalog or pull directly from your active vendor inventory.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            onRemove(item.localId)
          }
          className="text-xs font-black uppercase tracking-wider text-zinc-700 transition hover:text-red-300"
        >
          Remove
        </button>
      </div>

      {!selectedCard && (
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-zinc-900 bg-black p-1.5">
          <button
            type="button"
            onClick={() =>
              chooseSource("catalog")
            }
            className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${
              item.selectionSource ===
              "catalog"
                ? "bg-emerald-400 text-black"
                : "text-zinc-500 hover:text-white"
            }`}
          >
            Search Catalog
          </button>

          <button
            type="button"
            onClick={() =>
              chooseSource(
                "inventory"
              )
            }
            className={`rounded-xl px-3 py-2.5 text-sm font-black transition ${
              item.selectionSource ===
              "inventory"
                ? "bg-emerald-400 text-black"
                : "text-zinc-500 hover:text-white"
            }`}
          >
            My Inventory
          </button>
        </div>
      )}

      {!selectedCard &&
        item.selectionSource ===
          "catalog" && (
          <>
            <div className="mt-4">
              <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                Catalog
              </p>

              <div className="mt-2 flex flex-wrap gap-2">
                {TRADE_CATALOGS.map(
                  (catalog) => {
                    const selected =
                      catalogType ===
                      catalog;

                    return (
                      <button
                        key={catalog}
                        type="button"
                        onClick={() => {
                          setCatalogType(
                            catalog
                          );
                          setSearchTerm(
                            ""
                          );
                          setResults([]);
                          setSearchError(
                            ""
                          );
                        }}
                        className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
                          selected
                            ? "border-emerald-400 bg-emerald-400 text-black"
                            : "border-zinc-800 bg-black text-zinc-500 hover:border-emerald-400/40 hover:text-emerald-300"
                        }`}
                      >
                        {catalog}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            <div className="mt-4">
              <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                Search MintRadar Catalog
              </label>

              <input
                type="search"
                value={searchTerm}
                onChange={(event) =>
                  setSearchTerm(
                    event.target.value
                  )
                }
                placeholder={
                  catalogType ===
                  "Sports"
                    ? "e.g. Wembanyama 136 Silver"
                    : "Search card name, set, or number..."
                }
                className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm font-bold text-white outline-none transition placeholder:text-zinc-800 focus:border-emerald-400/50"
              />

              {searching && (
                <p className="mt-3 text-sm font-bold text-emerald-400">
                  Scanning the catalog...
                </p>
              )}

              {searchError && (
                <p className="mt-3 text-sm text-red-300">
                  {searchError}
                </p>
              )}

              {!searching &&
                searchTerm.trim()
                  .length >= 2 &&
                !searchError &&
                results.length ===
                  0 && (
                  <p className="mt-3 text-sm text-zinc-600">
                    No matching cards found.
                  </p>
                )}

              {results.length > 0 && (
                <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                  {results.map(
                    (card) => (
                      <button
                        key={`${card.data_source}-${card.external_id}`}
                        type="button"
                        onClick={() =>
                          selectCatalogCard(
                            card
                          )
                        }
                        className="flex w-full items-center gap-3 rounded-2xl border border-zinc-900 bg-black p-3 text-left transition hover:border-emerald-400/40"
                      >
                        <div className="flex h-20 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950">
                          {card.image_url ? (
                            <img
                              src={
                                card.image_url
                              }
                              alt={
                                card.name ||
                                "Catalog card"
                              }
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="px-2 text-center text-[9px] font-black uppercase tracking-wider text-zinc-700">
                              No image
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate font-black text-white">
                            {card.name ||
                              "Unknown Card"}
                          </p>

                          {cardSecondaryLine(
                            card
                          ) && (
                            <p className="mt-1 truncate text-xs text-zinc-500">
                              {cardSecondaryLine(
                                card
                              )}
                            </p>
                          )}

                          {cardDetailLine(
                            card
                          ) && (
                            <p className="mt-1 truncate text-xs font-bold text-emerald-400/80">
                              {cardDetailLine(
                                card
                              )}
                            </p>
                          )}
                        </div>

                        <span className="shrink-0 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                          Select
                        </span>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </>
        )}

      {!selectedCard &&
        item.selectionSource ===
          "inventory" && (
          <div className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-400">
                  My Inventory
                </p>

                <p className="mt-1 text-xs text-zinc-600">
                  {activeVendorName
                    ? `Active vendor: ${activeVendorName}`
                    : "No active vendor is available for this account."}
                </p>
              </div>

              {!inventoryLoading && (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                  {
                    inventory.filter(
                      (row) =>
                        row.quantity ==
                          null ||
                        row.quantity > 0
                    ).length
                  }{" "}
                  available
                </span>
              )}
            </div>

            {inventoryLoading ? (
              <div className="mt-3 rounded-xl border border-zinc-900 bg-black p-4 text-sm font-bold text-emerald-400">
                Loading your inventory...
              </div>
            ) : !activeVendorName ? (
              <div className="mt-3 rounded-xl border border-zinc-900 bg-black p-4 text-sm text-zinc-600">
                My Inventory is available when this account has an active MintRadar vendor.
              </div>
            ) : inventory.length ===
              0 ? (
              <div className="mt-3 rounded-xl border border-zinc-900 bg-black p-4 text-sm text-zinc-600">
                This vendor does not have any inventory yet.
              </div>
            ) : (
              <>
                <input
                  type="search"
                  value={
                    inventorySearch
                  }
                  onChange={(event) =>
                    setInventorySearch(
                      event.target.value
                    )
                  }
                  placeholder="Search your cards, sets, numbers, grades..."
                  className="mt-3 w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm font-bold text-white outline-none transition placeholder:text-zinc-800 focus:border-emerald-400/50"
                />

                <div className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
                  {filteredInventory.length ===
                  0 ? (
                    <div className="rounded-xl border border-zinc-900 bg-black p-4 text-sm text-zinc-600">
                      No inventory matches that search.
                    </div>
                  ) : (
                    filteredInventory.map(
                      (
                        inventoryItem
                      ) => {
                        const card =
                          inventoryItem.cards;

                        return (
                          <button
                            key={
                              inventoryItem.id
                            }
                            type="button"
                            onClick={() =>
                              selectInventoryCard(
                                inventoryItem
                              )
                            }
                            className="flex w-full items-center gap-3 rounded-2xl border border-zinc-900 bg-black p-3 text-left transition hover:border-emerald-400/40"
                          >
                            <div className="flex h-20 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950">
                              {card?.image_url ? (
                                <img
                                  src={
                                    card.image_url
                                  }
                                  alt={
                                    card.name ||
                                    "Inventory card"
                                  }
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <span className="px-2 text-center text-[9px] font-black uppercase tracking-wider text-zinc-700">
                                  No image
                                </span>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="truncate font-black text-white">
                                {card?.name ||
                                  "Unknown Card"}
                              </p>

                              <p className="mt-1 truncate text-xs text-zinc-500">
                                {[
                                  card?.set_name,
                                  card?.card_number
                                    ? `#${card.card_number}`
                                    : null,
                                  card?.finish,
                                ]
                                  .filter(
                                    Boolean
                                  )
                                  .join(
                                    " • "
                                  )}
                              </p>

                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] font-black text-zinc-500">
                                  {inventoryLabel(
                                    inventoryItem
                                  )}
                                </span>

                                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[10px] font-black text-zinc-500">
                                  Qty{" "}
                                  {inventoryItem.quantity ??
                                    0}
                                </span>
                              </div>
                            </div>

                            <div className="shrink-0 text-right">
                              <p className="font-black text-emerald-300">
                                {money(
                                  inventoryItem.price
                                )}
                              </p>

                              <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-zinc-700">
                                Select
                              </p>
                            </div>
                          </button>
                        );
                      }
                    )
                  )}
                </div>
              </>
            )}
          </div>
        )}

      {selectedCard && (
        <>
          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-black p-4">
            <div className="flex items-start gap-4">
              <div className="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-900 bg-zinc-950">
                {selectedCard.image_url ? (
                  <img
                    src={
                      selectedCard.image_url
                    }
                    alt={
                      selectedCard.name ||
                      "Selected card"
                    }
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="px-2 text-center text-[9px] font-black uppercase tracking-wider text-zinc-700">
                    No image
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-lg font-black text-white">
                        {selectedCard.name ||
                          "Unknown Card"}
                      </p>

                      {selectedInventory && (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-300">
                          My Inventory
                        </span>
                      )}
                    </div>

                    {cardSecondaryLine(
                      selectedCard
                    ) && (
                      <p className="mt-1 text-sm text-zinc-500">
                        {cardSecondaryLine(
                          selectedCard
                        )}
                      </p>
                    )}

                    {cardDetailLine(
                      selectedCard
                    ) && (
                      <p className="mt-1 text-sm font-bold text-emerald-300">
                        {cardDetailLine(
                          selectedCard
                        )}
                      </p>
                    )}

                    {selectedInventory && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                          {inventoryLabel(
                            selectedInventory
                          )}
                        </span>

                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                          Available{" "}
                          {selectedInventory.quantity ??
                            0}
                        </span>

                        {selectedInventory.price !=
                          null && (
                          <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                            Listed{" "}
                            {money(
                              selectedInventory.price
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={changeCard}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-black text-zinc-400 transition hover:border-emerald-400/40 hover:text-emerald-300"
                  >
                    Change Card
                  </button>
                </div>

                {!selectedInventory && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedCard.category && (
                      <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                        {selectedCard.category}
                      </span>
                    )}

                    {selectedCard.data_source && (
                      <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                        {selectedCard.data_source}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <TradeCompButtons
              card={selectedCard}
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                Quantity
              </label>

              <input
                type="number"
                min="1"
                max={
                  maxInventoryQuantity ??
                  undefined
                }
                step="1"
                value={item.quantity}
                onChange={(event) => {
                  const nextValue =
                    Math.max(
                      1,
                      Number(
                        event.target
                          .value
                      ) || 1
                    );

                  const clampedValue =
                    maxInventoryQuantity !=
                      null
                      ? Math.min(
                          nextValue,
                          Math.max(
                            1,
                            maxInventoryQuantity
                          )
                        )
                      : nextValue;

                  onUpdate(
                    item.localId,
                    {
                      quantity:
                        clampedValue,
                    }
                  );
                }}
                className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-3 py-3 text-sm font-black text-white outline-none transition focus:border-emerald-400/50"
              />

              {selectedInventory &&
                maxInventoryQuantity !=
                  null && (
                  <p className="mt-1.5 text-xs text-zinc-700">
                    Max available:{" "}
                    {
                      maxInventoryQuantity
                    }
                  </p>
                )}
            </div>

            <div>
              <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                Market Value
              </label>

              <div className="mt-2 flex items-center rounded-xl border border-zinc-800 bg-black focus-within:border-emerald-400/50">
                <span className="pl-3 font-black text-zinc-600">
                  $
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={
                    item.marketValue
                  }
                  onChange={(event) =>
                    onUpdate(
                      item.localId,
                      {
                        marketValue:
                          event.target
                            .value,
                      }
                    )
                  }
                  placeholder="Check comps, then enter value"
                  className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm font-black text-white outline-none"
                />
              </div>

              {selectedInventory?.price !=
                null && (
                <p className="mt-1.5 text-xs text-zinc-700">
                  Started from your listing price. Adjust after checking comps.
                </p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex-1">
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Trade Percentage
                </p>

                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {QUICK_PERCENTAGES.map(
                    (percentage) => {
                      const selected =
                        item.tradePercentage ===
                        percentage;

                      return (
                        <button
                          key={
                            percentage
                          }
                          type="button"
                          onClick={() =>
                            onUpdate(
                              item.localId,
                              {
                                tradePercentage:
                                  percentage,
                              }
                            )
                          }
                          className={`rounded-xl border px-2 py-2 text-xs font-black transition ${
                            selected
                              ? "border-emerald-400 bg-emerald-400 text-black"
                              : "border-zinc-800 bg-black text-zinc-500 hover:border-emerald-400/40 hover:text-emerald-300"
                          }`}
                        >
                          {
                            percentage
                          }
                          %
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div className="w-24">
                <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Custom
                </label>

                <div className="mt-2 flex items-center rounded-xl border border-zinc-800 bg-black focus-within:border-emerald-400/50">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={
                      item.tradePercentage
                    }
                    onChange={(event) =>
                      onUpdate(
                        item.localId,
                        {
                          tradePercentage:
                            Math.max(
                              0,
                              Number(
                                event
                                  .target
                                  .value
                              ) ||
                                0
                            ),
                        }
                      )
                    }
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 text-right text-sm font-black text-white outline-none"
                  />

                  <span className="pr-2 text-xs font-black text-zinc-600">
                    %
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-400/10 bg-black px-3 py-3">
              <span className="text-xs font-black uppercase tracking-wider text-zinc-600">
                Adjusted Trade Value
              </span>

              <span className="font-black text-emerald-400">
                {money(itemTrade)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatStatus(status: TradeOffer["status"]) {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "countered":
      return "Countered";
    case "cancelled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

function statusClasses(status: TradeOffer["status"]) {
  switch (status) {
    case "accepted":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
    case "declined":
      return "border-red-400/30 bg-red-400/10 text-red-300";
    case "countered":
      return "border-amber-400/30 bg-amber-400/10 text-amber-300";
    case "cancelled":
      return "border-zinc-700 bg-zinc-900 text-zinc-500";
    default:
      return "border-sky-400/30 bg-sky-400/10 text-sky-300";
  }
}

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();

  const conversationId = String(
    params.conversationId ||
      params.coversationId ||
      ""
  );

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [conversation, setConversation] =
    useState<InboxRow | null>(null);

  const [tradeOffers, setTradeOffers] =
    useState<TradeOfferMap>({});

  const [tradeTransactions, setTradeTransactions] =
    useState<TradeTransactionMap>({});

  const [confirmingTransactionId, setConfirmingTransactionId] =
    useState<string | null>(null);

  const [respondingOfferId, setRespondingOfferId] =
    useState<string | null>(null);

  const [counteringOfferId, setCounteringOfferId] =
    useState<string | null>(null);

  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [isVendor, setIsVendor] = useState(false);

  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);

  const [activeVendorId, setActiveVendorId] =
    useState<string | null>(null);

  const [activeVendorName, setActiveVendorName] =
    useState<string | null>(null);

  const [tradeInventory, setTradeInventory] =
    useState<InventoryTradeItem[]>([]);

  const [tradeInventoryLoading, setTradeInventoryLoading] =
    useState(false);

  const [showTradeBuilder, setShowTradeBuilder] =
    useState(false);

  const [sendingTradeOffer, setSendingTradeOffer] =
    useState(false);

  const [tradeOfferNote, setTradeOfferNote] =
    useState("");

  const [targetMarketValue, setTargetMarketValue] =
    useState("");

  const [offerItems, setOfferItems] = useState<
    OfferDraftItem[]
  >([newOfferDraftItem()]);

  const snapshot = conversation?.context_snapshot;

  const offeredMarketTotal = useMemo(() => {
    return offerItems.reduce((total, item) => {
      const marketValue = numericValue(item.marketValue);
      const quantity = Math.max(1, Number(item.quantity) || 1);

      return total + marketValue * quantity;
    }, 0);
  }, [offerItems]);

  const offeredTradeTotal = useMemo(() => {
    return offerItems.reduce((total, item) => {
      const marketValue = numericValue(item.marketValue);
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const percentage = Math.max(
        0,
        Number(item.tradePercentage) || 0
      );

      return (
        total +
        marketValue *
          quantity *
          (percentage / 100)
      );
    }, 0);
  }, [offerItems]);

  const targetValue = numericValue(targetMarketValue);

  const tradeDifference =
    offeredTradeTotal - targetValue;

  function resetTradeBuilder() {
    setTradeOfferNote("");
    setTargetMarketValue(
      snapshot?.price != null
        ? String(snapshot.price)
        : ""
    );
    setOfferItems([newOfferDraftItem()]);
  }

  function openTradeBuilder() {
    setCounteringOfferId(null);
    resetTradeBuilder();
    setError("");
    setShowTradeBuilder(true);
  }

  function updateOfferItem(
    localId: string,
    patch: Partial<OfferDraftItem>
  ) {
    setOfferItems((current) =>
      current.map((item) =>
        item.localId === localId
          ? { ...item, ...patch }
          : item
      )
    );
  }

  function removeOfferItem(localId: string) {
    setOfferItems((current) => {
      if (current.length <= 1) {
        return [newOfferDraftItem()];
      }

      return current.filter(
        (item) => item.localId !== localId
      );
    });
  }

  function addOfferItem() {
    setOfferItems((current) => [
      ...current,
      newOfferDraftItem(),
    ]);
  }

  async function markRead() {
    const { error } = await supabase.rpc(
      "mark_conversation_read",
      {
        p_conversation_id: conversationId,
      }
    );

    if (error) {
      console.error("Mark read error:", error);
    }
  }

  async function loadTradeTransactions(
    offers: TradeOffer[]
  ) {
    const acceptedOffers =
      offers.filter(
        (offer) =>
          offer.status ===
          "accepted"
      );

    if (
      acceptedOffers.length === 0
    ) {
      setTradeTransactions({});
      return;
    }

    const results =
      await Promise.all(
        acceptedOffers.map(
          async (offer) => {
            const {
              data,
              error,
            } =
              await supabase.rpc(
                "get_trade_transaction",
                {
                  p_trade_offer_id:
                    offer.id,
                }
              );

            if (error) {
              console.error(
                "Trade transaction load error:",
                offer.id,
                error
              );

              return null;
            }

            const row =
              Array.isArray(data) &&
              data.length > 0
                ? (data[0] as TradeTransaction)
                : null;

            return row;
          }
        )
      );

    const nextTransactions:
      TradeTransactionMap = {};

    for (const transaction of results) {
      if (
        !transaction?.trade_offer_id
      ) {
        continue;
      }

      nextTransactions[
        transaction.trade_offer_id
      ] = transaction;
    }

    setTradeTransactions(
      nextTransactions
    );
  }

  async function loadTradeOffers(
    rows: MessageRow[]
  ) {
    const tradeOfferIds = Array.from(
      new Set(
        rows
          .filter(
            (message) =>
              message.message_type ===
                "trade_offer" &&
              message.trade_offer_id
          )
          .map(
            (message) =>
              message.trade_offer_id as string
          )
      )
    );

    if (tradeOfferIds.length === 0) {
      setTradeOffers({});
      return;
    }

    const results = await Promise.all(
      tradeOfferIds.map(async (tradeOfferId) => {
        const { data, error } = await supabase.rpc(
          "get_trade_offer",
          {
            p_trade_offer_id: tradeOfferId,
          }
        );

        if (error) {
          console.error(
            "Trade offer load error:",
            tradeOfferId,
            error
          );

          return null;
        }

        return data as TradeOffer;
      })
    );

    const nextOffers: TradeOfferMap = {};

    for (const offer of results) {
      if (!offer?.id) continue;
      nextOffers[offer.id] = offer;
    }

    setTradeOffers(nextOffers);

    await loadTradeTransactions(
      Object.values(nextOffers)
    );
  }

  async function loadMessages() {
    const { data, error } = await supabase.rpc(
      "get_conversation_messages",
      {
        p_conversation_id: conversationId,
      }
    );

    if (error) throw error;

    const rows = (data || []) as MessageRow[];

    setMessages(rows);
    await loadTradeOffers(rows);
  }

  async function loadConversation() {
    const { data, error } =
      await supabase.rpc("get_message_inbox");

    if (error) throw error;

    const found = ((data || []) as InboxRow[]).find(
      (row) =>
        row.conversation_id === conversationId
    );

    if (!found) {
      throw new Error(
        "Conversation not found or you do not have access."
      );
    }

    setConversation(found);

    setTargetMarketValue(
      found.context_snapshot?.price != null
        ? String(found.context_snapshot.price)
        : ""
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadTradeInventory() {
      if (!activeVendorId) {
        setTradeInventory([]);
        setTradeInventoryLoading(false);
        return;
      }

      try {
        setTradeInventoryLoading(true);

        const { data, error } =
          await supabase
            .from("inventory")
            .select(`
              id,
              vendor_id,
              card_id,
              listing_type,
              condition,
              grading_company,
              grade,
              cert_number,
              price,
              quantity,
              notes,
              cards (
                id,
                external_id,
                name,
                set_name,
                card_number,
                image_url,
                rarity,
                category,
                edition,
                finish
              )
            `)
            .eq(
              "vendor_id",
              activeVendorId
            )
            .order("id", {
              ascending: false,
            });

        if (error) {
          throw error;
        }

        if (!cancelled) {
          setTradeInventory(
            (data || []) as unknown as InventoryTradeItem[]
          );
        }
      } catch (err) {
        console.error(
          "Trade inventory load error:",
          err
        );

        if (!cancelled) {
          setTradeInventory([]);
        }
      } finally {
        if (!cancelled) {
          setTradeInventoryLoading(false);
        }
      }
    }

    loadTradeInventory();

    return () => {
      cancelled = true;
    };
  }, [activeVendorId]);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        setLoading(true);
        setError("");

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session) {
          router.replace("/customer/login");
          return;
        }

        if (mounted) {
          setCurrentUserId(session.user.id);
        }

        const activeMembership =
          await getActiveVendorMembership(
            supabase,
            session.user.id
          );

        if (mounted) {
          setIsVendor(
            Boolean(
              activeMembership?.vendor_id
            )
          );

          setActiveVendorId(
            activeMembership?.vendor_id ||
              null
          );

          setActiveVendorName(
            activeMembership?.vendor
              ?.business_name ||
              (activeMembership
                ? "MintRadar Vendor"
                : null)
          );
        }

        await Promise.all([
          loadConversation(),
          loadMessages(),
          markRead(),
        ]);
      } catch (err: any) {
        console.error("Conversation error:", err);

        if (mounted) {
          setError(
            err?.message ||
              "We couldn't load this conversation."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    if (conversationId) {
      boot();
    }

    const channel = supabase
      .channel(
        `conversation-${conversationId}`
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        async () => {
          if (!mounted) return;

          try {
            await loadMessages();
            await markRead();
          } catch (err) {
            console.error(
              "Realtime message refresh error:",
              err
            );
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  async function sendMessage(
    event: FormEvent
  ) {
    event.preventDefault();

    const cleanBody = body.trim();

    if (!cleanBody || sending) return;

    if (!conversationId) {
      setError(
        "MintRadar could not identify this conversation."
      );
      return;
    }

    try {
      setSending(true);
      setError("");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        router.replace("/customer/login");
        return;
      }

      const { error: sendError } =
        await supabase.rpc("send_message", {
          p_conversation_id: conversationId,
          p_body: cleanBody,
        });

      if (sendError) {
        throw sendError;
      }

      setBody("");
      await loadMessages();
      await markRead();
    } catch (err: any) {
      const readableMessage =
        err?.message ||
        err?.details ||
        err?.hint ||
        (typeof err === "string"
          ? err
          : "Your message could not be sent.");

      console.error("Send message error:", {
        message: err?.message,
        details: err?.details,
        hint: err?.hint,
        code: err?.code,
        conversationId,
      });

      setError(readableMessage);
    } finally {
      setSending(false);
    }
  }

  async function confirmTradeCompletion(
    transaction: TradeTransaction
  ) {
    if (
      confirmingTransactionId
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        "Confirm that your side of this trade has been completed? Only do this after the cards have actually been exchanged."
      );

    if (!confirmed) return;

    try {
      setConfirmingTransactionId(
        transaction.id
      );

      setError("");

      const {
        data,
        error:
          confirmationError,
      } = await supabase.rpc(
        "confirm_trade_completion",
        {
          p_trade_transaction_id:
            transaction.id,
        }
      );

      if (
        confirmationError
      ) {
        throw confirmationError;
      }

      setTradeTransactions(
        (current) => ({
          ...current,
          [transaction.trade_offer_id]:
            {
              ...transaction,
              status:
                data?.status ||
                transaction.status,
              current_user_confirmed:
                true,
              other_side_confirmed:
                Boolean(
                  data?.sender_confirmed_at &&
                    data?.recipient_confirmed_at
                )
                  ? true
                  : transaction.other_side_confirmed,
              sender_confirmed_at:
                data?.sender_confirmed_at ??
                transaction.sender_confirmed_at,
              recipient_confirmed_at:
                data?.recipient_confirmed_at ??
                transaction.recipient_confirmed_at,
              completed_at:
                data?.completed_at ??
                transaction.completed_at,
            },
        })
      );

      await Promise.all([
        loadMessages(),
        markRead(),
      ]);
    } catch (err: any) {
      console.error(
        "Trade completion confirmation error:",
        err
      );

      setError(
        err?.message ||
          "MintRadar could not confirm this trade."
      );
    } finally {
      setConfirmingTransactionId(
        null
      );
    }
  }

  function openCounterBuilder(
    offer: TradeOffer
  ) {
    if (respondingOfferId) return;

    const targetSnapshot =
      offer.target_snapshot || {};

    setCounteringOfferId(offer.id);
    setShowTradeBuilder(true);
    setTradeOfferNote("");

    setTargetMarketValue(
      String(
        numericValue(
          offer.target_market_value
        )
      )
    );

    setOfferItems([
      newOfferDraftItem(),
    ]);

    setError("");

    window.setTimeout(() => {
      bottomRef.current?.scrollIntoView({
        behavior: "smooth",
      });
    }, 50);
  }

  function closeTradeBuilder() {
    if (sendingTradeOffer) return;

    setShowTradeBuilder(false);
    setCounteringOfferId(null);
  }

  async function respondToTradeOffer(
    tradeOfferId: string,
    action: "accept" | "decline"
  ) {
    if (respondingOfferId) return;

    const confirmed = window.confirm(
      action === "accept"
        ? "Accept this trade offer?"
        : "Decline this trade offer?"
    );

    if (!confirmed) return;

    try {
      setRespondingOfferId(tradeOfferId);
      setError("");

      const {
        data,
        error: responseError,
      } = await supabase.rpc(
        "respond_trade_offer",
        {
          p_trade_offer_id: tradeOfferId,
          p_action: action,
        }
      );

      if (responseError) {
        throw responseError;
      }

      const nextStatus =
        data?.status === "accepted"
          ? "accepted"
          : data?.status === "declined"
            ? "declined"
            : null;

      if (nextStatus) {
        setTradeOffers((current) => {
          const existing =
            current[tradeOfferId];

          if (!existing) {
            return current;
          }

          return {
            ...current,
            [tradeOfferId]: {
              ...existing,
              status: nextStatus,
              responded_at:
                new Date().toISOString(),
            },
          };
        });
      }

      await Promise.all([
        loadMessages(),
        markRead(),
      ]);
    } catch (err: any) {
      console.error(
        "Trade offer response error:",
        err
      );

      setError(
        err?.message ||
          "MintRadar could not respond to this trade offer."
      );
    } finally {
      setRespondingOfferId(null);
    }
  }

  async function sendTradeOffer(
    event: FormEvent
  ) {
    event.preventDefault();

    if (
      sendingTradeOffer ||
      !conversationId
    ) {
      return;
    }

    if (!conversation) {
      setError(
        "MintRadar could not load the listing context for this trade."
      );
      return;
    }

    if (targetValue < 0) {
      setError(
        "Enter a valid target market value."
      );
      return;
    }

    const normalizedItems = offerItems.map(
      (item) => ({
        ...item,
        numericQuantity: Math.max(
          1,
          Number(item.quantity) || 1
        ),
        numericMarketValue:
          numericValue(item.marketValue),
        numericTradePercentage: Math.max(
          0,
          Number(item.tradePercentage) || 0
        ),
      })
    );

    if (
      normalizedItems.some(
        (item) => !item.selectedCard
      )
    ) {
      setError(
        "Select every offered card from the MintRadar catalog or your inventory before sending the offer."
      );
      return;
    }

    if (
      normalizedItems.some(
        (item) =>
          item.numericMarketValue < 0
      )
    ) {
      setError(
        "Every offered card needs a valid market value."
      );
      return;
    }

    try {
      setSendingTradeOffer(true);
      setError("");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        router.replace("/customer/login");
        return;
      }

      const offeredItemsPayload =
        normalizedItems.map((item) => {
          const card =
            item.selectedCard as CatalogCard;

          const inventoryItem =
            item.selectedInventory;

          return {
            inventory_id:
              inventoryItem?.id ||
              null,

            card_id:
              inventoryItem?.card_id ||
              null,

            snapshot: {
              card_name: card.name || null,
              set_name: card.set_name || null,
              set_id: card.set_id || null,
              card_number: card.card_number || null,
              image_url: card.image_url || null,
              category: card.category || null,
              rarity: card.rarity || null,
              edition: card.edition || null,
              finish: card.finish || null,
              illustrator: card.illustrator || null,
              year: card.year || null,
              manufacturer: card.manufacturer || null,
              release_name: card.release_name || null,
              parallel_name: card.parallel_name || null,
              sport: card.sport || null,
              print_run: card.print_run ?? null,
              rookie: card.rookie ?? null,
              external_id: card.external_id,
              data_source: card.data_source,

              source:
                inventoryItem
                  ? "inventory"
                  : "catalog",

              inventory_id:
                inventoryItem?.id ||
                null,

              inventory_listing_price:
                inventoryItem?.price ??
                null,

              condition:
                inventoryItem?.condition ||
                null,

              grading_company:
                inventoryItem?.grading_company ||
                null,

              grade:
                inventoryItem?.grade ||
                null,

              cert_number:
                inventoryItem?.cert_number ||
                null,

              vendor_name:
                inventoryItem
                  ? activeVendorName
                  : null,
            },

            quantity:
              item.numericQuantity,

            market_value:
              item.numericMarketValue,

            trade_percentage:
              item.numericTradePercentage,
          };
        });

      if (counteringOfferId) {
        const {
          data: counterData,
          error: counterError,
        } = await supabase.rpc(
          "counter_trade_offer",
          {
            p_parent_offer_id:
              counteringOfferId,

            p_target_inventory_id:
              conversation.context_inventory_id,

            p_target_card_id:
              conversation.context_card_id,

            p_target_snapshot:
              conversation.context_snapshot ||
              {},

            p_target_market_value:
              targetValue,

            p_offered_items:
              offeredItemsPayload,

            p_message_body:
              tradeOfferNote.trim() ||
              "Counter offer sent.",
          }
        );

        if (counterError) {
          throw counterError;
        }

        if (
          !Array.isArray(counterData) ||
          counterData.length === 0 ||
          !counterData[0]?.trade_offer_id
        ) {
          throw new Error(
            "MintRadar created an unexpected counter offer response."
          );
        }
      } else {
        const response = await fetch(
          "/api/messages/trade-offers/send",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              conversationId,
              senderVendorId: null,

              targetInventoryId:
                conversation.context_inventory_id,

              targetCardId:
                conversation.context_card_id,

              targetSnapshot:
                conversation.context_snapshot ||
                {},

              targetMarketValue:
                targetValue,

              offeredItems:
                offeredItemsPayload,

              messageBody:
                tradeOfferNote.trim() ||
                "Trade offer sent.",
            }),
          }
        );

        const result =
          await response.json();

        if (
          !response.ok ||
          !result?.ok
        ) {
          throw new Error(
            result?.error ||
              "The trade offer could not be sent."
          );
        }
      }

      setShowTradeBuilder(false);
      setCounteringOfferId(null);
      resetTradeBuilder();

      await loadMessages();
      await markRead();
    } catch (err: any) {
      console.error(
        "Send trade offer error:",
        err
      );

      setError(
        err?.message ||
          (counteringOfferId
            ? "The counter offer could not be sent."
            : "The trade offer could not be sent.")
      );
    } finally {
      setSendingTradeOffer(false);
    }
  }

  function renderTradeOffer(
    message: MessageRow
  ) {
    if (!message.trade_offer_id) {
      return (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300">
          MintRadar could not identify this trade offer.
        </div>
      );
    }

    const offer =
      tradeOffers[message.trade_offer_id];

    if (!offer) {
      return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
          Loading trade offer...
        </div>
      );
    }

    const targetSnapshot =
      offer.target_snapshot || {};

    const difference =
      numericValue(offer.difference);

    const transaction =
      tradeTransactions[offer.id];

    return (
      <div className="overflow-hidden rounded-3xl border border-emerald-400/20 bg-zinc-950 shadow-2xl shadow-black/20">
        <div className="border-b border-zinc-900 bg-emerald-400/[0.04] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                📡 Trade Offer
              </p>

              <p className="mt-1 text-sm font-bold text-zinc-400">
                {message.is_mine
                  ? "You sent an offer"
                  : "You received an offer"}
              </p>
            </div>

            <span
              className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wider ${statusClasses(
                offer.status
              )}`}
            >
              {formatStatus(
                offer.status
              )}
            </span>
          </div>

          {message.body &&
            message.body !==
              "Trade offer sent." && (
              <p className="mt-4 rounded-2xl border border-zinc-800 bg-black/50 p-3 text-sm leading-6 text-zinc-300">
                {message.body}
              </p>
            )}
        </div>

        <div className="p-4 sm:p-5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
            Offered Cards
          </p>

          <div className="mt-3 space-y-2">
            {offer.items.map(
              (item) => {
                const itemSnapshot =
                  item.snapshot || {};

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-zinc-900 bg-black p-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 gap-3">
                        {itemSnapshot.image_url && (
                          <img
                            src={itemSnapshot.image_url}
                            alt={itemSnapshot.card_name || "Offered card"}
                            className="h-16 w-11 shrink-0 rounded-lg object-contain"
                          />
                        )}

                        <div className="min-w-0">
                          <p className="font-black text-white">
                            {itemSnapshot.card_name ||
                              "Offered Card"}
                          </p>

                        {(itemSnapshot.set_name ||
                          itemSnapshot.card_number) && (
                          <p className="mt-1 text-xs text-zinc-600">
                            {[
                              itemSnapshot.set_name,
                              itemSnapshot.card_number
                                ? `#${itemSnapshot.card_number}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </p>
                        )}

                          <p className="mt-2 text-xs font-bold text-zinc-500">
                            {Number(
                              item.quantity
                            ) > 1
                              ? `${item.quantity} × `
                              : ""}
                            {money(
                              item.market_value
                            )}{" "}
                            at{" "}
                            <span className="text-emerald-300">
                              {numericValue(
                                item.trade_percentage
                              )}
                              %
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-xs font-black uppercase tracking-wider text-zinc-700">
                          Trade
                        </p>
                        <p className="mt-1 font-black text-emerald-400">
                          {money(
                            item.adjusted_trade_value
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-zinc-900 bg-black p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
                Offer Totals
              </p>

              <div className="mt-3 flex items-center justify-between gap-4 text-sm">
                <span className="text-zinc-500">
                  Market
                </span>
                <span className="font-black text-white">
                  {money(
                    offer.offered_market_total
                  )}
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between gap-4 text-sm">
                <span className="text-zinc-500">
                  Trade
                </span>
                <span className="font-black text-emerald-400">
                  {money(
                    offer.offered_trade_total
                  )}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-900 bg-black p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
                Target
              </p>

              <p className="mt-3 truncate font-black text-white">
                {targetSnapshot.card_name ||
                  "Target Card"}
              </p>

              {(targetSnapshot.set_name ||
                targetSnapshot.card_number) && (
                <p className="mt-1 text-xs text-zinc-600">
                  {[
                    targetSnapshot.set_name,
                    targetSnapshot.card_number
                      ? `#${targetSnapshot.card_number}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </p>
              )}

              <p className="mt-2 text-lg font-black text-white">
                {money(
                  offer.target_market_value
                )}
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-2xl border border-zinc-900 bg-black p-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-black uppercase tracking-wider text-zinc-600">
                Difference
              </span>

              <span
                className={`text-xl font-black ${
                  difference > 0
                    ? "text-emerald-400"
                    : difference < 0
                      ? "text-amber-300"
                      : "text-white"
                }`}
              >
                {difference > 0
                  ? "+"
                  : ""}
                {money(difference)}
              </span>
            </div>
          </div>

          {offer.status ===
            "pending" && (
            <div className="mt-4">
              {offer.sender_user_id ===
              currentUserId ? (
                <div className="rounded-xl border border-zinc-900 bg-black px-3 py-3 text-center">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-300">
                    Pending
                  </p>

                  <p className="mt-1 text-xs font-bold text-zinc-600">
                    Waiting for the other side to respond.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-400/20 bg-black p-3">
                  <p className="text-center text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
                    Respond to Trade Offer
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={
                        respondingOfferId ===
                        offer.id
                      }
                      onClick={() =>
                        respondToTradeOffer(
                          offer.id,
                          "accept"
                        )
                      }
                      className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {respondingOfferId ===
                      offer.id
                        ? "WORKING..."
                        : "✓ ACCEPT TRADE"}
                    </button>

                    <button
                      type="button"
                      disabled={
                        respondingOfferId ===
                        offer.id
                      }
                      onClick={() =>
                        openCounterBuilder(
                          offer
                        )
                      }
                      className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-black text-zinc-400 transition hover:border-emerald-400/40 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ↔ COUNTER
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={
                      respondingOfferId ===
                      offer.id
                    }
                    onClick={() =>
                      respondToTradeOffer(
                        offer.id,
                        "decline"
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-red-400/20 bg-red-400/[0.04] px-4 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-red-300 transition hover:border-red-400/40 hover:bg-red-400/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          )}

          {offer.status ===
            "accepted" && (
            <div className="mt-4 overflow-hidden rounded-2xl border border-emerald-400/20 bg-black">
              <div className="border-b border-zinc-900 bg-emerald-400/[0.05] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                      ✓ Trade Accepted
                    </p>

                    <p className="mt-1 text-xs text-zinc-600">
                      Both sides confirm after the cards have actually been exchanged.
                    </p>
                  </div>

                  {transaction?.status ===
                    "completed" && (
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                      Completed
                    </span>
                  )}
                </div>
              </div>

              {!transaction ? (
                <div className="p-4">
                  <p className="text-sm font-bold text-zinc-500">
                    This accepted offer does not have a completion transaction available yet.
                  </p>

                  <p className="mt-1 text-xs text-zinc-700">
                    Earlier accepted test offers may predate the completion workflow.
                  </p>
                </div>
              ) : (
                <div className="p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
                    Trade Completion
                  </p>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div
                      className={`rounded-xl border p-3 ${
                        transaction.current_user_confirmed
                          ? "border-emerald-400/20 bg-emerald-400/[0.05]"
                          : "border-zinc-900 bg-zinc-950"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-black text-white">
                          Your confirmation
                        </span>

                        <span
                          className={`text-xs font-black uppercase tracking-wider ${
                            transaction.current_user_confirmed
                              ? "text-emerald-300"
                              : "text-zinc-700"
                          }`}
                        >
                          {transaction.current_user_confirmed
                            ? "✓ Confirmed"
                            : "○ Waiting"}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`rounded-xl border p-3 ${
                        transaction.other_side_confirmed
                          ? "border-emerald-400/20 bg-emerald-400/[0.05]"
                          : "border-zinc-900 bg-zinc-950"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-black text-white">
                          Other side
                        </span>

                        <span
                          className={`text-xs font-black uppercase tracking-wider ${
                            transaction.other_side_confirmed
                              ? "text-emerald-300"
                              : "text-zinc-700"
                          }`}
                        >
                          {transaction.other_side_confirmed
                            ? "✓ Confirmed"
                            : "○ Waiting"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {transaction.status ===
                    "completed" ? (
                    <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-center">
                      <p className="text-sm font-black uppercase tracking-[0.14em] text-emerald-300">
                        ✓ Trade Completed
                      </p>

                      {transaction.completed_at && (
                        <p className="mt-1 text-xs text-zinc-600">
                          {new Date(
                            transaction.completed_at
                          ).toLocaleString()}
                        </p>
                      )}
                    </div>
                  ) : transaction.current_user_confirmed ? (
                    <div className="mt-3 rounded-xl border border-zinc-900 bg-zinc-950 p-3 text-center">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-300">
                        Your Side Is Confirmed
                      </p>

                      <p className="mt-1 text-xs text-zinc-600">
                        Waiting for the other side to confirm completion.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <button
                        type="button"
                        disabled={
                          confirmingTransactionId ===
                          transaction.id
                        }
                        onClick={() =>
                          confirmTradeCompletion(
                            transaction
                          )
                        }
                        className="w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {confirmingTransactionId ===
                        transaction.id
                          ? "CONFIRMING..."
                          : "✓ CONFIRM TRADE COMPLETED"}
                      </button>

                      <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-wider text-zinc-700">
                        Only confirm after your side of the exchange is complete.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {offer.status !==
            "pending" &&
            offer.status !==
              "accepted" && (
            <div
              className={`mt-4 rounded-xl border px-3 py-3 text-center ${
                offer.status ===
                  "declined"
                  ? "border-red-400/20 bg-red-400/[0.04]"
                  : "border-zinc-800 bg-black"
              }`}
            >
              <p
                className={`text-xs font-black uppercase tracking-[0.16em] ${
                  offer.status ===
                    "declined"
                    ? "text-red-300"
                    : "text-zinc-500"
                }`}
              >
                {offer.status ===
                  "declined"
                  ? "Trade Declined"
                  : offer.status ===
                      "countered"
                    ? "Countered"
                    : "Cancelled"}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 pb-8 pt-20 text-white sm:px-5 sm:pt-24">
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950">
        <header className="border-b border-zinc-900 p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/"
                className="w-fit"
              >
                <Image
                  src="/mintradar-logo.png"
                  alt="MintRadar by OnlySlabs"
                  width={600}
                  height={300}
                  priority
                  className="h-auto w-[180px] sm:w-[220px]"
                />
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                {isVendor && (
                  <Link
                    href="/vendor"
                    className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm font-black text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
                  >
                    ← Vendor Dashboard
                  </Link>
                )}

                <Link
                  href="/messages"
                  className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm font-black text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  ← Inbox
                </Link>
              </div>
            </div>

            <div className="min-w-0">
              <p className="truncate text-xl font-black">
                {conversation?.counterpart_name ||
                  "Conversation"}
              </p>

              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-400">
                MintRadar Messages
              </p>
            </div>
          </div>

          {snapshot?.card_name && (
            <div className="mt-4 flex gap-3 rounded-2xl border border-zinc-800 bg-black p-3">
              {snapshot.image_url && (
                <img
                  src={snapshot.image_url}
                  alt={snapshot.card_name}
                  className="h-20 w-14 shrink-0 rounded-lg object-contain"
                />
              )}

              <div className="min-w-0 flex-1">
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Listing Context
                </p>

                <p className="mt-1 truncate font-black text-emerald-300">
                  {snapshot.card_name}
                </p>

                <p className="mt-1 text-sm text-zinc-500">
                  {[
                    snapshot.set_name,
                    snapshot.card_number
                      ? `#${snapshot.card_number}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </p>

                {snapshot.price != null && (
                  <p className="mt-1 font-black">
                    {money(
                      snapshot.price
                    )}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={openTradeBuilder}
                className="self-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-black uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-400 hover:text-black"
              >
                Make Trade Offer
              </button>
            </div>
          )}
        </header>

        {error && (
          <div className="m-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="py-16 text-center text-zinc-500">
              Loading conversation...
            </div>
          ) : messages.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-2xl font-black">
                Start the conversation.
              </p>
              <p className="mt-2 text-zinc-500">
                Send the first MintRadar message below.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map(
                (message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.is_mine
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div
                      className={
                        message.message_type ===
                        "trade_offer"
                          ? "w-full max-w-[95%] sm:max-w-[82%]"
                          : "max-w-[85%] sm:max-w-[70%]"
                      }
                    >
                      {!message.is_mine && (
                        <p className="mb-1 px-1 text-xs font-bold text-zinc-600">
                          {message.sender_vendor_name
                            ? `${message.sender_vendor_name}${
                                message.sender_display_name
                                  ? ` • ${message.sender_display_name}`
                                  : ""
                              }`
                            : message.sender_display_name ||
                              "MintRadar User"}
                        </p>
                      )}

                      {message.message_type ===
                      "trade_offer" ? (
                        renderTradeOffer(
                          message
                        )
                      ) : (
                        <div
                          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                            message.is_mine
                              ? "rounded-br-md bg-emerald-400 font-medium text-black"
                              : "rounded-bl-md border border-zinc-800 bg-zinc-900 text-zinc-100"
                          }`}
                        >
                          {message.body}
                        </div>
                      )}

                      <p
                        className={`mt-1 px-1 text-[10px] text-zinc-700 ${
                          message.is_mine
                            ? "text-right"
                            : "text-left"
                        }`}
                      >
                        {new Date(
                          message.created_at
                        ).toLocaleString()}
                      </p>
                    </div>
                  </div>
                )
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {showTradeBuilder && (
          <div className="border-t border-emerald-400/20 bg-zinc-950 p-3 sm:p-4">
            <form
              onSubmit={sendTradeOffer}
              className="overflow-hidden rounded-3xl border border-emerald-400/20 bg-black"
            >
              <div className="border-b border-zinc-900 bg-emerald-400/[0.04] p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                      {counteringOfferId
                        ? "↔ Build Counter Offer"
                        : "📡 Build Trade Offer"}
                    </p>

                    <h2 className="mt-2 text-xl font-black text-white">
                      {counteringOfferId
                        ? "Send a new offer without overwriting the original."
                        : "Run the numbers without leaving the chat."}
                    </h2>
                  </div>

                  <button
                    type="button"
                    onClick={closeTradeBuilder}
                    disabled={
                      sendingTradeOffer
                    }
                    className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm font-black text-zinc-500 transition hover:border-zinc-700 hover:text-white disabled:opacity-40"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="max-h-[65vh] overflow-y-auto p-4 sm:p-5">
                {counteringOfferId && (
                  <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-3">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-300">
                      Countering Existing Offer
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-600">
                      The original offer will remain in the conversation and will be marked COUNTERED when this new offer is sent.
                    </p>
                  </div>
                )}
                <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
                    Target Card
                  </p>

                  <div className="mt-3 flex gap-3">
                    {snapshot?.image_url && (
                      <img
                        src={
                          snapshot.image_url
                        }
                        alt={
                          snapshot.card_name ||
                          "Target card"
                        }
                        className="h-24 w-16 shrink-0 rounded-xl object-contain"
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-black text-white">
                        {snapshot?.card_name ||
                          "Listing"}
                      </p>

                      <p className="mt-1 text-sm text-zinc-600">
                        {[
                          snapshot?.set_name,
                          snapshot?.card_number
                            ? `#${snapshot.card_number}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>

                      <label className="mt-3 block text-xs font-black uppercase tracking-wider text-zinc-600">
                        Target Value
                      </label>

                      <div className="mt-2 flex items-center rounded-xl border border-zinc-800 bg-black focus-within:border-emerald-400/50">
                        <span className="pl-3 font-black text-zinc-600">
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
                          placeholder="0.00"
                          className="min-w-0 flex-1 bg-transparent px-2 py-3 font-black text-white outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
                      Your Offer
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Add one or more cards and choose the percentage for each.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={addOfferItem}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black"
                  >
                    + Add Card
                  </button>
                </div>

                <div className="mt-3 space-y-4">
                  {offerItems.map((item, index) => (
                    <TradeOfferCatalogCardEditor
                      key={item.localId}
                      item={item}
                      index={index}
                      inventory={tradeInventory}
                      inventoryLoading={tradeInventoryLoading}
                      activeVendorName={activeVendorName}
                      onUpdate={updateOfferItem}
                      onRemove={removeOfferItem}
                    />
                  ))}
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
                    <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                      Offer Market
                    </p>
                    <p className="mt-2 text-2xl font-black text-white">
                      {money(
                        offeredMarketTotal
                      )}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-emerald-400/20 bg-zinc-950 p-4">
                    <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                      Offer Trade
                    </p>
                    <p className="mt-2 text-2xl font-black text-emerald-400">
                      {money(
                        offeredTradeTotal
                      )}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
                    <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                      Difference
                    </p>

                    <p
                      className={`mt-2 text-2xl font-black ${
                        tradeDifference >
                        0
                          ? "text-emerald-400"
                          : tradeDifference <
                              0
                            ? "text-amber-300"
                            : "text-white"
                      }`}
                    >
                      {tradeDifference > 0
                        ? "+"
                        : ""}
                      {money(
                        tradeDifference
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-5">
                  <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                    Note
                  </label>

                  <textarea
                    value={
                      tradeOfferNote
                    }
                    onChange={(event) =>
                      setTradeOfferNote(
                        event.target.value
                      )
                    }
                    maxLength={1000}
                    rows={2}
                    placeholder="Optional note with your offer..."
                    className="mt-2 w-full resize-y rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-800 focus:border-emerald-400/50"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-900 p-4 sm:p-5">
                <button
                  type="button"
                  onClick={resetTradeBuilder}
                  disabled={
                    sendingTradeOffer
                  }
                  className="rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm font-black text-zinc-500 transition hover:border-zinc-700 hover:text-white disabled:opacity-40"
                >
                  Reset
                </button>

                <button
                  type="submit"
                  disabled={
                    sendingTradeOffer
                  }
                  className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sendingTradeOffer
                    ? counteringOfferId
                      ? "Sending Counter..."
                      : "Sending Offer..."
                    : counteringOfferId
                      ? "Send Counter Offer"
                      : "Send Trade Offer"}
                </button>
              </div>
            </form>
          </div>
        )}

        <form
          onSubmit={sendMessage}
          className="border-t border-zinc-900 bg-black/60 p-3 sm:p-4"
        >
          {!showTradeBuilder &&
            snapshot?.card_name && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={openTradeBuilder}
                  className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-xs font-black uppercase tracking-wider text-emerald-300 transition hover:border-emerald-400/50 hover:bg-emerald-400/10"
                >
                  📡 Make Trade Offer
                </button>
              </div>
            )}

          <div className="flex items-end gap-2">
            <textarea
              value={body}
              onChange={(event) =>
                setBody(
                  event.target.value
                )
              }
              placeholder="Write a message..."
              maxLength={4000}
              rows={1}
              className="max-h-40 min-h-12 flex-1 resize-y rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400"
            />

            <button
              type="submit"
              disabled={
                !body.trim() ||
                sending
              }
              className="h-12 rounded-2xl bg-emerald-400 px-5 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending
                ? "Sending..."
                : "Send"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
