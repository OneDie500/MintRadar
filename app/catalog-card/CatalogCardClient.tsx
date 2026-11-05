
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { openMarketCompLink } from "../../lib/mobile-market-link";
import { marketSearchQuery, marketSearchFallbacks } from "../../lib/market-search";

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
  language?: string | null;
  canonical_name?: string | null;
  set_id?: string | null;
  variant?: string | null;
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

type VerifiedMarketPrice = {
  market_price: number;
  low_price: number | null;
  printing: string;
  as_of: string | null;
  product_url: string | null;
};

type MarketPreviewResponse = {
  ok?: boolean;
  reason?: string;
  price?: VerifiedMarketPrice;
};

function VerifiedMarketPanel({ card }: { card: CatalogCard }) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<MarketPreviewResponse | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setResult(null);

    if (normalize(card.category) !== "pokemon" ||
        (card.language || "EN").trim().toUpperCase() !== "EN" ||
        !card.external_id || !card.data_source) {
      setLoading(false);
      return () => { active = false; };
    }

    const params = new URLSearchParams({
      external_id: card.external_id,
      data_source: card.data_source,
    });
    void (async () => {
      try {
        const response = await fetch(`/api/catalog/verified-market?${params}`, { cache: "no-store" });
        const json = (await response.json()) as MarketPreviewResponse;
        if (active) setResult(json);
      } catch {
        if (active) setResult({ ok: false, reason: "Market data is temporarily unavailable." });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [card.external_id, card.data_source, card.category, card.language]);

  const money = (value: number) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(value);
  const price = result?.ok ? result.price : undefined;
  const date = price?.as_of && !Number.isNaN(Date.parse(price.as_of))
    ? new Date(price.as_of).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <section className="mt-8 rounded-3xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">Verified Market Pricing</p>
      {loading ? (
        <p className="mt-3 text-sm text-zinc-400" role="status">Checking verified market data...</p>
      ) : price ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div><p className="text-xs text-zinc-400">Market price</p><p className="text-3xl font-black text-white">{money(price.market_price)}</p></div>
            {typeof price.low_price === "number" && <div><p className="text-xs text-zinc-400">Low price</p><p className="text-xl font-bold text-white">{money(price.low_price)}</p></div>}
          </div>
          <p className="mt-3 text-sm text-zinc-300">Verified printing: {price.printing}</p>
          {date && <p className="mt-1 text-xs text-zinc-500">Provider updated: {date}</p>}
          {price.product_url && <a className="mt-3 inline-block text-sm font-bold text-emerald-400 hover:text-emerald-300" href={price.product_url} target="_blank" rel="noreferrer">View verified TCGplayer product ↗</a>}
          <p className="mt-3 text-xs text-zinc-500">TCG API market data · Development preview only. Prices may change.</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-400">{result?.reason || "Verified pricing is not available for this card yet."}</p>
      )}
    </section>
  );
}

function MarketCompButtons({
  card,
}: {
  card: CatalogCard;
}) {
  const searchQuery = marketSearchQuery(card, "130point");
  const tcgQuery = marketSearchQuery(card, "tcgplayer");
  const priceQuery = marketSearchQuery(card, "pricecharting");
  const ebayQuery = marketSearchQuery(card, "ebay");
  const ladderQuery = marketSearchQuery(card, "cardladder");
  const fallbacks = marketSearchFallbacks(card);
  const broadQuery = fallbacks[fallbacks.length - 1] || card.name.trim();
  const isPokemon = normalize(card.category) === "pokemon";
  const tcgSearchBase = isPokemon
    ? "https://www.tcgplayer.com/search/pokemon/product?q="
    : "https://www.tcgplayer.com/search/all/product?q=";
  const ebaySearch = (query: string) =>
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
  const priceSearch = (query: string) =>
    `https://www.pricecharting.com/search-products?q=${encodeURIComponent(query)}&type=prices`;

  const markets = isSports(card)
    ? [
        { name: "130point", href: "https://130point.com/search/", detail: "Sold comps • search terms copied on click", copyQuery: searchQuery, broadHref: "https://130point.com/search/", broadCopyQuery: broadQuery },
        { name: "Market Movers", href: "https://www.marketmoversapp.com/", detail: "Card prices and market trends • account may be required" },
        { name: "Card Ladder", href: `https://www.cardladder.com/ladder?query=${encodeURIComponent(ladderQuery)}`, detail: "Sports market data", broadHref: `https://www.cardladder.com/ladder?query=${encodeURIComponent(broadQuery)}` },
        { name: "eBay Sold", href: ebaySearch(ebayQuery), detail: "Sold listings • eBay sign-in may be required", broadHref: ebaySearch(broadQuery) },
      ]
    : [
        { name: "130point", href: "https://130point.com/search/", detail: "Sold comps • search terms copied on click", copyQuery: searchQuery, broadHref: "https://130point.com/search/", broadCopyQuery: broadQuery },
        { name: "Market Movers", href: "https://www.marketmoversapp.com/", detail: "Card prices and market trends • account may be required" },
        { name: "TCGplayer", href: `${tcgSearchBase}${encodeURIComponent(tcgQuery)}`, detail: "Market listings", broadHref: `${tcgSearchBase}${encodeURIComponent(broadQuery)}` },
        { name: "PriceCharting", href: priceSearch(priceQuery), detail: "Sales history", broadHref: priceSearch(broadQuery) },
        { name: "Collectr", href: "https://app.getcollectr.com/", detail: "Collection data • search on Collectr" },
        { name: "eBay Sold", href: ebaySearch(ebayQuery), detail: "Sold listings • eBay sign-in may be required", broadHref: ebaySearch(broadQuery) },
      ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {markets.map((market) => (
        <div
          key={market.name}
          className="rounded-2xl border border-zinc-800 bg-black p-4 transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04]"
        >
          <p className="font-black text-zinc-100">{market.name}</p>
          <p className="mt-1 text-xs text-zinc-600">{market.detail}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <a
              href={market.href}
              onClick={(event) =>
                openMarketCompLink(event, market.href, market.copyQuery)
              }
              target="_blank"
              rel="noreferrer"
              className="text-xs font-black text-emerald-400 hover:text-emerald-300"
            >
              Check comps ↗
            </a>
            {market.broadHref &&
              (market.broadHref !== market.href || market.broadCopyQuery) && (
                <a
                  href={market.broadHref}
                  onClick={(event) =>
                    openMarketCompLink(
                      event,
                      market.broadHref!,
                      market.broadCopyQuery
                    )
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-zinc-400 hover:text-white"
                >
                  Broader search ↗
                </a>
              )}
          </div>
        </div>
      ))}
    </div>
  );
}


// Private E-Series / PCG artwork previews are restricted to local development.
function vintagePreviewIdentity(setId?: string | null, externalId?: string | null, number?: string | null) {
  const idMatch = /^(E[1-5]|PCG[1-9])-(\d{1,3})$/i.exec((externalId || "").trim());
  const set = (setId || idMatch?.[1] || "").trim().toUpperCase();
  if (!/^(?:E[1-5]|PCG[1-9])$/.test(set)) return null;
  if (idMatch && idMatch[1].toUpperCase() !== set) return null;
  const printed = (number || idMatch?.[2] || "").trim().split("/")[0].trim();
  if (!/^\d{1,3}$/.test(printed) || Number(printed) < 1) return null;
  if (idMatch && Number(idMatch[2]) !== Number(printed)) return null;
  return { setId: set, number: printed.padStart(3, "0") };
}

function ResilientCatalogImage({
  card,
}: {
  card: CatalogCard;
}) {
  const pokemonCard =
    normalize(card.category) === "pokemon";

  const onePieceCard =
    normalize(card.category).replace(/\s+/g, "") === "onepiece";

  const language =
    (card.language || "EN").trim().toUpperCase();

  const nonEnglishPokemonCard =
    pokemonCard &&
    Boolean(language) &&
    language !== "EN";

  const [src, setSrc] =
    useState<string | null>(
      ((value) => /^https?:\/\//i.test(value) || value.startsWith("/api/") || value.startsWith("/images/") ? value : null)(card.image_url?.trim() || "")
    );

  const [
    fallbackAttempted,
    setFallbackAttempted,
  ] = useState(false);

  const [failed, setFailed] =
    useState(false);

  function buildPokemonFallbackUrl() {
    if (
      !pokemonCard ||
      !card.name?.trim()
    ) {
      return null;
    }

    const params =
      new URLSearchParams();

    params.set(
      "name",
      card.name.trim()
    );

    if (card.set_name?.trim()) {
      params.set(
        "setName",
        card.set_name.trim()
      );
    }

    if (card.set_id?.trim()) {
      params.set(
        "setId",
        card.set_id.trim()
      );
    }

    if (card.card_number?.trim()) {
      params.set(
        "cardNumber",
        card.card_number.trim()
      );
    }

    const vintage = process.env.NODE_ENV === "development"
      ? vintagePreviewIdentity(card.set_id, card.external_id, card.card_number)
      : null;

    params.set("language", vintage ? "JP" : language);
    if (vintage) {
      params.set("setId", vintage.setId);
      params.set("cardNumber", vintage.number);
      params.set("stagedCandidate", "1");
    }

    return (
      `/api/catalog/pokemon-image-fallback?${params.toString()}`
    );
  }

  useEffect(() => {
    let active = true;

    setFallbackAttempted(false);
    setFailed(false);

    const storedImage =
      ((value) => /^https?:\/\//i.test(value) || value.startsWith("/api/") || value.startsWith("/images/") ? value : null)(card.image_url?.trim() || "");

    if (storedImage) {
      const displayImage =
        onePieceCard &&
        storedImage.startsWith(
          "https://www.onepiece-cardgame.com/"
        )
          ? `/api/catalog/onepiece-image?url=${encodeURIComponent(
              storedImage
            )}`
          : storedImage;

      setSrc(displayImage);

      return () => {
        active = false;
      };
    }

    if (!pokemonCard) {
      setSrc(null);
      setFailed(true);

      return () => {
        active = false;
      };
    }

    const fallbackUrl =
      buildPokemonFallbackUrl();

    if (!fallbackUrl) {
      setSrc(null);
      setFailed(true);

      return () => {
        active = false;
      };
    }

    setSrc(null);
    setFallbackAttempted(true);

    void (async () => {
      try {
        const response =
          await fetch(
            fallbackUrl,
            {
              method: "GET",
              cache: "no-store",
            }
          );

        const payload =
          response.ok
            ? ((await response.json()) as {
                ok?: boolean;
                imageUrl?: string | null;
                testingOnly?: boolean;
              })
            : null;

        if (
          active &&
          payload?.ok &&
          typeof payload.imageUrl === "string" &&
          payload.imageUrl.trim() &&
          (!payload.testingOnly || process.env.NODE_ENV === "development")
        ) {
          setSrc(
            payload.imageUrl.trim()
          );
          setFailed(false);
          return;
        }

        if (active) {
          setFailed(true);
        }
      } catch (error) {
        console.error(
          "Catalog detail localized image fallback error:",
          error
        );

        if (active) {
          setFailed(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    card.external_id,
    card.image_url,
    card.category,
    card.name,
    card.set_name,
    card.set_id,
    card.card_number,
    card.language,
    language,
    pokemonCard,
    onePieceCard,
    nonEnglishPokemonCard,
  ]);

  async function retryFallbackAfterImageError() {
    if (
      !pokemonCard ||
      fallbackAttempted
    ) {
      setFailed(true);
      return;
    }

    const fallbackUrl =
      buildPokemonFallbackUrl();

    if (!fallbackUrl) {
      setFailed(true);
      return;
    }

    setSrc(null);
    setFallbackAttempted(true);
    setFailed(false);

    try {
      const response =
        await fetch(
          fallbackUrl,
          {
            method: "GET",
            cache: "no-store",
          }
        );

      const payload =
        response.ok
          ? ((await response.json()) as {
              ok?: boolean;
              imageUrl?: string | null;
                testingOnly?: boolean;
            })
          : null;

      if (
        payload?.ok &&
        typeof payload.imageUrl === "string" &&
        payload.imageUrl.trim() &&
          (!payload.testingOnly || process.env.NODE_ENV === "development")
      ) {
        setSrc(
          payload.imageUrl.trim()
        );
        return;
      }

      setFailed(true);
    } catch (error) {
      console.error(
        "Catalog detail image retry failed:",
        error
      );
      setFailed(true);
    }
  }

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
      alt={
        card.canonical_name ||
        card.name ||
        "Trading card"
      }
      className="h-full w-full object-contain p-4"
      onError={() => {
        void retryFallbackAfterImageError();
      }}
    />
  );
}

export default function CatalogCardClient({
  card,
}: {
  card: CatalogCard;
}) {
  const onePieceCard =
    normalize(card.category).replace(/\s+/g, "") === "onepiece";

  const language =
    (card.language || "EN").trim().toUpperCase();

  const japaneseOnePiece =
    onePieceCard && language === "JP";

  const displayName =
    japaneseOnePiece && card.canonical_name?.trim()
      ? card.canonical_name.trim()
      : card.name;

  const originalLanguageName =
    japaneseOnePiece &&
    card.name?.trim() &&
    normalize(card.name) !== normalize(displayName)
      ? card.name.trim()
      : null;

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
        `${displayName} was added to your wishlist.`
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
              {displayName}
            </h1>

            {originalLanguageName && (
              <p className="mt-2 text-lg font-semibold text-zinc-400">
                {originalLanguageName}
              </p>
            )}

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

              {card.language && (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-bold text-zinc-300">
                  {card.language}
                </span>
              )}

              {card.variant &&
                normalize(card.variant) !== normalize(card.finish) && (
                  <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-bold text-zinc-300">
                    {card.variant}
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

        <VerifiedMarketPanel card={card} />

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
