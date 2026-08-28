"use client";

import {
  useEffect,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Listing = {
  id: string;
  vendor_id: string;
  card_id: string;
  condition: string | null;
  price: number | null;
  quantity: number | null;
  listing_type: string | null;
  grading_company: string | null;
  grade: string | null;
  cert_number: string | null;
  notes: string | null;
  cards: {
    id: string;
    name: string | null;
    set_name: string | null;
    card_number: string | null;
    image_url: string | null;
    rarity: string | null;
    category: string | null;
    edition: string | null;
    finish: string | null;
  } | null;
  vendors: {
    id: string;
    business_name: string | null;
  } | null;
};

type MarketplaceListing = {
  id: string;
  vendor_id: string;
  condition: string | null;
  price: number | null;
  quantity: number | null;
  listing_type: string | null;
  grading_company: string | null;
  grade: string | null;
  cert_number: string | null;
  vendors: {
    id: string;
    business_name: string | null;
  } | null;
};

export default function PublicListingPage() {
  const params =
    useParams<{
      listingId: string;
    }>();

  const listingId =
    String(
      params.listingId || ""
    );

  const [listing, setListing] =
    useState<Listing | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [
    marketplaceListings,
    setMarketplaceListings,
  ] = useState<MarketplaceListing[]>([]);

  const [
    marketplaceLoading,
    setMarketplaceLoading,
  ] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadListing() {
      setLoading(true);
      setError("");

      try {
        const {
          data,
          error:
            listingError,
        } = await supabase
          .from("inventory")
          .select(`
            id,
            vendor_id,
            card_id,
            condition,
            price,
            quantity,
            listing_type,
            grading_company,
            grade,
            cert_number,
            notes,
            cards (
              id,
              name,
              set_name,
              card_number,
              image_url,
              rarity,
              category,
              edition,
              finish
            ),
            vendors (
              id,
              business_name
            )
          `)
          .eq(
            "id",
            listingId
          )
          .maybeSingle();

        if (listingError) {
          throw listingError;
        }

        if (!data) {
          throw new Error(
            "This listing is no longer available."
          );
        }

        if (!cancelled) {
          const typedListing =
            data as unknown as Listing;

          setListing(
            typedListing
          );

          setMarketplaceLoading(
            true
          );

          const {
            data:
              otherListings,
            error:
              otherListingsError,
          } = await supabase
            .from("inventory")
            .select(`
              id,
              vendor_id,
              condition,
              price,
              quantity,
              listing_type,
              grading_company,
              grade,
              cert_number,
              vendors (
                id,
                business_name
              )
            `)
            .eq(
              "card_id",
              typedListing.card_id
            )
            .gt(
              "quantity",
              0
            )
            .neq(
              "id",
              typedListing.id
            )
            .order(
              "price",
              {
                ascending: true,
              }
            );

          if (
            otherListingsError
          ) {
            console.error(
              "Marketplace listings load error:",
              otherListingsError
            );

            setMarketplaceListings(
              []
            );
          } else if (
            !cancelled
          ) {
            setMarketplaceListings(
              (otherListings ||
                []) as unknown as MarketplaceListing[]
            );
          }

          if (!cancelled) {
            setMarketplaceLoading(
              false
            );
          }
        }
      } catch (err) {
        console.error(
          "Public listing load error:",
          err
        );

        if (!cancelled) {
          setListing(null);
          setError(
            err instanceof Error
              ? err.message
              : "Could not load this listing."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (listingId) {
      loadListing();
    }

    const channel =
      supabase
        .channel(
          `public-listing-${listingId}`
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "inventory",
            filter:
              `id=eq.${listingId}`,
          },
          () => {
            loadListing();
          }
        )
        .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(
        channel
      );
    };
  }, [listingId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-5">
        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400">
            MintRadar
          </p>

          <p className="mt-3 text-zinc-500">
            Loading live vendor price...
          </p>
        </div>
      </main>
    );
  }

  if (
    error ||
    !listing
  ) {
    return (
      <main className="min-h-screen bg-black text-white px-5 py-10">
        <div className="mx-auto max-w-xl">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-bold text-zinc-500 transition hover:text-emerald-400"
          >
            ← MintRadar Search
          </Link>

          <div className="mt-8 rounded-3xl border border-zinc-800 bg-zinc-950 p-8 text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-600">
              Listing unavailable
            </p>

            <h1 className="mt-3 text-3xl font-black">
              This item may have sold.
            </h1>

            <p className="mt-3 text-zinc-500">
              {error ||
                "This listing is no longer available."}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const card =
    listing.cards;

  const vendorName =
    listing.vendors
      ?.business_name ||
    "MintRadar Vendor";

  const graded =
    listing.listing_type ===
      "graded" ||
    Boolean(
      listing.grading_company ||
        listing.grade
    );

  const available =
    Number(
      listing.quantity || 0
    ) > 0;

  function listingLabel(
    item:
      | Listing
      | MarketplaceListing
  ) {
    const isGraded =
      item.listing_type ===
        "graded" ||
      Boolean(
        item.grading_company ||
          item.grade
      );

    if (isGraded) {
      return [
        item.grading_company,
        item.grade,
      ]
        .filter(Boolean)
        .join(" ");
    }

    return (
      item.condition ||
      "Raw"
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
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
              className="h-auto w-[190px] sm:w-[250px]"
            />
          </Link>

          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">
            Live Vendor Price
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-8 sm:py-12">
        <div className="grid gap-8 md:grid-cols-[320px_1fr] md:items-start">
          <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950 p-4">
            <div className="aspect-[0.716] overflow-hidden rounded-2xl bg-black">
              {card?.image_url ? (
                <img
                  src={
                    card.image_url
                  }
                  alt={
                    card.name ||
                    "Trading card"
                  }
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-700">
                  Image unavailable
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400">
              {vendorName}
            </p>

            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
              {card?.name ||
                "Unknown Card"}
            </h1>

            <p className="mt-3 text-zinc-500">
              {[
                card?.set_name,
                card?.card_number
                  ? `#${card.card_number}`
                  : null,
              ]
                .filter(Boolean)
                .join(" • ")}
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {graded ? (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-sm font-black text-emerald-300">
                  {[
                    listing.grading_company,
                    listing.grade,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </span>
              ) : (
                listing.condition && (
                  <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm font-black text-zinc-300">
                    {
                      listing.condition
                    }
                  </span>
                )
              )}

              {card?.finish && (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm font-bold text-zinc-500">
                  {card.finish}
                </span>
              )}

              {card?.edition && (
                <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm font-bold text-zinc-500">
                  {card.edition}
                </span>
              )}
            </div>

            <div className="mt-8 rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.06] p-6">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
                Current Vendor Price
              </p>

              <p className="mt-2 text-5xl font-black text-emerald-300">
                $
                {Number(
                  listing.price || 0
                ).toFixed(2)}
              </p>

              <div className="mt-5 flex items-center justify-between gap-4 border-t border-emerald-400/10 pt-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-600">
                    Availability
                  </p>

                  <p
                    className={`mt-1 font-black ${
                      available
                        ? "text-emerald-300"
                        : "text-red-300"
                    }`}
                  >
                    {available
                      ? `${listing.quantity} available`
                      : "Sold / unavailable"}
                  </p>
                </div>

                <span
                  className={`h-3 w-3 rounded-full ${
                    available
                      ? "bg-emerald-400"
                      : "bg-red-400"
                  }`}
                />
              </div>
            </div>

            {graded &&
              listing.cert_number && (
                <p className="mt-5 text-sm text-zinc-600">
                  Certification #
                  {
                    listing.cert_number
                  }
                </p>
              )}

            {listing.notes && (
              <div className="mt-5 rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
                  Vendor Notes
                </p>

                <p className="mt-2 text-sm text-zinc-400">
                  {listing.notes}
                </p>
              </div>
            )}

            <section className="mt-10 border-t border-zinc-900 pt-8">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                    MintRadar Marketplace
                  </p>

                  <h2 className="mt-2 text-2xl font-black">
                    Also available from other vendors
                  </h2>

                  <p className="mt-2 text-sm text-zinc-600">
                    Same exact card • live inventory • lowest price first
                  </p>
                </div>

                {marketplaceListings.length >
                  0 && (
                  <span className="shrink-0 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-bold text-zinc-500">
                    {
                      marketplaceListings.length
                    }{" "}
                    {marketplaceListings.length ===
                    1
                      ? "listing"
                      : "listings"}
                  </span>
                )}
              </div>

              {marketplaceLoading ? (
                <div className="mt-5 rounded-2xl border border-zinc-900 bg-zinc-950 p-5 text-sm text-zinc-600">
                  Checking other MintRadar vendors...
                </div>
              ) : marketplaceListings.length ===
                0 ? (
                <div className="mt-5 rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
                  <p className="font-black text-zinc-300">
                    This is currently the only live listing.
                  </p>

                  <p className="mt-1 text-sm text-zinc-600">
                    No other MintRadar vendors have this exact card available right now.
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {marketplaceListings.map(
                    (
                      other,
                      index
                    ) => {
                      const otherVendor =
                        other.vendors
                          ?.business_name ||
                        "MintRadar Vendor";

                      return (
                        <div
                          key={
                            other.id
                          }
                          className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4 transition hover:border-emerald-400/30"
                        >
                          <div className="flex items-center justify-between gap-5">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate font-black text-white">
                                  {
                                    otherVendor
                                  }
                                </p>

                                {index ===
                                  0 && (
                                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                                    Lowest
                                  </span>
                                )}
                              </div>

                              <p className="mt-1 text-sm font-bold text-zinc-500">
                                {listingLabel(
                                  other
                                )}
                              </p>

                              <p className="mt-1 text-xs text-zinc-700">
                                {
                                  other.quantity
                                }{" "}
                                available
                                {other.cert_number
                                  ? ` • Cert #${other.cert_number}`
                                  : ""}
                              </p>
                            </div>

                            <div className="shrink-0 text-right">
                              <p className="text-2xl font-black text-emerald-300">
                                $
                                {Number(
                                  other.price ||
                                    0
                                ).toFixed(
                                  2
                                )}
                              </p>

                              <Link
                                href={`/listing/${other.id}`}
                                className="mt-1 inline-block text-xs font-black text-zinc-500 transition hover:text-emerald-300"
                              >
                                View listing →
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              )}
            </section>

            <div className="mt-8">
              <Link
                href="/"
                className="inline-flex w-full items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950 px-5 py-4 font-black text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-300 sm:w-auto"
              >
                Search More on MintRadar →
              </Link>
            </div>

            <p className="mt-5 text-xs leading-relaxed text-zinc-700">
              Price and availability are pulled live from the vendor&apos;s MintRadar inventory.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
