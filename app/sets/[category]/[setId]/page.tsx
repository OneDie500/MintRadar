"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import {
  useParams,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { supabase } from "@/lib/supabase";

type CatalogCard = {
  external_id: string;
  data_source: string;
  name: string | null;
  set_name: string | null;
  set_id: string | null;
  card_number: string | null;
  image_url: string | null;
  category: string;
  rarity: string | null;
  edition: string | null;
  finish: string | null;
  illustrator: string | null;
};

type SetInfo = {
  id: string;
  name: string;
  category: string;
  code?: string | null;
  cardCount?: number | null;
  releasedAt?: string | null;
  setType?: string | null;
  symbolUrl?: string | null;
};

type SetResponse = {
  set?: SetInfo;
  count?: number;
  results?: CatalogCard[];
  error?: string;
};

type VendorListing = {
  id: string;
  vendor_id: string;
  business_name: string;
  condition: string | null;
  price: number | null;
  quantity: number;
  listing_type: string | null;
  grading_company: string | null;
  grade: string | null;
  cert_number: string | null;
};

const CATEGORY_LOGOS:
  Record<
    string,
    {
      src: string;
      alt: string;
    }
  > = {
  pokemon: {
    src:
      "/catalog-logos/pokemon.png",
    alt:
      "Pokémon Trading Card Game",
  },
  lorcana: {
    src:
      "/catalog-logos/lorcana.png",
    alt:
      "Disney Lorcana Trading Card Game",
  },
  onepiece: {
    src:
      "/catalog-logos/onepiece.png",
    alt:
      "One Piece Card Game",
  },
  mtg: {
    src:
      "/catalog-logos/mtg.png",
    alt:
      "Magic: The Gathering",
  },
};

export default function SetChecklistPage() {
  const params =
    useParams<{
      category: string;
      setId: string;
    }>();

  const router =
    useRouter();

  const searchParams =
    useSearchParams();

  const category =
    String(
      params.category || ""
    ).toLowerCase();

  const setId =
    String(
      params.setId || ""
    );

  const requestedName =
    searchParams
      .get("name")
      ?.trim() || "";

  const [setInfo, setSetInfo] =
    useState<SetInfo | null>(
      null
    );

  const [cards, setCards] =
    useState<CatalogCard[]>(
      []
    );

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [
    wishlistIds,
    setWishlistIds,
  ] = useState<
    Set<string>
  >(new Set());

  const [
    wishlistLoading,
    setWishlistLoading,
  ] = useState<
    Set<string>
  >(new Set());

  const [
    inventoryCounts,
    setInventoryCounts,
  ] = useState<
    Map<string, number>
  >(new Map());

  const [message, setMessage] =
    useState("");

  const [
    selectedCard,
    setSelectedCard,
  ] = useState<CatalogCard | null>(
    null
  );

  const [
    vendorListings,
    setVendorListings,
  ] = useState<VendorListing[]>(
    []
  );

  const [
    listingsLoading,
    setListingsLoading,
  ] = useState(false);

  const [
    listingsError,
    setListingsError,
  ] = useState("");

  const logo =
    CATEGORY_LOGOS[
      category
    ];

  useEffect(() => {
    let cancelled = false;

    async function loadSet() {
      setLoading(true);
      setError("");

      try {
        const query =
          requestedName
            ? `?name=${encodeURIComponent(
                requestedName
              )}`
            : "";

        const response =
          await fetch(
            `/api/catalog/set/${encodeURIComponent(
              category
            )}/${encodeURIComponent(
              setId
            )}${query}`,
            {
              cache:
                "no-store",
            }
          );

        const data:
          SetResponse =
            await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              "Set checklist failed."
          );
        }

        if (!cancelled) {
          setSetInfo(
            data.set ||
              null
          );

          setCards(
            Array.isArray(
              data.results
            )
              ? data.results
              : []
          );
        }
      } catch (loadError) {
        console.error(
          "Set page error:",
          loadError
        );

        if (!cancelled) {
          setSetInfo(null);
          setCards([]);
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Could not load this set."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (
      category &&
      setId
    ) {
      loadSet();
    }

    return () => {
      cancelled = true;
    };
  }, [
    category,
    setId,
    requestedName,
  ]);

  useEffect(() => {
    loadWishlist();
  }, []);

  useEffect(() => {
    const {
      data: authListener,
    } =
      supabase.auth.onAuthStateChange(
        () => {
          loadWishlist();
        }
      );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (
      cards.length === 0
    ) {
      setInventoryCounts(
        new Map()
      );
      return;
    }

    loadInventoryAvailability(
      cards
    );
  }, [cards]);

  async function loadWishlist() {
    const {
      data: sessionData,
    } =
      await supabase.auth.getSession();

    const user =
      sessionData.session
        ?.user;

    if (!user) {
      setWishlistIds(
        new Set()
      );
      return;
    }

    const {
      data,
      error:
        wishlistError,
    } = await supabase
      .from("wishlists")
      .select(
        "card_id, cards!inner(data_source, external_id)"
      )
      .eq(
        "user_id",
        user.id
      );

    if (
      wishlistError
    ) {
      console.error(
        "Wishlist load error:",
        wishlistError
      );
      return;
    }

    const next =
      new Set<string>();

    (
      data || []
    ).forEach(
      (row: any) => {
        const card =
          Array.isArray(
            row.cards
          )
            ? row.cards[0]
            : row.cards;

        if (
          card?.data_source &&
          card?.external_id
        ) {
          next.add(
            `${card.data_source}:${card.external_id}`
          );
        }
      }
    );

    setWishlistIds(next);
  }

  async function loadInventoryAvailability(
    sourceCards: CatalogCard[]
  ) {
    const sources =
      Array.from(
        new Set(
          sourceCards
            .map(
              (card) =>
                card.data_source
            )
            .filter(Boolean)
        )
      );

    const externalIds =
      Array.from(
        new Set(
          sourceCards
            .map(
              (card) =>
                card.external_id
            )
            .filter(Boolean)
        )
      );

    if (
      sources.length === 0 ||
      externalIds.length === 0
    ) {
      setInventoryCounts(
        new Map()
      );
      return;
    }

    const {
      data:
        canonicalCards,
      error:
        cardError,
    } = await supabase
      .from("cards")
      .select(
        "id, data_source, external_id"
      )
      .in(
        "data_source",
        sources
      )
      .in(
        "external_id",
        externalIds
      );

    if (
      cardError ||
      !canonicalCards ||
      canonicalCards.length ===
        0
    ) {
      if (cardError) {
        console.error(
          "Canonical availability error:",
          cardError
        );
      }

      setInventoryCounts(
        new Map()
      );
      return;
    }

    const cardIds =
      canonicalCards.map(
        (card: any) =>
          card.id
      );

    const {
      data:
        inventory,
      error:
        inventoryError,
    } = await supabase
      .from("inventory")
      .select(
        "card_id, quantity"
      )
      .in(
        "card_id",
        cardIds
      )
      .gt(
        "quantity",
        0
      );

    if (
      inventoryError
    ) {
      console.error(
        "Inventory availability error:",
        inventoryError
      );
      return;
    }

    const idToKey =
      new Map<
        string,
        string
      >();

    canonicalCards.forEach(
      (card: any) => {
        idToKey.set(
          card.id,
          `${card.data_source}:${card.external_id}`
        );
      }
    );

    const next =
      new Map<
        string,
        number
      >();

    (
      inventory || []
    ).forEach(
      (listing: any) => {
        const key =
          idToKey.get(
            listing.card_id
          );

        if (!key) {
          return;
        }

        next.set(
          key,
          (next.get(key) ||
            0) +
            Number(
              listing.quantity ||
                0
            )
        );
      }
    );

    setInventoryCounts(
      next
    );
  }

  async function openVendorListings(
    card: CatalogCard
  ) {
    setSelectedCard(card);
    setVendorListings([]);
    setListingsError("");
    setListingsLoading(true);

    try {
      const {
        data: canonicalCard,
        error: canonicalError,
      } = await supabase
        .from("cards")
        .select("id")
        .eq(
          "data_source",
          card.data_source
        )
        .eq(
          "external_id",
          card.external_id
        )
        .maybeSingle();

      if (canonicalError) {
        throw canonicalError;
      }

      if (!canonicalCard?.id) {
        setListingsError(
          "This card is not currently listed."
        );
        return;
      }

      const {
        data: inventory,
        error: inventoryError,
      } = await supabase
        .from("inventory")
        .select(
          "id, vendor_id, condition, price, quantity, listing_type, grading_company, grade, cert_number"
        )
        .eq(
          "card_id",
          canonicalCard.id
        )
        .gt("quantity", 0)
        .order("price", {
          ascending: true,
        });

      if (inventoryError) {
        throw inventoryError;
      }

      const liveInventory =
        inventory || [];

      if (liveInventory.length === 0) {
        setListingsError(
          "This card is not currently listed."
        );
        return;
      }

      const vendorIds = Array.from(
        new Set(
          liveInventory
            .map(
              (listing: any) =>
                listing.vendor_id
            )
            .filter(Boolean)
        )
      );

      const vendorNames =
        new Map<string, string>();

      if (vendorIds.length > 0) {
        const {
          data: vendors,
          error: vendorError,
        } = await supabase
          .from("vendors")
          .select(
            "id, business_name"
          )
          .in("id", vendorIds);

        if (vendorError) {
          console.error(
            "Vendor name load error:",
            vendorError
          );
        } else {
          (vendors || []).forEach(
            (vendor: any) => {
              vendorNames.set(
                vendor.id,
                vendor.business_name ||
                  "MintRadar Vendor"
              );
            }
          );
        }
      }

      const nextListings:
        VendorListing[] =
          liveInventory.map(
            (listing: any) => ({
              id: listing.id,
              vendor_id:
                listing.vendor_id,
              business_name:
                vendorNames.get(
                  listing.vendor_id
                ) ||
                "MintRadar Vendor",
              condition:
                listing.condition ||
                null,
              price:
                listing.price ===
                  null ||
                listing.price ===
                  undefined
                  ? null
                  : Number(
                      listing.price
                    ),
              quantity: Number(
                listing.quantity || 0
              ),
              listing_type:
                listing.listing_type ||
                null,
              grading_company:
                listing.grading_company ||
                null,
              grade:
                listing.grade ===
                  null ||
                listing.grade ===
                  undefined
                  ? null
                  : String(
                      listing.grade
                    ),
              cert_number:
                listing.cert_number ||
                null,
            })
          );

      setVendorListings(
        nextListings
      );
    } catch (listingError) {
      console.error(
        "Vendor listings error:",
        listingError
      );

      setListingsError(
        "Could not load vendor listings. Please try again."
      );
    } finally {
      setListingsLoading(false);
    }
  }

  function closeVendorListings() {
    setSelectedCard(null);
    setVendorListings([]);
    setListingsError("");
    setListingsLoading(false);
  }

  async function toggleWishlist(
    card: CatalogCard
  ) {
    const key =
      `${card.data_source}:${card.external_id}`;

    if (
      wishlistLoading.has(
        key
      )
    ) {
      return;
    }

    const {
      data: sessionData,
    } =
      await supabase.auth.getSession();

    const user =
      sessionData.session
        ?.user;

    if (!user) {
      setMessage(
        "Sign in to save cards to your wishlist."
      );
      return;
    }

    const nextLoading =
      new Set(
        wishlistLoading
      );

    nextLoading.add(key);
    setWishlistLoading(
      nextLoading
    );

    setMessage("");

    try {
      if (
        wishlistIds.has(
          key
        )
      ) {
        const {
          data:
            canonicalCard,
          error:
            canonicalError,
        } = await supabase
          .from("cards")
          .select("id")
          .eq(
            "data_source",
            card.data_source
          )
          .eq(
            "external_id",
            card.external_id
          )
          .maybeSingle();

        if (
          canonicalError
        ) {
          throw canonicalError;
        }

        if (
          canonicalCard?.id
        ) {
          const {
            error:
              deleteError,
          } = await supabase
            .from(
              "wishlists"
            )
            .delete()
            .eq(
              "user_id",
              user.id
            )
            .eq(
              "card_id",
              canonicalCard.id
            );

          if (
            deleteError
          ) {
            throw deleteError;
          }
        }

        setWishlistIds(
          (current) => {
            const next =
              new Set(
                current
              );
            next.delete(
              key
            );
            return next;
          }
        );

        setMessage(
          `${card.name || "Card"} removed from your wishlist.`
        );
      } else {
        const {
          error:
            rpcError,
        } =
          await supabase.rpc(
            "wishlist_catalog_card",
            {
              p_external_id:
                card.external_id,
              p_data_source:
                card.data_source,
              p_name:
                card.name ||
                "Unknown Card",
              p_set_name:
                card.set_name,
              p_card_number:
                card.card_number,
              p_image_url:
                card.image_url,
              p_category:
                card.category,
              p_rarity:
                card.rarity,
              p_edition:
                card.edition,
              p_finish:
                card.finish,
              p_year:
                null,
              p_manufacturer:
                null,
              p_release_name:
                null,
              p_parallel_name:
                null,
              p_sport:
                null,
              p_print_run:
                null,
              p_rookie:
                null,
            }
          );

        if (rpcError) {
          throw rpcError;
        }

        setWishlistIds(
          (current) => {
            const next =
              new Set(
                current
              );
            next.add(key);
            return next;
          }
        );

        setMessage(
          `${card.name || "Card"} added to your wishlist.`
        );
      }
    } catch (wishlistError) {
      console.error(
        "Wishlist action error:",
        wishlistError
      );

      setMessage(
        "Wishlist action failed. Please try again."
      );
    } finally {
      setWishlistLoading(
        (current) => {
          const next =
            new Set(
              current
            );
          next.delete(
            key
          );
          return next;
        }
      );
    }
  }

  const filteredCards =
    useMemo(() => {
      const value =
        normalizeText(
          search
        );

      if (!value) {
        return cards;
      }

      const words =
        value
          .split(" ")
          .filter(Boolean);

      return cards.filter(
        (card) => {
          const searchable =
            normalizeText(
              [
                card.name,
                card.card_number,
                card.rarity,
                card.finish,
              ]
                .filter(Boolean)
                .join(" ")
            );

          return words.every(
            (word) =>
              searchable.includes(
                word
              )
          );
        }
      );
    }, [
      cards,
      search,
    ]);

  const title =
    setInfo?.name ||
    requestedName ||
    setId;

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-5 py-5 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="shrink-0"
          >
            <Image
              src="/mintradar-logo.png"
              alt="MintRadar by OnlySlabs"
              width={600}
              height={300}
              priority
              className="w-[190px] sm:w-[260px] h-auto"
            />
          </Link>

          <button
            type="button"
            onClick={() => {
              if (
                typeof window !==
                  "undefined" &&
                window.history.length >
                  1
              ) {
                router.back();
              } else {
                router.push("/sets");
              }
            }}
            className="text-sm font-bold text-zinc-400 hover:text-emerald-400 transition"
          >
            ← Back
          </button>
        </div>
      </header>

      <section className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-5 py-10 sm:py-14">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
            <div>
              {logo && (
                <div className="h-16 sm:h-20 flex items-center mb-5">
                  <img
                    src={logo.src}
                    alt={logo.alt}
                    className="max-h-full max-w-[240px] sm:max-w-[320px] w-auto object-contain"
                  />
                </div>
              )}

              <p className="text-xs uppercase tracking-[0.22em] font-black text-emerald-400">
                Set Checklist
              </p>

              <div className="mt-3 flex items-center gap-4">
                {setInfo?.symbolUrl && (
                  <img
                    src={
                      setInfo.symbolUrl
                    }
                    alt=""
                    className="h-10 w-10 object-contain"
                  />
                )}

                <h1 className="text-4xl sm:text-6xl font-black tracking-tight">
                  {title}
                </h1>
              </div>

              {!loading &&
                setInfo && (
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-500">
                    {setInfo.code && (
                      <span>
                        {setInfo.code.toUpperCase()}
                      </span>
                    )}

                    {setInfo.releasedAt && (
                      <span>
                        {setInfo.releasedAt}
                      </span>
                    )}

                    {setInfo.setType && (
                      <span className="capitalize">
                        {setInfo.setType.replace(
                          /_/g,
                          " "
                        )}
                      </span>
                    )}

                    <span>
                      {cards.length} card
                      {cards.length ===
                      1
                        ? ""
                        : "s"}
                    </span>
                  </div>
                )}
            </div>

            <div className="w-full lg:max-w-md">
              <label className="text-xs uppercase tracking-[0.18em] font-black text-zinc-600">
                Search this set
              </label>

              <input
                value={search}
                onChange={(
                  event
                ) =>
                  setSearch(
                    event.target
                      .value
                  )
                }
                placeholder={`Search ${title}...`}
                className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-5 py-4 text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400"
              />
            </div>
          </div>

          {message && (
            <div className="mt-6 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
              {message}
            </div>
          )}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-5 py-10">
        {loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-12 text-center text-zinc-500">
            Loading the full checklist...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-12 text-center">
            <h2 className="text-xl font-black">
              Set unavailable
            </h2>

            <p className="mt-2 text-red-300/70">
              {error}
            </p>
          </div>
        ) : cards.length ===
          0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-12 text-center">
            <h2 className="text-xl font-black">
              No cards found
            </h2>

            <p className="mt-2 text-zinc-500">
              This provider did not return cards for this set yet.
            </p>
          </div>
        ) : filteredCards.length ===
          0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-12 text-center">
            <h2 className="text-xl font-black">
              No matching cards
            </h2>

            <p className="mt-2 text-zinc-500">
              Try another card name, number, rarity, or finish.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-5 flex items-center justify-between gap-4">
              <p className="text-sm text-zinc-600">
                Showing{" "}
                {filteredCards.length}{" "}
                of {cards.length}
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
              {filteredCards.map(
                (card) => {
                  const key =
                    `${card.data_source}:${card.external_id}`;

                  const wishlisted =
                    wishlistIds.has(
                      key
                    );

                  const saving =
                    wishlistLoading.has(
                      key
                    );

                  const available =
                    inventoryCounts.get(
                      key
                    ) || 0;

                  return (
                    <article
                      key={key}
                      className="group overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950 transition hover:-translate-y-1 hover:border-emerald-400/50"
                    >
                      <div className="relative aspect-[0.716] bg-zinc-900">
                        {card.image_url ? (
                          <img
                            src={
                              card.image_url
                            }
                            alt={
                              card.name ||
                              "Trading card"
                            }
                            loading="lazy"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center px-4 text-center text-xs text-zinc-700">
                            Image unavailable
                          </div>
                        )}

                        {available >
                          0 && (
                          <button
                            type="button"
                            onClick={() =>
                              openVendorListings(
                                card
                              )
                            }
                            className="absolute left-2 top-2 rounded-full border border-emerald-300/30 bg-black/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-300 backdrop-blur transition hover:border-emerald-300 hover:bg-emerald-400 hover:text-black"
                          >
                            Available •{" "}
                            {available}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            toggleWishlist(
                              card
                            )
                          }
                          disabled={
                            saving
                          }
                          aria-label={
                            wishlisted
                              ? "Remove from wishlist"
                              : "Add to wishlist"
                          }
                          className={`absolute right-2 top-2 h-10 w-10 rounded-full border backdrop-blur flex items-center justify-center text-lg transition ${
                            wishlisted
                              ? "border-emerald-300/40 bg-emerald-400 text-black"
                              : "border-white/15 bg-black/75 text-white hover:border-emerald-300 hover:text-emerald-300"
                          } ${
                            saving
                              ? "opacity-50"
                              : ""
                          }`}
                        >
                          {saving
                            ? "…"
                            : wishlisted
                            ? "♥"
                            : "♡"}
                        </button>
                      </div>

                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-black leading-tight">
                            {card.name ||
                              "Unknown Card"}
                          </h3>

                          {card.card_number && (
                            <span className="shrink-0 text-xs text-zinc-600">
                              #
                              {
                                card.card_number
                              }
                            </span>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {card.rarity && (
                            <span className="rounded-full border border-zinc-800 px-2 py-1 text-[10px] font-bold text-zinc-500">
                              {
                                card.rarity
                              }
                            </span>
                          )}

                          {card.finish && (
                            <span className="rounded-full border border-zinc-800 px-2 py-1 text-[10px] font-bold text-zinc-500">
                              {
                                card.finish
                              }
                            </span>
                          )}
                        </div>

                        <div className="mt-4 border-t border-zinc-900 pt-3">
                          {available >
                          0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                openVendorListings(
                                  card
                                )
                              }
                              className="text-left text-xs font-black text-emerald-300 transition hover:text-emerald-200"
                            >
                              View vendor listings →
                            </button>
                          ) : (
                            <p className="text-xs text-zinc-600">
                              Not currently listed — wishlist it for an alert.
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          </>
        )}
      </section>

      {selectedCard && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-5"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeVendorListings();
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-3xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-zinc-900 bg-zinc-950/95 p-5 backdrop-blur sm:p-6">
              <div className="flex min-w-0 gap-4">
                {selectedCard.image_url && (
                  <img
                    src={
                      selectedCard.image_url
                    }
                    alt={
                      selectedCard.name ||
                      "Trading card"
                    }
                    className="h-24 w-[69px] shrink-0 rounded-lg object-contain"
                  />
                )}

                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                    MintRadar Inventory
                  </p>

                  <h2 className="mt-1 text-xl font-black leading-tight sm:text-2xl">
                    {selectedCard.name ||
                      "Unknown Card"}
                  </h2>

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                    {selectedCard.set_name && (
                      <span>
                        {
                          selectedCard.set_name
                        }
                      </span>
                    )}

                    {selectedCard.card_number && (
                      <span>
                        #
                        {
                          selectedCard.card_number
                        }
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={
                  closeVendorListings
                }
                aria-label="Close vendor listings"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-black text-xl text-zinc-400 transition hover:border-zinc-600 hover:text-white"
              >
                ×
              </button>
            </div>

            <div className="p-5 sm:p-6">
              {listingsLoading ? (
                <div className="py-12 text-center text-zinc-500">
                  Finding available copies...
                </div>
              ) : listingsError ? (
                <div className="rounded-2xl border border-zinc-800 bg-black p-6 text-center text-zinc-400">
                  {listingsError}
                </div>
              ) : (
                <>
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-zinc-400">
                      <span className="font-black text-white">
                        {vendorListings.reduce(
                          (
                            total,
                            listing
                          ) =>
                            total +
                            listing.quantity,
                          0
                        )}
                      </span>{" "}
                      available{" "}
                      {vendorListings.reduce(
                        (
                          total,
                          listing
                        ) =>
                          total +
                          listing.quantity,
                        0
                      ) === 1
                        ? "copy"
                        : "copies"}
                    </p>

                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-600">
                      Lowest price first
                    </p>
                  </div>

                  <div className="space-y-3">
                    {vendorListings.map(
                      (listing) => {
                        const graded =
                          Boolean(
                            listing.grading_company ||
                              listing.grade
                          );

                        return (
                          <div
                            key={
                              listing.id
                            }
                            className="rounded-2xl border border-zinc-800 bg-black p-5"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <h3 className="font-black text-white">
                                  {
                                    listing.business_name
                                  }
                                </h3>

                                <div className="mt-2 flex flex-wrap gap-2">
                                  {graded ? (
                                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-black text-emerald-300">
                                      {[
                                        listing.grading_company,
                                        listing.grade,
                                      ]
                                        .filter(
                                          Boolean
                                        )
                                        .join(
                                          " "
                                        )}
                                    </span>
                                  ) : (
                                    listing.condition && (
                                      <span className="rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] font-black text-zinc-400">
                                        {
                                          listing.condition
                                        }
                                      </span>
                                    )
                                  )}

                                  {listing.listing_type && (
                                    <span className="rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] font-bold capitalize text-zinc-500">
                                      {
                                        listing.listing_type
                                      }
                                    </span>
                                  )}

                                  <span className="rounded-full border border-zinc-800 px-2.5 py-1 text-[11px] font-bold text-zinc-500">
                                    Qty{" "}
                                    {
                                      listing.quantity
                                    }
                                  </span>
                                </div>

                                {graded &&
                                  listing.cert_number && (
                                    <p className="mt-3 text-xs text-zinc-600">
                                      Cert #
                                      {
                                        listing.cert_number
                                      }
                                    </p>
                                  )}
                              </div>

                              <div className="shrink-0 text-right">
                                <p className="text-2xl font-black text-emerald-300">
                                  {listing.price !==
                                  null
                                    ? `$${listing.price.toFixed(
                                        2
                                      )}`
                                    : "Ask"}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>

                  <p className="mt-5 text-center text-xs text-zinc-600">
                    Reserve / Hold is coming next.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function normalizeText(
  value: string
) {
  return value
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim()
    .replace(
      /\s+/g,
      " "
    );
}
