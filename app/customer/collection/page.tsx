"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

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

type CollectionItem = {
  id: string;
  card_id: string | null;
  snapshot: Record<string, unknown> | null;
  item_type: "raw" | "graded";

  quantity: number;
  condition: string | null;
  grading_company: string | null;
  grade: string | null;
  cert_number: string | null;

  personal_value: number | string | null;
  notes: string | null;
  source: string;

  created_at: string;
  updated_at: string;

  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  image_url: string | null;
  rarity: string | null;
  category: string | null;
  edition: string | null;
  finish: string | null;
};

type CollectionDraft = {
  itemType: "raw" | "graded";
  quantity: number;
  condition: string;
  gradingCompany: string;
  grade: string;
  certNumber: string;
  finishOrParallel: string;
  personalValue: string;
  notes: string;
};

const CATALOGS: CatalogType[] = [
  "Pokemon",
  "Sports",
  "Magic: The Gathering",
  "Yu-Gi-Oh!",
  "Lorcana",
  "One Piece",
];

const CONDITIONS = [
  { value: "", label: "Not specified" },
  { value: "NM", label: "Near Mint" },
  { value: "LP", label: "Lightly Played" },
  { value: "MP", label: "Moderately Played" },
  { value: "HP", label: "Heavily Played" },
  { value: "DMG", label: "Damaged" },
];

const SPORTS_PARALLELS = [
  "Silver",
  "Prizm",
  "Refractor",
  "Chrome Refractor",
  "Optic Holo",
  "X-Fractor",
  "Mojo",
  "Wave",
  "Shimmer",
  "Disco",
  "Pulsar",
  "Scope",
  "Hyper",
  "Ice",
  "Cracked Ice",
  "Sparkle",
  "Velocity",
  "Laser",
  "Choice",
  "Red",
  "Blue",
  "Green",
  "Purple",
  "Pink",
  "Orange",
  "Gold",
  "Black",
  "White",
  "Camo",
  "Zebra",
  "Tiger",
  "Snakeskin",
] as const;

const TCG_FINISHES = [
  "Standard",
  "Non-Holo",
  "Holo",
  "Reverse Holo",
  "Foil",
] as const;

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

function money(
  value: number | string | null | undefined
) {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return "$0.00";
  }

  return numeric.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeText(
  value?: string | null
) {
  return (value || "").trim();
}

function isSportsCard(
  card: CatalogCard
) {
  const haystack = [
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
    haystack.includes(term)
  );
}

function cardSecondaryLine(
  card: CatalogCard
) {
  return [
    card.year,
    card.manufacturer,
    card.release_name || card.set_name,
  ]
    .filter(Boolean)
    .join(" • ");
}

function cardDetailLine(
  card: CatalogCard
) {
  return [
    card.parallel_name || card.finish,
    card.card_number
      ? `#${card.card_number}`
      : null,
    card.rarity,
  ]
    .filter(Boolean)
    .join(" • ");
}

function CollectionCompButtons({
  card,
}: {
  card: CatalogCard;
}) {
  const query = [
    card.name,
    card.year,
    card.manufacturer,
    card.release_name || card.set_name,
    card.card_number
      ? `#${card.card_number}`
      : null,
    card.parallel_name || card.finish,
  ]
    .filter(Boolean)
    .join(" ");

  const encodedQuery =
    encodeURIComponent(query.trim());

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
    <div className="mt-4 overflow-hidden rounded-2xl border border-emerald-400/20 bg-black">
      <div className="border-b border-zinc-900 bg-emerald-400/[0.05] px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
          📡 Market Radar
        </p>

        <p className="mt-1 text-xs text-zinc-600">
          Check comps, then set your personal value.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
        {links.map((market) => (
          <a
            key={market.name}
            href={market.href}
            target="_blank"
            rel="noreferrer"
            title={market.name}
            className="group flex min-h-14 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04]"
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

function itemToCatalogCard(
  item: CollectionItem
): CatalogCard {
  const snapshot =
    item.snapshot || {};

  return {
    external_id:
      String(
        snapshot.external_id ||
          item.card_id ||
          item.id
      ),
    data_source:
      String(
        snapshot.data_source ||
          "MintRadar Collection"
      ),

    name:
      item.card_name ||
      (snapshot.card_name as
        | string
        | null
        | undefined),

    set_name:
      item.set_name ||
      (snapshot.set_name as
        | string
        | null
        | undefined),

    set_id:
      (snapshot.set_id as
        | string
        | null
        | undefined) || null,

    card_number:
      item.card_number ||
      (snapshot.card_number as
        | string
        | null
        | undefined),

    image_url:
      item.image_url ||
      (snapshot.image_url as
        | string
        | null
        | undefined),

    category:
      item.category ||
      (snapshot.category as
        | string
        | null
        | undefined),

    rarity:
      item.rarity ||
      (snapshot.rarity as
        | string
        | null
        | undefined),

    edition:
      item.edition ||
      (snapshot.edition as
        | string
        | null
        | undefined),

    finish:
      item.finish ||
      (snapshot.finish as
        | string
        | null
        | undefined),

    illustrator:
      (snapshot.illustrator as
        | string
        | null
        | undefined) || null,

    year:
      (snapshot.year as
        | string
        | null
        | undefined) || null,

    manufacturer:
      (snapshot.manufacturer as
        | string
        | null
        | undefined) || null,

    release_name:
      (snapshot.release_name as
        | string
        | null
        | undefined) || null,

    parallel_name:
      (snapshot.parallel_name as
        | string
        | null
        | undefined) || null,

    sport:
      (snapshot.sport as
        | string
        | null
        | undefined) || null,

    print_run:
      typeof snapshot.print_run === "number"
        ? snapshot.print_run
        : null,

    rookie:
      typeof snapshot.rookie === "boolean"
        ? snapshot.rookie
        : null,
  };
}

export default function CustomerCollectionPage() {
  const router = useRouter();

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  const [items, setItems] =
    useState<CollectionItem[]>([]);

  const [filter, setFilter] =
    useState("");

  const [typeFilter, setTypeFilter] =
    useState<"all" | "raw" | "graded">("all");

  const [categoryFilter, setCategoryFilter] =
    useState<string>("all");

  const [showAdd, setShowAdd] =
    useState(false);

  const [catalogType, setCatalogType] =
    useState<CatalogType>("Pokemon");

  const [searchTerm, setSearchTerm] =
    useState("");

  const [results, setResults] =
    useState<CatalogCard[]>([]);

  const [searching, setSearching] =
    useState(false);

  const [searchError, setSearchError] =
    useState("");

  const [selectedCard, setSelectedCard] =
    useState<CatalogCard | null>(null);

  const [adding, setAdding] =
    useState(false);

  const [editingId, setEditingId] =
    useState<string | null>(null);

  const [savingId, setSavingId] =
    useState<string | null>(null);

  const [removingId, setRemovingId] =
    useState<string | null>(null);

  const [draft, setDraft] =
    useState<CollectionDraft>({
      itemType: "raw",
      quantity: 1,
      condition: "",
      gradingCompany: "",
      grade: "",
      certNumber: "",
      finishOrParallel: "",
      personalValue: "",
      notes: "",
    });

  const activeItems =
    useMemo(
      () =>
        items.filter(
          (item) =>
            Number(
              item.quantity || 0
            ) > 0
        ),
      [items]
    );

  const archivedCount =
    useMemo(
      () =>
        items.filter(
          (item) =>
            Number(
              item.quantity || 0
            ) <= 0
        ).length,
      [items]
    );

  const collectionValue =
    useMemo(() => {
      return activeItems.reduce(
        (sum, item) =>
          sum +
          Number(
            item.personal_value || 0
          ) *
            Math.max(
              0,
              Number(item.quantity || 0)
            ),
        0
      );
    }, [activeItems]);

  const totalCopies =
    useMemo(() => {
      return activeItems.reduce(
        (sum, item) =>
          sum +
          Math.max(
            0,
            Number(item.quantity || 0)
          ),
        0
      );
    }, [activeItems]);

  const categories = useMemo(() => {
    const values = new Set<string>();

    for (const item of activeItems) {
      if (item.category) {
        values.add(item.category);
      }
    }

    return Array.from(values).sort();
  }, [activeItems]);

  const filteredItems =
    useMemo(() => {
      const query =
        filter.trim().toLowerCase();

      return activeItems.filter(
        (item) => {
          if (
            typeFilter !== "all" &&
            item.item_type !== typeFilter
          ) {
            return false;
          }

          if (
            categoryFilter !== "all" &&
            item.category !== categoryFilter
          ) {
            return false;
          }

          if (!query) {
            return true;
          }

          const haystack = [
            item.card_name,
            item.set_name,
            item.card_number,
            item.rarity,
            item.category,
            item.edition,
            item.finish,
            item.condition,
            item.grading_company,
            item.grade,
            item.cert_number,
            item.notes,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return haystack.includes(
            query
          );
        }
      );
    }, [
      filter,
      activeItems,
      typeFilter,
      categoryFilter,
    ]);

  async function loadCollection() {
    const {
      data,
      error: collectionError,
    } = await supabase.rpc(
      "get_my_collection"
    );

    if (collectionError) {
      throw collectionError;
    }

    setItems(
      (data || []) as CollectionItem[]
    );
  }

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        setLoading(true);
        setError("");

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
            "/customer/login"
          );
          return;
        }

        await loadCollection();
      } catch (err: any) {
        console.error(
          "Collection load error:",
          err
        );

        if (mounted) {
          setError(
            err?.message ||
              "MintRadar could not load your collection."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    boot();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    const query =
      searchTerm.trim();

    if (
      !showAdd ||
      selectedCard ||
      query.length < 2
    ) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }

    const controller =
      new AbortController();

    const timer =
      window.setTimeout(
        async () => {
          try {
            setSearching(true);
            setSearchError("");

            const response =
              await fetch(
                `${catalogEndpoint(
                  catalogType
                )}?q=${encodeURIComponent(
                  query
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
              (data.results ||
                []) as CatalogCard[]
            );
          } catch (
            err: unknown
          ) {
            if (
              err instanceof
                Error &&
              err.name ===
                "AbortError"
            ) {
              return;
            }

            console.error(
              "Collection catalog search error:",
              err
            );

            setResults([]);

            setSearchError(
              err instanceof Error
                ? err.message
                : "Something went wrong while searching."
            );
          } finally {
            if (
              !controller.signal
                .aborted
            ) {
              setSearching(false);
            }
          }
        },
        450
      );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    catalogType,
    searchTerm,
    selectedCard,
    showAdd,
  ]);

  function resetAddForm() {
    setCatalogType("Pokemon");
    setSearchTerm("");
    setResults([]);
    setSearchError("");
    setSelectedCard(null);

    setDraft({
      itemType: "raw",
      quantity: 1,
      condition: "",
      gradingCompany: "",
      grade: "",
      certNumber: "",
      finishOrParallel: "",
      personalValue: "",
      notes: "",
    });
  }

  function openAdd() {
    resetAddForm();
    setError("");
    setSuccess("");
    setShowAdd(true);
  }

  function closeAdd() {
    if (adding) return;

    resetAddForm();
    setShowAdd(false);
  }

  function selectCard(
    card: CatalogCard
  ) {
    setSelectedCard(card);

    setDraft((current) => ({
      ...current,
      finishOrParallel:
        catalogType === "Sports"
          ? card.parallel_name || ""
          : card.finish || "",
    }));

    setResults([]);
    setSearchTerm("");
    setSearchError("");
  }

  async function addToCollection(
    event: FormEvent
  ) {
    event.preventDefault();

    if (
      !selectedCard ||
      adding
    ) {
      return;
    }

    const quantity =
      Math.max(
        1,
        Number(draft.quantity) || 1
      );

    const personalValue =
      draft.personalValue.trim() ===
      ""
        ? null
        : Number(
            draft.personalValue
          );

    if (
      personalValue !== null &&
      (!Number.isFinite(
        personalValue
      ) ||
        personalValue < 0)
    ) {
      setError(
        "Enter a valid personal value."
      );
      return;
    }

    if (
      draft.itemType === "graded" &&
      !draft.gradingCompany
    ) {
      setError(
        "Choose a grading company for the slab."
      );
      return;
    }

    if (
      draft.itemType === "graded" &&
      !draft.grade
    ) {
      setError(
        "Choose a grade for the slab."
      );
      return;
    }

    try {
      setAdding(true);
      setError("");
      setSuccess("");

      const snapshot = {
        card_name:
          selectedCard.name ||
          null,

        set_name:
          selectedCard.set_name ||
          null,

        set_id:
          selectedCard.set_id ||
          null,

        card_number:
          selectedCard.card_number ||
          null,

        image_url:
          selectedCard.image_url ||
          null,

        category:
          selectedCard.category ||
          null,

        rarity:
          selectedCard.rarity ||
          null,

        edition:
          selectedCard.edition ||
          null,

        finish:
          catalogType === "Sports"
            ? selectedCard.finish || null
            : draft.finishOrParallel || selectedCard.finish || null,

        illustrator:
          selectedCard.illustrator ||
          null,

        year:
          selectedCard.year ||
          null,

        manufacturer:
          selectedCard.manufacturer ||
          null,

        release_name:
          selectedCard.release_name ||
          null,

        parallel_name:
          catalogType === "Sports"
            ? draft.finishOrParallel || selectedCard.parallel_name || null
            : selectedCard.parallel_name || null,

        sport:
          selectedCard.sport ||
          null,

        print_run:
          selectedCard.print_run ??
          null,

        rookie:
          selectedCard.rookie ??
          null,

        external_id:
          selectedCard.external_id,

        data_source:
          selectedCard.data_source,
      };

      const {
        error: addError,
      } = await supabase.rpc(
        "add_collection_item",
        {
          p_card_id: null,
          p_snapshot:
            snapshot,
          p_item_type:
            draft.itemType,
          p_quantity:
            quantity,
          p_condition:
            normalizeText(
              draft.condition
            ) || null,
          p_grading_company:
            normalizeText(
              draft.gradingCompany
            ) || null,
          p_grade:
            normalizeText(
              draft.grade
            ) || null,
          p_cert_number:
            normalizeText(
              draft.certNumber
            ) || null,
          p_personal_value:
            personalValue,
          p_notes:
            normalizeText(
              draft.notes
            ) || null,
          p_source:
            "catalog",
        }
      );

      if (addError) {
        throw addError;
      }

      await loadCollection();

      setSuccess(
        `${selectedCard.name || "Card"} added to your collection.`
      );

      resetAddForm();
      setShowAdd(false);
    } catch (err: any) {
      console.error(
        "Add collection item error:",
        err
      );

      setError(
        err?.message ||
          "MintRadar could not add that card."
      );
    } finally {
      setAdding(false);
    }
  }

  function startEditing(
    item: CollectionItem
  ) {
    setEditingId(item.id);

    setDraft({
      itemType:
        item.item_type || "raw",
      quantity:
        Math.max(
          0,
          Number(item.quantity || 0)
        ),
      condition:
        item.condition || "",
      gradingCompany:
        item.grading_company ||
        "",
      grade:
        item.grade || "",
      certNumber:
        item.cert_number || "",
      finishOrParallel:
        item.finish || "",
      personalValue:
        item.personal_value != null
          ? String(
              item.personal_value
            )
          : "",
      notes:
        item.notes || "",
    });

    setError("");
    setSuccess("");
  }

  function cancelEditing() {
    setEditingId(null);
  }

  async function saveItem(
    item: CollectionItem
  ) {
    if (
      savingId ||
      editingId !== item.id
    ) {
      return;
    }

    const quantity =
      Math.max(
        0,
        Number(draft.quantity) || 0
      );

    const personalValue =
      draft.personalValue.trim() ===
      ""
        ? null
        : Number(
            draft.personalValue
          );

    if (
      personalValue !== null &&
      (!Number.isFinite(
        personalValue
      ) ||
        personalValue < 0)
    ) {
      setError(
        "Enter a valid personal value."
      );
      return;
    }

    try {
      setSavingId(item.id);
      setError("");
      setSuccess("");

      const {
        error: updateError,
      } = await supabase.rpc(
        "update_collection_item",
        {
          p_collection_item_id:
            item.id,
          p_item_type:
            draft.itemType,
          p_quantity:
            quantity,
          p_condition:
            normalizeText(
              draft.condition
            ) || null,
          p_grading_company:
            normalizeText(
              draft.gradingCompany
            ) || null,
          p_grade:
            normalizeText(
              draft.grade
            ) || null,
          p_cert_number:
            normalizeText(
              draft.certNumber
            ) || null,
          p_personal_value:
            personalValue,
          p_notes:
            normalizeText(
              draft.notes
            ) || null,
        }
      );

      if (updateError) {
        throw updateError;
      }

      await loadCollection();

      setEditingId(null);

      setSuccess(
        "Collection item updated."
      );
    } catch (err: any) {
      console.error(
        "Update collection item error:",
        err
      );

      setError(
        err?.message ||
          "MintRadar could not update that card."
      );
    } finally {
      setSavingId(null);
    }
  }

  async function removeItem(
    item: CollectionItem
  ) {
    if (removingId) {
      return;
    }

    const confirmed =
      window.confirm(
        `Remove ${
          item.card_name ||
          "this card"
        } from your collection?`
      );

    if (!confirmed) {
      return;
    }

    try {
      setRemovingId(item.id);
      setError("");
      setSuccess("");

      const {
        error: removeError,
      } = await supabase.rpc(
        "remove_collection_item",
        {
          p_collection_item_id:
            item.id,
        }
      );

      if (removeError) {
        throw removeError;
      }

      setItems((current) =>
        current.filter(
          (row) =>
            row.id !== item.id
        )
      );

      if (
        editingId === item.id
      ) {
        setEditingId(null);
      }

      setSuccess(
        "Card removed from your collection."
      );
    } catch (err: any) {
      console.error(
        "Remove collection item error:",
        err
      );

      setError(
        err?.message ||
          "MintRadar could not remove that card."
      );
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 pb-16 pt-20 text-white sm:px-5 sm:pt-24">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
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
                className="h-auto w-[210px] sm:w-[260px]"
              />
            </Link>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/customer/collection"
                className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black"
              >
                My Collection
              </Link>

              <Link
                href="/messages"
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-black text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
              >
                Messages
              </Link>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                Personal Collection
              </p>

              <h1 className="mt-2 text-4xl font-black sm:text-5xl">
                My Collection
              </h1>

              <p className="mt-3 max-w-2xl text-zinc-500">
                Track what you own, check comps, set your own values, and use collection cards in MintRadar trades.
              </p>
            </div>

            <button
              type="button"
              onClick={openAdd}
              className="w-fit rounded-xl bg-emerald-400 px-5 py-3 font-black text-black transition hover:bg-emerald-300"
            >
              + Add Card
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-red-300">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-5 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-emerald-300">
            {success}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
              Unique Entries
            </p>

            <p className="mt-2 text-3xl font-black">
              {activeItems.length}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
              Total Cards
            </p>

            <p className="mt-2 text-3xl font-black">
              {totalCopies}
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-zinc-950 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
              Personal Value
            </p>

            <p className="mt-2 text-3xl font-black text-emerald-400">
              {money(
                collectionValue
              )}
            </p>
          </div>
        </section>

        {archivedCount > 0 && (
          <div className="mt-3 text-right">
            <span className="text-xs font-bold text-zinc-700">
              {archivedCount} traded-away / zero-quantity{" "}
              {archivedCount === 1 ? "entry" : "entries"} preserved for history
            </span>
          </div>
        )}

        {showAdd && (
          <section className="mt-6 overflow-hidden rounded-3xl border border-emerald-400/20 bg-zinc-950">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-900 bg-emerald-400/[0.04] p-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                  Add to Collection
                </p>

                <h2 className="mt-2 text-2xl font-black">
                  Find the exact card.
                </h2>
              </div>

              <button
                type="button"
                onClick={closeAdd}
                disabled={adding}
                className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm font-black text-zinc-500 transition hover:text-white disabled:opacity-40"
              >
                Close
              </button>
            </div>

            <form
              onSubmit={
                addToCollection
              }
              className="p-5"
            >
              {!selectedCard ? (
                <>
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                      What are you adding?
                    </p>

                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            itemType: "raw",
                            gradingCompany: "",
                            grade: "",
                            certNumber: "",
                          }))
                        }
                        className={`rounded-2xl border p-4 text-left transition ${
                          draft.itemType === "raw"
                            ? "border-emerald-400 bg-emerald-400/10"
                            : "border-zinc-800 bg-black"
                        }`}
                      >
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-400">
                          Single
                        </p>
                        <p className="mt-1 text-lg font-black">
                          Raw Card
                        </p>
                        <p className="mt-1 text-xs text-zinc-600">
                          Ungraded card with condition and finish/parallel.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            itemType: "graded",
                            condition: "",
                          }))
                        }
                        className={`rounded-2xl border p-4 text-left transition ${
                          draft.itemType === "graded"
                            ? "border-emerald-400 bg-emerald-400/10"
                            : "border-zinc-800 bg-black"
                        }`}
                      >
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-400">
                          Slab
                        </p>
                        <p className="mt-1 text-lg font-black">
                          Graded Card
                        </p>
                        <p className="mt-1 text-xs text-zinc-600">
                          PSA, BGS, CGC and other graded cards.
                        </p>
                      </button>
                    </div>
                  </div>

                  <div className="mt-5">
                    <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                      Catalog
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {CATALOGS.map(
                        (catalog) => (
                          <button
                            key={
                              catalog
                            }
                            type="button"
                            onClick={() => {
                              setCatalogType(
                                catalog
                              );
                              setSearchTerm(
                                ""
                              );
                              setResults(
                                []
                              );
                              setSearchError(
                                ""
                              );
                            }}
                            className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
                              catalogType ===
                              catalog
                                ? "border-emerald-400 bg-emerald-400 text-black"
                                : "border-zinc-800 bg-black text-zinc-500 hover:border-emerald-400/40 hover:text-emerald-300"
                            }`}
                          >
                            {
                              catalog
                            }
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                      Search MintRadar
                    </label>

                    <input
                      type="search"
                      value={
                        searchTerm
                      }
                      onChange={(
                        event
                      ) =>
                        setSearchTerm(
                          event.target
                            .value
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
                        {
                          searchError
                        }
                      </p>
                    )}

                    {!searching &&
                      searchTerm
                        .trim()
                        .length >=
                        2 &&
                      !searchError &&
                      results.length ===
                        0 && (
                        <p className="mt-3 text-sm text-zinc-600">
                          No matching cards found.
                        </p>
                      )}

                    {results.length >
                      0 && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {results.map(
                          (card) => (
                            <button
                              key={`${card.data_source}-${card.external_id}`}
                              type="button"
                              onClick={() =>
                                selectCard(
                                  card
                                )
                              }
                              className="flex gap-3 rounded-2xl border border-zinc-900 bg-black p-3 text-left transition hover:border-emerald-400/40"
                            >
                              <div className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950">
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

                              <div className="min-w-0">
                                <p className="truncate font-black">
                                  {card.name ||
                                    "Unknown Card"}
                                </p>

                                {cardSecondaryLine(
                                  card
                                ) && (
                                  <p className="mt-1 text-xs text-zinc-500">
                                    {cardSecondaryLine(
                                      card
                                    )}
                                  </p>
                                )}

                                {cardDetailLine(
                                  card
                                ) && (
                                  <p className="mt-1 text-xs font-bold text-emerald-400/80">
                                    {cardDetailLine(
                                      card
                                    )}
                                  </p>
                                )}
                              </div>
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-2xl border border-emerald-400/20 bg-black p-4">
                    <div className="flex gap-4">
                      <div className="flex h-36 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-900 bg-zinc-950">
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
                          <div>
                            <p className="text-xl font-black">
                              {selectedCard.name ||
                                "Unknown Card"}
                            </p>

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
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setSelectedCard(
                                null
                              )
                            }
                            className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-black text-zinc-400 transition hover:border-emerald-400/40 hover:text-emerald-300"
                          >
                            Change Card
                          </button>
                        </div>

                        <CollectionCompButtons
                          card={
                            selectedCard
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                        Quantity
                      </label>

                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={draft.quantity}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            quantity: Math.max(
                              1,
                              Number(event.target.value) || 1
                            ),
                          }))
                        }
                        className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-3 py-3 font-black outline-none focus:border-emerald-400/50"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                        Personal Value
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
                          value={draft.personalValue}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              personalValue:
                                event.target.value,
                            }))
                          }
                          placeholder="0.00"
                          className="min-w-0 flex-1 bg-transparent px-2 py-3 font-black outline-none placeholder:text-zinc-800"
                        />
                      </div>
                    </div>

                    {draft.itemType === "raw" ? (
                      <>
                        <div>
                          <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                            Condition
                          </label>

                          <select
                            value={draft.condition}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                condition:
                                  event.target.value,
                              }))
                            }
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-3 py-3 font-bold outline-none focus:border-emerald-400/50"
                          >
                            {CONDITIONS.map(
                              (condition) => (
                                <option
                                  key={condition.value}
                                  value={condition.value}
                                >
                                  {condition.label}
                                </option>
                              )
                            )}
                          </select>
                        </div>

                        <div>
                          <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                            {catalogType === "Sports"
                              ? "Parallel"
                              : "Finish"}
                          </label>

                          <select
                            value={draft.finishOrParallel}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                finishOrParallel:
                                  event.target.value,
                              }))
                            }
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-3 py-3 font-bold outline-none focus:border-emerald-400/50"
                          >
                            {catalogType === "Sports" ? (
                              <>
                                <option value="">
                                  Standard / Unknown
                                </option>

                                {selectedCard?.parallel_name &&
                                  !SPORTS_PARALLELS.includes(
                                    selectedCard.parallel_name as
                                      (typeof SPORTS_PARALLELS)[number]
                                  ) && (
                                    <option
                                      value={
                                        selectedCard.parallel_name
                                      }
                                    >
                                      {selectedCard.parallel_name}
                                    </option>
                                  )}

                                {SPORTS_PARALLELS.map(
                                  (parallel) => (
                                    <option
                                      key={parallel}
                                      value={parallel}
                                    >
                                      {parallel}
                                    </option>
                                  )
                                )}
                              </>
                            ) : (
                              <>
                                {TCG_FINISHES.map(
                                  (finish) => (
                                    <option
                                      key={finish}
                                      value={
                                        finish === "Standard"
                                          ? ""
                                          : finish
                                      }
                                    >
                                      {finish}
                                    </option>
                                  )
                                )}
                              </>
                            )}
                          </select>

                          {catalogType === "Sports" &&
                            selectedCard?.parallel_name && (
                              <p className="mt-2 text-xs text-emerald-400">
                                Catalog parallel:{" "}
                                {selectedCard.parallel_name}
                              </p>
                            )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                            Grading Company
                          </label>

                          <select
                            value={draft.gradingCompany}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                gradingCompany:
                                  event.target.value,
                              }))
                            }
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-3 py-3 font-bold outline-none focus:border-emerald-400/50"
                          >
                            <option value="">
                              Choose company
                            </option>
                            <option value="PSA">PSA</option>
                            <option value="BGS">BGS</option>
                            <option value="CGC">CGC</option>
                            <option value="SGC">SGC</option>
                            <option value="TAG">TAG</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                            Grade
                          </label>

                          <select
                            value={draft.grade}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                grade:
                                  event.target.value,
                              }))
                            }
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-3 py-3 font-bold outline-none focus:border-emerald-400/50"
                          >
                            <option value="">
                              Choose grade
                            </option>
                            {[
                              "10",
                              "9.5",
                              "9",
                              "8.5",
                              "8",
                              "7.5",
                              "7",
                              "6.5",
                              "6",
                              "5",
                              "4",
                              "3",
                              "2",
                              "1",
                            ].map((grade) => (
                              <option
                                key={grade}
                                value={grade}
                              >
                                {grade}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                            Cert Number
                            <span className="ml-2 text-zinc-800">
                              optional
                            </span>
                          </label>

                          <input
                            type="text"
                            value={draft.certNumber}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                certNumber:
                                  event.target.value,
                              }))
                            }
                            placeholder="Certificate number"
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-3 py-3 font-bold outline-none placeholder:text-zinc-800 focus:border-emerald-400/50"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mt-4">
                    <label className="text-xs font-black uppercase tracking-wider text-zinc-600">
                      Notes
                    </label>

                    <textarea
                      value={
                        draft.notes
                      }
                      onChange={(
                        event
                      ) =>
                        setDraft(
                          (
                            current
                          ) => ({
                            ...current,
                            notes:
                              event
                                .target
                                .value,
                          })
                        )
                      }
                      rows={2}
                      placeholder="Optional personal notes..."
                      className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-black px-3 py-3 text-sm outline-none placeholder:text-zinc-800 focus:border-emerald-400/50"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={adding}
                    className="mt-5 w-full rounded-xl bg-emerald-400 px-5 py-4 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {adding
                      ? "Adding..."
                      : "Add to My Collection"}
                  </button>
                </>
              )}
            </form>
          </section>
        )}

        <section className="mt-7">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
                Collection
              </p>

              <h2 className="mt-1 text-2xl font-black">
                Your Cards
              </h2>

              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  ["all", "All"],
                  ["raw", "Raw"],
                  ["graded", "Slabs"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setTypeFilter(
                        value as "all" | "raw" | "graded"
                      )
                    }
                    className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
                      typeFilter === value
                        ? "border-emerald-400 bg-emerald-400 text-black"
                        : "border-zinc-800 bg-zinc-950 text-zinc-500"
                    }`}
                  >
                    {label}
                  </button>
                ))}

                <select
                  value={categoryFilter}
                  onChange={(event) =>
                    setCategoryFilter(
                      event.target.value
                    )
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-black text-zinc-400 outline-none focus:border-emerald-400/50"
                >
                  <option value="all">
                    All Categories
                  </option>

                  {categories.map(
                    (category) => (
                      <option
                        key={category}
                        value={category}
                      >
                        {category}
                      </option>
                    )
                  )}
                </select>
              </div>
            </div>

            <input
              type="search"
              value={filter}
              onChange={(event) =>
                setFilter(
                  event.target.value
                )
              }
              placeholder="Search your collection..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-bold outline-none placeholder:text-zinc-700 focus:border-emerald-400/50 sm:max-w-sm"
            />
          </div>

          {loading ? (
            <div className="mt-5 rounded-3xl border border-zinc-900 bg-zinc-950 p-10 text-center text-zinc-500">
              Loading your collection...
            </div>
          ) : filteredItems.length ===
            0 ? (
            <div className="mt-5 rounded-3xl border border-zinc-900 bg-zinc-950 p-10 text-center">
              <p className="text-2xl font-black">
                {activeItems.length === 0
                  ? "Your collection is ready."
                  : "No cards match that search."}
              </p>

              <p className="mx-auto mt-2 max-w-lg text-zinc-500">
                {activeItems.length === 0
                  ? "Add your first card from the MintRadar catalog. Traded-away cards stay preserved for future history."
                  : "Try another card name, set, number, condition, or grade."}
              </p>

              {activeItems.length ===
                0 && (
                <button
                  type="button"
                  onClick={openAdd}
                  className="mt-6 rounded-xl bg-emerald-400 px-5 py-3 font-black text-black transition hover:bg-emerald-300"
                >
                  + Add First Card
                </button>
              )}
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map(
                (item) => {
                  const editing =
                    editingId ===
                    item.id;

                  const card =
                    itemToCatalogCard(
                      item
                    );

                  return (
                    <article
                      key={item.id}
                      className="overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950"
                    >
                      <div className="flex gap-4 p-4">
                        <div className="flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-900 bg-black">
                          {item.image_url ? (
                            <img
                              src={
                                item.image_url
                              }
                              alt={
                                item.card_name ||
                                "Collection card"
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
                          <p className="truncate text-lg font-black">
                            {item.card_name ||
                              "Unknown Card"}
                          </p>

                          <p className="mt-1 text-xs text-zinc-500">
                            {[
                              item.set_name,
                              item.card_number
                                ? `#${item.card_number}`
                                : null,
                              item.finish,
                            ]
                              .filter(
                                Boolean
                              )
                              .join(
                                " • "
                              )}
                          </p>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                              {item.item_type === "graded"
                                ? "Slab"
                                : "Raw"}
                            </span>

                            {item.condition && (
                              <span className="rounded-full border border-zinc-800 bg-black px-2 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                                {
                                  item.condition
                                }
                              </span>
                            )}

                            {(item.grading_company ||
                              item.grade) && (
                              <span className="rounded-full border border-zinc-800 bg-black px-2 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                                {[
                                  item.grading_company,
                                  item.grade,
                                ]
                                  .filter(
                                    Boolean
                                  )
                                  .join(
                                    " "
                                  )}
                              </span>
                            )}

                            <span className="rounded-full border border-zinc-800 bg-black px-2 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                              Qty{" "}
                              {
                                item.quantity
                              }
                            </span>
                          </div>

                          <p className="mt-3 text-xs font-black uppercase tracking-wider text-zinc-700">
                            Personal Value
                          </p>

                          <p className="mt-1 text-xl font-black text-emerald-400">
                            {item.personal_value !=
                            null
                              ? money(
                                  item.personal_value
                                )
                              : "Not set"}
                          </p>
                        </div>
                      </div>

                      <div className="border-t border-zinc-900 px-4 pb-4">
                        <CollectionCompButtons
                          card={card}
                        />

                        {!editing ? (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                startEditing(
                                  item
                                )
                              }
                              className="rounded-xl border border-zinc-800 bg-black px-3 py-2.5 text-sm font-black text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-300"
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              disabled={
                                removingId ===
                                item.id
                              }
                              onClick={() =>
                                removeItem(
                                  item
                                )
                              }
                              className="rounded-xl border border-red-400/20 bg-red-400/[0.04] px-3 py-2.5 text-sm font-black text-red-300 transition hover:border-red-400/40 hover:bg-red-400/[0.08] disabled:opacity-40"
                            >
                              {removingId ===
                              item.id
                                ? "Removing..."
                                : "Remove"}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-black p-4">
                            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-400">
                              Edit Collection Item
                            </p>

                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <select
                                value={draft.itemType}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    itemType:
                                      event.target.value as
                                        | "raw"
                                        | "graded",
                                  }))
                                }
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400/50"
                              >
                                <option value="raw">
                                  Raw Card
                                </option>
                                <option value="graded">
                                  Slab
                                </option>
                              </select>

                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={
                                  draft.quantity
                                }
                                onChange={(
                                  event
                                ) =>
                                  setDraft(
                                    (
                                      current
                                    ) => ({
                                      ...current,
                                      quantity:
                                        Math.max(
                                          0,
                                          Number(
                                            event
                                              .target
                                              .value
                                          ) ||
                                            0
                                        ),
                                    })
                                  )
                                }
                                placeholder="Quantity"
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400/50"
                              />

                              <select
                                value={
                                  draft.condition
                                }
                                onChange={(
                                  event
                                ) =>
                                  setDraft(
                                    (
                                      current
                                    ) => ({
                                      ...current,
                                      condition:
                                        event
                                          .target
                                          .value,
                                    })
                                  )
                                }
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400/50"
                              >
                                {CONDITIONS.map(
                                  (
                                    condition
                                  ) => (
                                    <option
                                      key={
                                        condition.value
                                      }
                                      value={
                                        condition.value
                                      }
                                    >
                                      {
                                        condition.label
                                      }
                                    </option>
                                  )
                                )}
                              </select>

                              <input
                                type="text"
                                value={
                                  draft.gradingCompany
                                }
                                onChange={(
                                  event
                                ) =>
                                  setDraft(
                                    (
                                      current
                                    ) => ({
                                      ...current,
                                      gradingCompany:
                                        event
                                          .target
                                          .value,
                                    })
                                  )
                                }
                                placeholder="Grading company"
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400/50"
                              />

                              <input
                                type="text"
                                value={
                                  draft.grade
                                }
                                onChange={(
                                  event
                                ) =>
                                  setDraft(
                                    (
                                      current
                                    ) => ({
                                      ...current,
                                      grade:
                                        event
                                          .target
                                          .value,
                                    })
                                  )
                                }
                                placeholder="Grade"
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400/50"
                              />

                              <input
                                type="text"
                                value={
                                  draft.certNumber
                                }
                                onChange={(
                                  event
                                ) =>
                                  setDraft(
                                    (
                                      current
                                    ) => ({
                                      ...current,
                                      certNumber:
                                        event
                                          .target
                                          .value,
                                    })
                                  )
                                }
                                placeholder="Cert number"
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-bold outline-none focus:border-emerald-400/50"
                              />

                              <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-950 focus-within:border-emerald-400/50">
                                <span className="pl-3 text-sm font-black text-zinc-600">
                                  $
                                </span>

                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={
                                    draft.personalValue
                                  }
                                  onChange={(
                                    event
                                  ) =>
                                    setDraft(
                                      (
                                        current
                                      ) => ({
                                        ...current,
                                        personalValue:
                                          event
                                            .target
                                            .value,
                                      })
                                    )
                                  }
                                  placeholder="Personal value"
                                  className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm font-black outline-none"
                                />
                              </div>
                            </div>

                            <textarea
                              value={
                                draft.notes
                              }
                              onChange={(
                                event
                              ) =>
                                setDraft(
                                  (
                                    current
                                  ) => ({
                                    ...current,
                                    notes:
                                      event
                                        .target
                                        .value,
                                  })
                                )
                              }
                              rows={2}
                              placeholder="Notes"
                              className="mt-3 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-400/50"
                            />

                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={
                                  cancelEditing
                                }
                                className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-black text-zinc-500 transition hover:text-white"
                              >
                                Cancel
                              </button>

                              <button
                                type="button"
                                disabled={
                                  savingId ===
                                  item.id
                                }
                                onClick={() =>
                                  saveItem(
                                    item
                                  )
                                }
                                className="rounded-xl bg-emerald-400 px-3 py-2.5 text-sm font-black text-black transition hover:bg-emerald-300 disabled:opacity-40"
                              >
                                {savingId ===
                                item.id
                                  ? "Saving..."
                                  : "Save"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
