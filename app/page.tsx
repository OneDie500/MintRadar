"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type InventoryListing = {
  id: string;
  listing_type?: string | null;
  condition?: string | null;
  grading_company?: string | null;
  grade?: string | null;
  cert_number?: string | null;
  price?: number | null;
  quantity?: number | null;
};

type Card = {
  id: string;
  event_id?: string | null;
  name?: string | null;
  set_name?: string | null;
  card_number?: string | null;
  image_url?: string | null;
  category?: string | null;
  rarity?: string | null;
  edition?: string | null;
  finish?: string | null;
  inventory?: InventoryListing[];
};

type CatalogOption = {
  value: string;
  label: string;
  shortLabel?: string;
};

type CatalogCard = {
  external_id: string;
  data_source: string;
  name: string;
  set_name?: string | null;
  card_number?: string | null;
  image_url?: string | null;
  category?: string | null;
  rarity?: string | null;
  edition?: string | null;
  finish?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  release_name?: string | null;
  parallel_name?: string | null;
  sport?: string | null;
  print_run?: number | null;
  rookie?: boolean | null;
};

const CATALOGS: CatalogOption[] = [
  {
    value: "All",
    label: "All",
  },
  {
    value: "Pokemon",
    label: "Pokémon",
  },
  {
    value: "Sports",
    label: "Sports",
  },
  {
    value: "One Piece",
    label: "One Piece",
  },
  {
    value: "Magic: The Gathering",
    label: "Magic: The Gathering",
    shortLabel: "MTG",
  },
  {
    value: "Yu-Gi-Oh!",
    label: "Yu-Gi-Oh!",
  },
  {
    value: "Lorcana",
    label: "Lorcana",
  },
  {
    value: "Other",
    label: "Other",
  },
];

export default function Home() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] =
    useState("All");
  const [catalogResults, setCatalogResults] = useState<CatalogCard[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [wishlistBusy, setWishlistBusy] = useState<string | null>(null);
  const [wishlistMessage, setWishlistMessage] = useState("");

  // -----------------------------------------
  // LOAD CARDS + LIVE LISTINGS
  // -----------------------------------------

  useEffect(() => {
    async function fetchCards() {
      setLoading(true);

      const { data, error } = await supabase
        .from("cards")
        .select(`
          id,
          event_id,
          name,
          set_name,
          card_number,
          image_url,
          category,
          rarity,
          edition,
          finish,
          inventory (
            id,
            listing_type,
            condition,
            grading_company,
            grade,
            cert_number,
            price,
            quantity
          )
        `);

      if (error) {
        console.error(
          "Supabase error:",
          error.message,
          error.details,
          error.hint,
          error.code
        );
      }

      if (data) {
        const typedCards = data as unknown as Card[];

        const availableCards = typedCards.filter((card) =>
          card.inventory?.some(
            (listing) => (listing.quantity ?? 0) > 0
          )
        );

        setCards(availableCards);
      }

      setLoading(false);
    }

    fetchCards();
  }, []);

  // -----------------------------------------
  // CUSTOMER WISHLIST STATE
  // -----------------------------------------

  useEffect(() => {
    async function loadWishlist() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setWishlistIds(new Set());
        return;
      }

      const { data } = await supabase
        .from("wishlists")
        .select(`
          card_id,
          cards (
            external_id,
            data_source
          )
        `)
        .eq("user_id", user.id);

      const keys = new Set<string>();

      (data || []).forEach((row: any) => {
        const card = Array.isArray(row.cards)
          ? row.cards[0]
          : row.cards;

        if (card?.external_id && card?.data_source) {
          keys.add(`${card.data_source}:${card.external_id}`);
        }
      });

      setWishlistIds(keys);
    }

    loadWishlist();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadWishlist();
    });

    return () => subscription.unsubscribe();
  }, []);

  // -----------------------------------------
  // UNIVERSAL CATALOG SEARCH
  // -----------------------------------------

  useEffect(() => {
    const query = searchTerm.trim();

    if (query.length < 2) {
      setCatalogResults([]);
      setCatalogError("");
      setCatalogLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setCatalogLoading(true);
      setCatalogError("");

      try {
        const routes: Record<string, string> = {
          Pokemon: "/api/catalog/search",
          Sports: "/api/catalog/sports",
          "One Piece": "/api/catalog/onepiece",
          "Magic: The Gathering": "/api/catalog/mtg",
          "Yu-Gi-Oh!": "/api/catalog/yugioh",
          Lorcana: "/api/catalog/lorcana",
        };

        const selectedRoutes =
          activeCategory === "All"
            ? Object.values(routes)
            : routes[activeCategory]
            ? [routes[activeCategory]]
            : [];

        if (selectedRoutes.length === 0) {
          setCatalogResults([]);
          setCatalogLoading(false);
          return;
        }

        const responses = await Promise.allSettled(
          selectedRoutes.map(async (route) => {
            const response = await fetch(
              `${route}?q=${encodeURIComponent(query)}`
            );

            if (!response.ok) {
              throw new Error(`Catalog search failed: ${route}`);
            }

            const payload = await response.json();
            return Array.isArray(payload?.results)
              ? payload.results
              : [];
          })
        );

        const merged = responses.flatMap((response) =>
          response.status === "fulfilled"
            ? response.value
            : []
        );

        const unique = new Map<string, CatalogCard>();

        merged.forEach((card: any) => {
          const externalId =
            card.external_id ??
            card.externalId ??
            card.id;

          const dataSource =
            card.data_source ??
            card.dataSource ??
            "";

          if (!externalId || !dataSource) {
            return;
          }

          const normalized: CatalogCard = {
            external_id: String(externalId),
            data_source: String(dataSource),
            name: card.name || "Unknown Collectible",
            set_name: card.set_name ?? card.setName ?? null,
            card_number: card.card_number ?? card.cardNumber ?? null,
            image_url: card.image_url ?? card.imageUrl ?? null,
            category: card.category ?? null,
            rarity: card.rarity ?? null,
            edition: card.edition ?? null,
            finish: card.finish ?? null,
            year: card.year ?? null,
            manufacturer: card.manufacturer ?? null,
            release_name: card.release_name ?? card.releaseName ?? null,
            parallel_name: card.parallel_name ?? card.parallelName ?? null,
            sport: card.sport ?? null,
            print_run: card.print_run ?? card.printRun ?? null,
            rookie:
              typeof card.rookie === "boolean"
                ? card.rookie
                : null,
          };

          unique.set(
            `${normalized.data_source}:${normalized.external_id}`,
            normalized
          );
        });

        setCatalogResults(Array.from(unique.values()).slice(0, 60));

        if (
          responses.every(
            (response) => response.status === "rejected"
          )
        ) {
          setCatalogError(
            "Catalog search is temporarily unavailable."
          );
        }
      } catch (error) {
        console.error("Universal catalog search error:", error);
        setCatalogResults([]);
        setCatalogError(
          "Catalog search is temporarily unavailable."
        );
      } finally {
        setCatalogLoading(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchTerm, activeCategory]);

  async function addToWishlist(card: CatalogCard) {
    const key = `${card.data_source}:${card.external_id}`;
    setWishlistBusy(key);
    setWishlistMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setWishlistBusy(null);
      setWishlistMessage(
        "Sign in to save cards to your wishlist."
      );
      return;
    }

    const { error } = await supabase.rpc(
      "wishlist_catalog_card",
      {
        p_external_id: card.external_id,
        p_data_source: card.data_source,
        p_name: card.name,
        p_set_name: card.set_name ?? null,
        p_card_number: card.card_number ?? null,
        p_image_url: card.image_url ?? null,
        p_category: card.category ?? null,
        p_rarity: card.rarity ?? null,
        p_edition: card.edition ?? null,
        p_finish: card.finish ?? null,
        p_year: card.year ?? null,
        p_manufacturer: card.manufacturer ?? null,
        p_release_name: card.release_name ?? null,
        p_parallel_name: card.parallel_name ?? null,
        p_sport: card.sport ?? null,
        p_print_run: card.print_run ?? null,
        p_rookie: card.rookie ?? null,
      }
    );

    setWishlistBusy(null);

    if (error) {
      console.error("Wishlist error:", error);
      setWishlistMessage(error.message);
      return;
    }

    setWishlistIds((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });

    setWishlistMessage(
      `${card.name} was added to your wishlist.`
    );
  }

  // -----------------------------------------
  // CATEGORY COUNTS
  // -----------------------------------------

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      All: cards.length,
    };

    cards.forEach((card) => {
      const category = card.category || "Other";

      counts[category] =
        (counts[category] || 0) + 1;
    });

    return counts;
  }, [cards]);

  // -----------------------------------------
  // SEARCH / FILTER
  // -----------------------------------------

  const filteredCards = useMemo(() => {
    const search = searchTerm
      .trim()
      .toLowerCase();

    return cards.filter((card) => {
      const cardCategory =
        card.category || "Other";

      const matchesCategory =
        activeCategory === "All" ||
        cardCategory.toLowerCase() ===
          activeCategory.toLowerCase();

      if (!matchesCategory) {
        return false;
      }

      if (!search) {
        return true;
      }

      const searchableCardText = [
        card.name,
        card.set_name,
        card.card_number,
        card.category,
        card.rarity,
        card.edition,
        card.finish,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const searchableListingText =
        (card.inventory || [])
          .map((listing) =>
            [
              listing.listing_type,
              listing.condition,
              listing.grading_company,
              listing.grade,
              listing.cert_number,
            ]
              .filter(Boolean)
              .join(" ")
          )
          .join(" ")
          .toLowerCase();

      return (
        searchableCardText.includes(search) ||
        searchableListingText.includes(search)
      );
    });
  }, [cards, searchTerm, activeCategory]);

  // -----------------------------------------
  // TOTAL LIVE LISTINGS
  // -----------------------------------------

  const totalListings = useMemo(() => {
    return cards.reduce(
      (total, card) =>
        total +
        (card.inventory?.filter(
          (listing) =>
            (listing.quantity ?? 0) > 0
        ).length || 0),
      0
    );
  }, [cards]);

  // -----------------------------------------
  // ACTIVE CATALOG
  // -----------------------------------------

  const activeCatalog =
    CATALOGS.find(
      (catalog) =>
        catalog.value === activeCategory
    ) || CATALOGS[0];

  // -----------------------------------------
  // LOADING
  // -----------------------------------------

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <Image
            src="/mintradar-logo.png"
            alt="MintRadar by OnlySlabs"
            width={900}
            height={450}
            priority
            className="w-[320px] sm:w-[460px] h-auto mx-auto"
          />

          <p className="text-zinc-500 mt-5">
            Loading inventory...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">

      {/* HEADER */}

      <header className="border-b border-zinc-900 bg-black">
        <div className="max-w-7xl mx-auto px-5 py-6 flex items-center justify-center">
          <Image
            src="/mintradar-logo.png"
            alt="MintRadar by OnlySlabs"
            width={1200}
            height={600}
            priority
            className="w-[320px] sm:w-[500px] md:w-[620px] h-auto"
          />
        </div>
      </header>

      {/* HERO */}

      <section className="border-b border-zinc-900">
        <div className="max-w-5xl mx-auto px-5 pt-10 pb-14 sm:pt-14 sm:pb-20 text-center">

          <p className="text-sm uppercase tracking-[0.25em] text-emerald-400 font-bold mb-4">
            Live Collectible Inventory
          </p>

          <h2 className="text-4xl sm:text-6xl font-black tracking-tight leading-tight">
            Find the card

            <span className="block text-zinc-500">
              before you reach the table.
            </span>
          </h2>

          <p className="text-zinc-400 max-w-2xl mx-auto mt-5 text-base sm:text-lg">
            Search live vendor inventory across
            Pokémon, sports, TCGs and more.
            Instantly see raw and graded copies
            available.
          </p>

          {/* SEARCH */}

          <div className="mt-9 max-w-3xl mx-auto">
            <div className="relative">
              <input
                type="text"
                placeholder="Search Umbreon, Wemby, PSA 10, Shadowless, NM..."
                value={searchTerm}
                onChange={(event) =>
                  setSearchTerm(event.target.value)
                }
                className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-5 py-5 pr-14 text-lg text-white placeholder:text-zinc-600 outline-none focus:border-emerald-400 transition"
              />

              <div className="absolute right-5 top-1/2 -translate-y-1/2 text-emerald-400 text-2xl">
                ⌕
              </div>
            </div>

            <p className="text-xs text-zinc-600 mt-3">
              Search player, card, set, number,
              rarity, edition, condition or grade
            </p>

            <div className="mt-5 flex justify-center">
              <Link
                href="/sets"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-3 text-sm font-black text-emerald-300 transition hover:border-emerald-400 hover:bg-emerald-400 hover:text-black"
              >
                Browse / Search by Set →
              </Link>
            </div>
          </div>

          {/* LIVE COUNTS */}

          <div className="mt-7 flex flex-wrap justify-center gap-2">
            <div className="inline-flex items-center gap-2 bg-zinc-950 border border-zinc-900 rounded-full px-4 py-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />

              <span className="text-sm text-zinc-400">
                <span className="text-white font-bold">
                  {cards.length}
                </span>{" "}
                collectible
                {cards.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="inline-flex items-center gap-2 bg-zinc-950 border border-zinc-900 rounded-full px-4 py-2">
              <span className="text-sm text-zinc-400">
                <span className="text-white font-bold">
                  {totalListings}
                </span>{" "}
                live listing
                {totalListings === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* CATALOG NAVIGATION */}

      <section className="border-b border-zinc-900 bg-zinc-950/40">
        <div className="max-w-7xl mx-auto px-5 py-6">

          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-black">
                Browse Catalogs
              </p>

              <p className="text-zinc-600 text-sm mt-1">
                Jump directly into a collectible category.
              </p>
            </div>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2">
            {CATALOGS.map((catalog) => {
              const active =
                activeCategory === catalog.value;

              const count =
                categoryCounts[catalog.value] || 0;

              return (
                <button
                  key={catalog.value}
                  type="button"
                  onClick={() =>
                    setActiveCategory(catalog.value)
                  }
                  className={`min-w-[135px] sm:min-w-[150px] rounded-2xl border px-4 py-4 text-left transition ${
                    active
                      ? "bg-emerald-400 border-emerald-400 text-black"
                      : "bg-black border-zinc-800 text-white hover:border-emerald-400/60"
                  }`}
                >
                  <p
                    className={`font-black text-base ${
                      active
                        ? "text-black"
                        : "text-white"
                    }`}
                  >
                    {catalog.shortLabel ||
                      catalog.label}
                  </p>

                  <p
                    className={`text-xs mt-1 ${
                      active
                        ? "text-black/60"
                        : "text-zinc-600"
                    }`}
                  >
                    {count} collectible
                    {count === 1 ? "" : "s"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* UNIVERSAL CATALOG RESULTS */}

      {searchTerm.trim().length >= 2 && (
        <section className="max-w-7xl mx-auto px-5 pt-10">
          <div className="flex items-end justify-between gap-4 mb-6">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-black mb-2">
                Universal Search
              </p>
              <h3 className="text-2xl font-black">
                Catalog Results
              </h3>
              <p className="text-zinc-500 text-sm mt-1">
                Find the exact collectible — even when no vendor has one yet.
              </p>
            </div>
          </div>

          {wishlistMessage && (
            <div className="mb-5 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
              {wishlistMessage}
            </div>
          )}

          {catalogLoading ? (
            <div className="border border-zinc-800 bg-zinc-950 rounded-2xl p-8 text-center text-zinc-500">
              Searching live catalogs...
            </div>
          ) : catalogError ? (
            <div className="border border-zinc-800 bg-zinc-950 rounded-2xl p-8 text-center text-zinc-500">
              {catalogError}
            </div>
          ) : catalogResults.length === 0 ? (
            <div className="border border-zinc-800 bg-zinc-950 rounded-2xl p-8 text-center text-zinc-500">
              No catalog matches found.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
              {catalogResults.map((card) => {
                const key = `${card.data_source}:${card.external_id}`;
                const wished = wishlistIds.has(key);

                return (
                  <CatalogCardView
                    key={key}
                    card={card}
                    wished={wished}
                    busy={wishlistBusy === key}
                    onWishlist={() => addToWishlist(card)}
                  />
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* INVENTORY */}

      <section className="max-w-7xl mx-auto px-5 py-10">

        <div className="flex flex-col gap-5 mb-8">

          <div className="flex items-center justify-between gap-4">

            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-black mb-2">
                {activeCategory === "All"
                  ? "All Catalogs"
                  : activeCatalog.label}
              </p>

              <h3 className="text-2xl font-black">
                {searchTerm.trim().length >= 2
                  ? "Available Right Now"
                  : "Available Inventory"}
              </h3>

              <p className="text-zinc-500 text-sm mt-1">
                {filteredCards.length} result
                {filteredCards.length === 1
                  ? ""
                  : "s"}
              </p>
            </div>

            {(searchTerm ||
              activeCategory !== "All") && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setActiveCategory("All");
                }}
                className="text-sm text-zinc-400 hover:text-emerald-400 transition"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* EMPTY */}

        {cards.length === 0 ? (
          <div className="border border-zinc-800 bg-zinc-950 rounded-2xl p-10 text-center">
            <h3 className="text-xl font-bold mb-2">
              No inventory yet
            </h3>

            <p className="text-zinc-500">
              Vendor listings will appear here.
            </p>
          </div>
        ) : filteredCards.length === 0 ? (
          <div className="border border-zinc-800 bg-zinc-950 rounded-2xl p-10 text-center">

            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-black mb-3">
              {activeCategory === "All"
                ? "MintRadar"
                : activeCatalog.label}
            </p>

            <h3 className="text-xl font-bold mb-2">
              {activeCategory === "All"
                ? "No matches found"
                : `No ${activeCatalog.label} inventory yet`}
            </h3>

            <p className="text-zinc-500">
              {searchTerm
                ? "Try another card, player, set, condition or grade."
                : activeCategory === "All"
                ? "Try another catalog or search."
                : `Live ${activeCatalog.label} vendor listings will appear here as they're added.`}
            </p>
          </div>
        ) : (

          /* CARD GRID */

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
            {filteredCards.map((card) => (
              <HomeCard
                key={card.id}
                card={card}
              />
            ))}
          </div>
        )}
      </section>

      {/* FOOTER */}

      <footer className="border-t border-zinc-900 mt-10">
        <div className="max-w-7xl mx-auto px-5 py-10 text-center">
          <Image
            src="/mintradar-logo.png"
            alt="MintRadar by OnlySlabs"
            width={600}
            height={300}
            className="w-[200px] sm:w-[250px] h-auto mx-auto opacity-70"
          />

          <p className="text-zinc-600 text-xs mt-4">
            Find it. Price it. Grab it.
          </p>
        </div>
      </footer>
    </main>
  );
}

// =============================================
// HOMEPAGE CARD
// =============================================

function HomeCard({
  card,
}: {
  card: Card;
}) {
  const liveListings =
    (card.inventory || []).filter(
      (listing) =>
        (listing.quantity ?? 0) > 0
    );

  const sortedListings =
    [...liveListings].sort(
      (a, b) =>
        Number(a.price ?? 0) -
        Number(b.price ?? 0)
    );

  const visibleListings =
    sortedListings.slice(0, 3);

  const additionalListings =
    Math.max(
      0,
      sortedListings.length - 3
    );

  return (
    <Link
      href={`/card/${card.id}`}
      className="group"
    >
      <article className="h-full bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden hover:border-emerald-400/60 hover:-translate-y-1 transition duration-200">

        {/* IMAGE */}

        <div className="aspect-[3/4] bg-zinc-900 flex items-center justify-center overflow-hidden">
          {card.image_url ? (
            <img
              src={card.image_url}
              alt={card.name || "Card"}
              className="w-full h-full object-contain p-3 group-hover:scale-[1.03] transition duration-200"
            />
          ) : (
            <div className="text-zinc-700 text-sm text-center px-4">
              No image available
            </div>
          )}
        </div>

        <div className="p-4">

          {/* CATEGORY */}

          <div className="mb-3">
            <span className="inline-flex text-[10px] uppercase tracking-[0.14em] font-black px-2 py-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              {getCategoryLabel(
                card.category || "Other"
              )}
            </span>
          </div>

          {/* CARD INFO */}

          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <h4 className="font-black text-base sm:text-lg truncate">
                {card.name ||
                  "Unnamed Card"}
              </h4>

              {card.set_name && (
                <p className="text-zinc-500 text-sm truncate mt-1">
                  {card.set_name}
                </p>
              )}
            </div>

            {card.card_number && (
              <span className="text-xs text-zinc-600 shrink-0">
                #{card.card_number}
              </span>
            )}
          </div>

          {/* CARD VARIANTS */}

          <div className="flex flex-wrap gap-2 mt-3">
            {card.rarity && (
              <span className="text-[10px] sm:text-[11px] font-bold px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300">
                {card.rarity}
              </span>
            )}

            {card.edition && (
              <span className="text-[10px] sm:text-[11px] font-bold px-2 py-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                {card.edition}
              </span>
            )}

            {card.finish && (
              <span className="text-[10px] sm:text-[11px] font-bold px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300">
                {card.finish}
              </span>
            )}
          </div>

          {/* LIVE LISTINGS */}

          <div className="mt-4 pt-4 border-t border-zinc-900">
            <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600 font-black mb-2">
              Available Listings
            </p>

            <div className="space-y-2">
              {visibleListings.map(
                (listing) => (
                  <ListingPreview
                    key={listing.id}
                    listing={listing}
                  />
                )
              )}
            </div>

            {additionalListings > 0 && (
              <p className="text-xs text-zinc-600 mt-2">
                +{additionalListings} more listing
                {additionalListings === 1
                  ? ""
                  : "s"}
              </p>
            )}
          </div>

          {/* VIEW */}

          <div className="mt-4 pt-3 border-t border-zinc-900 flex items-center justify-between">
            <span className="text-xs text-zinc-600">
              {liveListings.length} option
              {liveListings.length === 1
                ? ""
                : "s"}
            </span>

            <span className="text-sm font-bold text-emerald-400">
              View →
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}

// =============================================
// LISTING PREVIEW
// =============================================

function ListingPreview({
  listing,
}: {
  listing: InventoryListing;
}) {
  const graded =
    listing.listing_type === "graded";

  if (graded) {
    return (
      <div className="flex items-center justify-between gap-2 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-2.5 py-2">
        <div className="min-w-0">
          <p className="text-xs sm:text-sm font-black text-emerald-300 truncate">
            {listing.grading_company ||
              "Graded"}{" "}
            {listing.grade || ""}
          </p>

          <p className="text-[10px] text-zinc-500">
            Graded
          </p>
        </div>

        <p className="text-xs sm:text-sm font-black text-white shrink-0">
          $
          {Number(
            listing.price ?? 0
          ).toFixed(2)}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 bg-black border border-zinc-900 rounded-lg px-2.5 py-2">
      <div className="min-w-0">
        <p className="text-xs sm:text-sm font-black text-white truncate">
          {listing.condition || "Raw"} Raw
        </p>

        <p className="text-[10px] text-zinc-600">
          Ungraded
        </p>
      </div>

      <p className="text-xs sm:text-sm font-black text-emerald-400 shrink-0">
        $
        {Number(
          listing.price ?? 0
        ).toFixed(2)}
      </p>
    </div>
  );
}

// =============================================
// CATALOG SEARCH CARD
// =============================================

function CatalogCardView({
  card,
  wished,
  busy,
  onWishlist,
}: {
  card: CatalogCard;
  wished: boolean;
  busy: boolean;
  onWishlist: () => void;
}) {
  return (
    <article className="h-full bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden hover:border-emerald-400/50 transition">
      <div className="aspect-[3/4] bg-zinc-900 flex items-center justify-center overflow-hidden">
        {card.image_url ? (
          <img
            src={card.image_url}
            alt={card.name}
            className="w-full h-full object-contain p-3"
          />
        ) : (
          <div className="text-zinc-700 text-sm text-center px-4">
            No image available
          </div>
        )}
      </div>

      <div className="p-4">
        <span className="inline-flex text-[10px] uppercase tracking-[0.14em] font-black px-2 py-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
          {getCategoryLabel(card.category || "Other")}
        </span>

        <div className="mt-3">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-black text-base sm:text-lg leading-tight">
              {card.name}
            </h4>

            {card.card_number && (
              <span className="text-xs text-zinc-600 shrink-0">
                #{card.card_number}
              </span>
            )}
          </div>

          {(card.year || card.set_name || card.release_name) && (
            <p className="text-zinc-500 text-sm mt-1 line-clamp-2">
              {[card.year, card.release_name, card.set_name]
                .filter(Boolean)
                .join(" • ")}
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            {(card.parallel_name || card.finish) && (
              <span className="text-[10px] sm:text-[11px] font-bold px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300">
                {card.parallel_name || card.finish}
              </span>
            )}

            {card.rarity && (
              <span className="text-[10px] sm:text-[11px] font-bold px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300">
                {card.rarity}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-900">
          <button
            type="button"
            disabled={wished || busy}
            onClick={onWishlist}
            className={`w-full rounded-xl px-3 py-3 text-sm font-black transition ${
              wished
                ? "bg-emerald-400/10 border border-emerald-400/30 text-emerald-300"
                : "bg-emerald-400 text-black hover:bg-emerald-300 disabled:opacity-60"
            }`}
          >
            {wished
              ? "♥ Wishlisted"
              : busy
              ? "Saving..."
              : "♡ Add to Wishlist"}
          </button>
        </div>
      </div>
    </article>
  );
}

// =============================================
// CATEGORY LABEL
// =============================================

function getCategoryLabel(
  category: string
) {
  if (
    category ===
    "Magic: The Gathering"
  ) {
    return "MTG";
  }

  if (category === "Pokemon") {
    return "Pokémon";
  }

  return category;
}