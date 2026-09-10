"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabase";

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

function normalize(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function isSports(card: CatalogCard) {
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

function MarketCompButtons({
  card,
}: {
  card: CatalogCard;
}) {
  const searchQuery = [
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

  const encoded =
    encodeURIComponent(searchQuery);

  const markets = isSports(card)
    ? [
        {
          name: "Card Ladder",
          href: `https://www.cardladder.com/ladder?query=${encoded}`,
          detail: "Sports market data",
        },
        {
          name: "130point",
          href: "https://130point.com/search/",
          detail: "Recent sold listings",
        },
        {
          name: "eBay Sold",
          href: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1`,
          detail: "Completed sales",
        },
      ]
    : [
        {
          name: "TCGplayer",
          href: `https://www.tcgplayer.com/search/all/product?q=${encoded}`,
          detail: "Market prices",
        },
        {
          name: "PriceCharting",
          href: `https://www.pricecharting.com/search-products?q=${encoded}&type=prices`,
          detail: "Sales history",
        },
        {
          name: "Collectr",
          href: "https://app.getcollectr.com/",
          detail: "Collection data",
        },
        {
          name: "130point",
          href: "https://130point.com/search/",
          detail: "Recent sold listings",
        },
        {
          name: "eBay Sold",
          href: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1`,
          detail: "Completed sales",
        },
      ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {markets.map((market) => (
        <a
          key={market.name}
          href={market.href}
          target="_blank"
          rel="noreferrer"
          className="rounded-2xl border border-zinc-800 bg-black p-4 transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04]"
        >
          <p className="font-black text-zinc-100">
            {market.name}
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            {market.detail}
          </p>
          <p className="mt-3 text-xs font-black text-emerald-400">
            Check comps ↗
          </p>
        </a>
      ))}
    </div>
  );
}

function ResilientCatalogImage({
  card,
}: {
  card: CatalogCard;
}) {
  const [src, setSrc] =
    useState<string | null>(
      card.image_url || null
    );
  const [fallbackTried, setFallbackTried] =
    useState(false);
  const [failed, setFailed] =
    useState(false);

  async function tryFallback() {
    if (
      fallbackTried ||
      normalize(card.category) !==
        "pokemon"
    ) {
      setFailed(true);
      return;
    }

    setFallbackTried(true);

    try {
      const params =
        new URLSearchParams({
          name: card.name,
        });

      if (card.set_name) {
        params.set(
          "setName",
          card.set_name
        );
      }

      if (card.card_number) {
        params.set(
          "cardNumber",
          card.card_number
        );
      }

      const response = await fetch(
        `/api/catalog/pokemon-image-fallback?${params.toString()}`,
        {
          cache: "no-store",
        }
      );

      const payload =
        await response.json();

      if (
        response.ok &&
        payload?.ok &&
        payload?.imageUrl
      ) {
        setSrc(payload.imageUrl);
        return;
      }
    } catch (error) {
      console.error(
        "Catalog detail image fallback error:",
        error
      );
    }

    setFailed(true);
  }

  useEffect(() => {
    if (!src && !failed) {
      void tryFallback();
    }
  }, [src, failed]);

  if (failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center text-center">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
          MintRadar
        </p>
        <p className="mt-2 text-sm text-zinc-600">
          Image unavailable
        </p>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-zinc-700">
        Loading image...
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={card.name}
      className="h-full w-full object-contain p-4"
      onError={() =>
        void tryFallback()
      }
    />
  );
}

export default function CatalogCardDetailPage() {
  const params = useSearchParams();

  const card = useMemo<CatalogCard>(() => {
    const rookieRaw =
      params.get("rookie");

    const printRunRaw =
      params.get("print_run");

    return {
      external_id:
        params.get("external_id") || "",
      data_source:
        params.get("data_source") || "",
      name:
        params.get("name") ||
        "Unknown Collectible",
      set_name:
        params.get("set_name"),
      card_number:
        params.get("card_number"),
      image_url:
        params.get("image_url"),
      category:
        params.get("category"),
      rarity:
        params.get("rarity"),
      edition:
        params.get("edition"),
      finish:
        params.get("finish"),
      year:
        params.get("year"),
      manufacturer:
        params.get("manufacturer"),
      release_name:
        params.get("release_name"),
      parallel_name:
        params.get("parallel_name"),
      sport:
        params.get("sport"),
      print_run:
        printRunRaw &&
        Number.isFinite(
          Number(printRunRaw)
        )
          ? Number(printRunRaw)
          : null,
      rookie:
        rookieRaw === "true"
          ? true
          : rookieRaw === "false"
            ? false
            : null,
    };
  }, [params]);

  const [
    isWishlisted,
    setIsWishlisted,
  ] = useState(false);

  const [
    wishlistLoading,
    setWishlistLoading,
  ] = useState(false);

  const [
    wishlistMessage,
    setWishlistMessage,
  ] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadWishlistStatus() {
      if (
        !card.external_id ||
        !card.data_source
      ) {
        return;
      }

      try {
        const {
          data: { user },
        } =
          await supabase.auth.getUser();

        if (!user) return;

        const {
          data: canonicalCard,
        } = await supabase
          .from("cards")
          .select("id")
          .eq(
            "external_id",
            card.external_id
          )
          .eq(
            "data_source",
            card.data_source
          )
          .maybeSingle();

        if (!canonicalCard?.id) {
          return;
        }

        const {
          data: wishlistRow,
        } = await supabase
          .from("wishlists")
          .select("id")
          .eq("user_id", user.id)
          .eq(
            "card_id",
            canonicalCard.id
          )
          .maybeSingle();

        if (!cancelled) {
          setIsWishlisted(
            Boolean(wishlistRow)
          );
        }
      } catch (error) {
        console.error(
          "Catalog detail wishlist status error:",
          error
        );
      }
    }

    void loadWishlistStatus();

    return () => {
      cancelled = true;
    };
  }, [
    card.external_id,
    card.data_source,
  ]);

  async function addToWishlist() {
    if (
      wishlistLoading ||
      isWishlisted
    ) {
      return;
    }

    setWishlistLoading(true);
    setWishlistMessage("");

    try {
      const {
        data: { user },
      } =
        await supabase.auth.getUser();

      if (!user) {
        setWishlistMessage(
          "Sign in to save this card to your wishlist."
        );
        return;
      }

      const { error } =
        await supabase.rpc(
          "wishlist_catalog_card",
          {
            p_external_id:
              card.external_id,
            p_data_source:
              card.data_source,
            p_name: card.name,
            p_set_name:
              card.set_name || null,
            p_card_number:
              card.card_number ||
              null,
            p_image_url:
              card.image_url || null,
            p_category:
              card.category || null,
            p_rarity:
              card.rarity || null,
            p_edition:
              card.edition || null,
            p_finish:
              card.finish || null,
            p_year:
              card.year || null,
            p_manufacturer:
              card.manufacturer ||
              null,
            p_release_name:
              card.release_name ||
              null,
            p_parallel_name:
              card.parallel_name ||
              null,
            p_sport:
              card.sport || null,
            p_print_run:
              card.print_run || null,
            p_rookie:
              card.rookie ?? null,
          }
        );

      if (error) {
        throw error;
      }

      setIsWishlisted(true);
      setWishlistMessage(
        `${card.name} was added to your wishlist.`
      );
    } catch (error: any) {
      console.error(
        "Catalog detail wishlist error:",
        error
      );
      setWishlistMessage(
        error?.message ||
          "MintRadar could not update your wishlist."
      );
    } finally {
      setWishlistLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 pb-16 pt-20 text-white sm:px-5 sm:pt-24">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <Link
            href="/"
            className="inline-block"
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
        </header>

        <section className="grid gap-8 lg:grid-cols-[340px_1fr]">
          <div>
            <div className="aspect-[3/4] overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950">
              <ResilientCatalogImage
                card={card}
              />
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">
                {card.category ||
                  "Collectible"}
              </span>

              <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">
                Not Currently Listed
              </span>
            </div>

            <h1 className="mt-4 text-4xl font-black sm:text-5xl">
              {card.name}
            </h1>

            <p className="mt-3 text-lg text-zinc-500">
              {[
                card.year,
                card.manufacturer,
                card.release_name ||
                  card.set_name,
                card.card_number
                  ? `#${card.card_number}`
                  : null,
              ]
                .filter(Boolean)
                .join(" • ")}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {card.parallel_name && (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-bold text-zinc-300">
                  {card.parallel_name}
                </span>
              )}

              {card.finish && (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-bold text-zinc-300">
                  {card.finish}
                </span>
              )}

              {card.rarity && (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-bold text-zinc-300">
                  {card.rarity}
                </span>
              )}

              {card.edition && (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-bold text-zinc-300">
                  {card.edition}
                </span>
              )}
            </div>

            <div className="mt-7 rounded-3xl border border-zinc-900 bg-zinc-950 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                MintRadar Marketplace
              </p>

              <h2 className="mt-2 text-2xl font-black">
                No active listings yet
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                This collectible is in the MintRadar catalog, but no vendor currently has an active listing. Save it to your wishlist and check current market comps below.
              </p>

              <button
                type="button"
                onClick={() =>
                  void addToWishlist()
                }
                disabled={
                  isWishlisted ||
                  wishlistLoading
                }
                className={`mt-5 rounded-xl px-5 py-3 text-sm font-black transition ${
                  isWishlisted
                    ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                    : "bg-emerald-400 text-black hover:bg-emerald-300 disabled:opacity-50"
                }`}
              >
                {isWishlisted
                  ? "♥ Wishlisted"
                  : wishlistLoading
                    ? "Saving..."
                    : "♡ Add to Wishlist"}
              </button>

              {wishlistMessage && (
                <p className="mt-3 text-sm text-zinc-500">
                  {wishlistMessage}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="mt-10 overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950">
          <div className="border-b border-zinc-900 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
              Market Comps
            </p>

            <h2 className="mt-2 text-2xl font-black">
              Check current market data
            </h2>

            <p className="mt-2 text-sm text-zinc-500">
              Use the same marketplace sources available throughout MintRadar to research current pricing before buying, selling, or trading.
            </p>
          </div>

          <div className="p-5">
            <MarketCompButtons
              card={card}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
