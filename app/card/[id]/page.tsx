"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type Vendor = {
  id: string;
  business_name?: string | null;
};

type InventoryItem = {
  id?: string;
  vendor_id?: string;

  listing_type?: string | null;

  condition?: string | null;

  grading_company?: string | null;
  grade?: string | null;
  cert_number?: string | null;

  price?: number | null;
  quantity?: number | null;
  notes?: string | null;

  vendors?: Vendor | null;
};

type Comp = {
  source?: string | null;
  last_sold?: number | null;
  average?: number | null;
};

type Card = {
  id: string;
  name?: string | null;
  set_name?: string | null;
  card_number?: string | null;
  image_url?: string | null;
  rarity?: string | null;
  category?: string | null;
  edition?: string | null;
  finish?: string | null;

  inventory?: InventoryItem[];
  comps?: Comp[];
};

export default function CardDetailPage() {
  const params = useParams();

  const id =
    typeof params.id === "string"
      ? params.id
      : "";

  const [card, setCard] =
    useState<Card | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    if (!id) {
      return;
    }

    async function loadCard() {
      try {
        setLoading(true);
        setError("");

        const {
          data,
          error: cardError,
        } = await supabase
          .from("cards")
          .select(`
            id,
            name,
            set_name,
            card_number,
            image_url,
            rarity,
            category,
            edition,
            finish,
            inventory (
              id,
              vendor_id,
              listing_type,
              condition,
              grading_company,
              grade,
              cert_number,
              price,
              quantity,
              notes,
              vendors (
                id,
                business_name
              )
            ),
            comps (
              source,
              last_sold,
              average
            )
          `)
          .eq("id", id)
          .single();

        if (cardError) {
          throw cardError;
        }

        if (data) {
          setCard(
            data as unknown as Card
          );
        }
      } catch (err: any) {
        console.error(
          "Card load error:",
          err
        );

        setError(
          err?.message ||
            "We couldn't load this card."
        );
      } finally {
        setLoading(false);
      }
    }

    loadCard();
  }, [id]);

  function isGraded(
    item: InventoryItem
  ) {
    return (
      item.listing_type === "graded"
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">
          Loading card...
        </p>
      </main>
    );
  }

  if (error || !card) {
    return (
      <main className="min-h-screen bg-black text-white px-5 py-10">
        <div className="max-w-3xl mx-auto">

          <Link
            href="/"
            className="text-zinc-500 hover:text-emerald-400 transition"
          >
            ← Back to Search
          </Link>

          <div className="mt-8 bg-zinc-950 border border-red-400/30 rounded-3xl p-8">

            <p className="text-red-400 text-xs uppercase tracking-[0.2em] font-bold">
              Card Error
            </p>

            <h1 className="text-3xl font-black mt-3">
              We couldn't load this card.
            </h1>

            <p className="text-zinc-500 mt-3">
              {error ||
                "This card could not be found."}
            </p>

          </div>
        </div>
      </main>
    );
  }

  const availableInventory =
    card.inventory?.filter(
      (item) =>
        (item.quantity ?? 0) > 0
    ) || [];

  const rawListings =
    availableInventory.filter(
      (item) =>
        !isGraded(item)
    );

  const gradedListings =
    availableInventory.filter(
      (item) =>
        isGraded(item)
    );

  return (
    <main className="min-h-screen bg-black text-white">

      {/* HEADER */}

      <header className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-5 py-5 flex items-center justify-between">

          <Link
            href="/"
            className="text-xl font-black"
          >
            Mint
            <span className="text-emerald-400">
              Radar
            </span>
          </Link>

          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-emerald-400 transition"
          >
            Back to Search
          </Link>

        </div>
      </header>

      <div className="max-w-7xl mx-auto px-5 py-8">

        {/* CARD HERO */}

        <section className="grid lg:grid-cols-[360px_1fr] gap-8">

          <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6">

            <div className="aspect-[3/4] bg-black rounded-2xl overflow-hidden">

              {card.image_url ? (
                <img
                  src={card.image_url}
                  alt={
                    card.name ||
                    "Card"
                  }
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-700">
                  No Image
                </div>
              )}

            </div>

          </div>

          <div>

            <p className="text-emerald-400 text-xs uppercase tracking-[0.25em] font-bold">
              MintRadar Catalog
            </p>

            <h1 className="text-4xl sm:text-6xl font-black mt-3">
              {card.name}
            </h1>

            <p className="text-zinc-500 text-lg mt-3">
              {card.set_name}

              {card.card_number
                ? ` #${card.card_number}`
                : ""}
            </p>

            <div className="flex flex-wrap gap-2 mt-5">

              {card.category && (
                <span className="bg-zinc-950 border border-zinc-900 rounded-full px-3 py-1.5 text-sm text-zinc-400">
                  {card.category}
                </span>
              )}

              {card.rarity && (
                <span className="bg-zinc-950 border border-zinc-900 rounded-full px-3 py-1.5 text-sm text-zinc-400">
                  {card.rarity}
                </span>
              )}

              {card.edition && (
                <span className="bg-zinc-950 border border-zinc-900 rounded-full px-3 py-1.5 text-sm text-zinc-400">
                  {card.edition}
                </span>
              )}

              {card.finish && (
                <span className="bg-zinc-950 border border-zinc-900 rounded-full px-3 py-1.5 text-sm text-zinc-400">
                  {card.finish}
                </span>
              )}

            </div>

            {/* AVAILABILITY SUMMARY */}

            <div className="grid sm:grid-cols-3 gap-3 mt-8">

              <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4">

                <p className="text-zinc-600 text-sm">
                  Listings
                </p>

                <p className="text-3xl font-black mt-1">
                  {availableInventory.length}
                </p>

              </div>

              <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4">

                <p className="text-zinc-600 text-sm">
                  Raw
                </p>

                <p className="text-3xl font-black mt-1">
                  {rawListings.length}
                </p>

              </div>

              <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-4">

                <p className="text-zinc-600 text-sm">
                  Graded
                </p>

                <p className="text-3xl font-black mt-1">
                  {gradedListings.length}
                </p>

              </div>

            </div>

          </div>

        </section>

        {/* AVAILABLE NOW */}

        <section className="mt-12">

          <p className="text-emerald-400 text-xs uppercase tracking-[0.2em] font-bold">
            Available Now
          </p>

          <h2 className="text-3xl sm:text-4xl font-black mt-2">
            Shop This Card
          </h2>

          <p className="text-zinc-500 mt-2">
            Compare raw and graded copies
            currently available from MintRadar vendors.
          </p>

          {availableInventory.length === 0 ? (
            <div className="bg-zinc-950 border border-zinc-900 rounded-3xl p-10 text-center mt-6">

              <h3 className="text-2xl font-black">
                No active listings.
              </h3>

              <p className="text-zinc-500 mt-3">
                No MintRadar vendor currently
                has this item available.
              </p>

            </div>
          ) : (
            <div className="mt-8 space-y-10">

              {/* GRADED LISTINGS */}

              {gradedListings.length > 0 && (
                <section>

                  <div className="flex items-center gap-3 mb-5">

                    <span className="bg-emerald-400 text-black text-xs uppercase tracking-[0.15em] font-black rounded-full px-3 py-1.5">
                      Graded
                    </span>

                    <h3 className="text-xl font-black">
                      Slabs
                    </h3>

                  </div>

                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">

                    {gradedListings.map(
                      (item) => (
                        <GradedListingCard
                          key={item.id}
                          item={item}
                          card={card}
                        />
                      )
                    )}

                  </div>

                </section>
              )}

              {/* RAW LISTINGS */}

              {rawListings.length > 0 && (
                <section>

                  <div className="flex items-center gap-3 mb-5">

                    <span className="bg-zinc-800 text-white text-xs uppercase tracking-[0.15em] font-black rounded-full px-3 py-1.5">
                      Raw
                    </span>

                    <h3 className="text-xl font-black">
                      Ungraded Cards
                    </h3>

                  </div>

                  <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">

                    {rawListings.map(
                      (item) => (
                        <RawListingCard
                          key={item.id}
                          item={item}
                          card={card}
                        />
                      )
                    )}

                  </div>

                </section>
              )}

            </div>
          )}

        </section>

        {/* MARKET SNAPSHOT */}

        <section className="mt-12">

          <p className="text-emerald-400 text-xs uppercase tracking-[0.2em] font-bold">
            Market Snapshot
          </p>

          <h2 className="text-3xl font-black mt-2">
            Recent Comps
          </h2>

          {card.comps &&
          card.comps.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">

              {card.comps.map(
                (comp, index) => (
                  <div
                    key={`${comp.source}-${index}`}
                    className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5"
                  >

                    <p className="text-zinc-500 text-sm">
                      {comp.source ||
                        "Market Source"}
                    </p>

                    {comp.last_sold != null && (
                      <div className="mt-4">

                        <p className="text-xs uppercase tracking-wider text-zinc-600">
                          Last Sold
                        </p>

                        <p className="text-2xl font-black">
                          $
                          {Number(
                            comp.last_sold
                          ).toFixed(2)}
                        </p>

                      </div>
                    )}

                    {comp.average != null && (
                      <div className="mt-4">

                        <p className="text-xs uppercase tracking-wider text-zinc-600">
                          Average
                        </p>

                        <p className="text-2xl font-black text-emerald-400">
                          $
                          {Number(
                            comp.average
                          ).toFixed(2)}
                        </p>

                      </div>
                    )}

                  </div>
                )
              )}

            </div>
          ) : (
            <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-6 mt-5">

              <p className="text-zinc-500">
                Live market data will be
                connected here later.
              </p>

            </div>
          )}

        </section>

        {/* CTA */}

        <section className="mt-12 mb-8 bg-emerald-400 text-black rounded-3xl p-7 sm:p-9">

          <p className="text-xs uppercase tracking-[0.2em] font-black opacity-60">
            MintRadar
          </p>

          <h2 className="text-3xl sm:text-4xl font-black mt-2">
            Beat the line.
          </h2>

          <p className="font-medium mt-3 max-w-2xl">
            Find the exact collectible
            you want and see which
            MintRadar vendors have it
            before you ever reach their
            table.
          </p>

        </section>

      </div>
    </main>
  );
}

// =============================================
// GRADED LISTING
// =============================================

function GradedListingCard({
  item,
  card,
}: {
  item: InventoryItem;
  card: Card;
}) {
  const gradingCompany =
    item.grading_company ||
    "Graded";

  const grade =
    item.grade ||
    "—";

  return (
    <div className="bg-zinc-950 border border-emerald-400/30 rounded-3xl overflow-hidden">

      {/* GRADE HEADER */}

      <div className="bg-emerald-400 text-black px-5 py-4 flex items-center justify-between gap-4">

        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] font-black opacity-60">
            Graded Card
          </p>

          <p className="text-2xl font-black">
            {gradingCompany} {grade}
          </p>
        </div>

        <div className="text-right">

          <p className="text-[10px] uppercase tracking-[0.15em] font-black opacity-60">
            Grade
          </p>

          <p className="text-3xl font-black leading-none">
            {grade}
          </p>

        </div>

      </div>

      {/* CARD IMAGE */}

      <div className="p-5">

        <div className="aspect-[3/4] bg-black border border-zinc-900 rounded-2xl overflow-hidden">

          {card.image_url ? (
            <img
              src={card.image_url}
              alt={
                card.name ||
                "Card"
              }
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-700">
              No Image
            </div>
          )}

        </div>

        {/* CARD NAME */}

        <div className="mt-5">

          <h4 className="text-2xl font-black">
            {card.name}
          </h4>

          <p className="text-zinc-500 text-sm mt-1">
            {card.set_name}

            {card.card_number
              ? ` #${card.card_number}`
              : ""}
          </p>

        </div>

        {/* CERT */}

        {item.cert_number && (
          <div className="mt-4 bg-black border border-zinc-900 rounded-xl p-3">

            <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600 font-bold">
              Certification
            </p>

            <p className="font-bold mt-1">
              #{item.cert_number}
            </p>

          </div>
        )}

        {/* VENDOR */}

        <div className="mt-5 border-t border-zinc-900 pt-5">

          <p className="text-xs uppercase tracking-[0.15em] text-zinc-600 font-bold">
            Available From
          </p>

          <p className="text-lg font-black mt-1">
            {item.vendors
              ?.business_name ||
              "MintRadar Seller"}
          </p>

        </div>

        {/* NOTES */}

        {item.notes && (
          <p className="text-zinc-500 text-sm mt-3">
            {item.notes}
          </p>
        )}

        {/* PRICE */}

        <div className="flex items-end justify-between gap-4 mt-6">

          <div>

            <p className="text-xs uppercase tracking-[0.15em] text-zinc-600 font-bold">
              Price
            </p>

            <p className="text-3xl font-black text-emerald-400 mt-1">
              $
              {Number(
                item.price ?? 0
              ).toFixed(2)}
            </p>

          </div>

          <div className="text-right">

            <p className="text-xs uppercase tracking-[0.15em] text-zinc-600">
              Qty
            </p>

            <p className="font-black mt-1">
              {item.quantity ?? 0}
            </p>

          </div>

        </div>

      </div>
    </div>
  );
}

// =============================================
// RAW LISTING
// =============================================

function RawListingCard({
  item,
  card,
}: {
  item: InventoryItem;
  card: Card;
}) {
  return (
    <div className="bg-zinc-950 border border-zinc-900 rounded-3xl overflow-hidden">

      {/* RAW HEADER */}

      <div className="bg-zinc-900 px-5 py-4 flex items-center justify-between">

        <div>

          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-black">
            Raw Card
          </p>

          <p className="text-xl font-black mt-1">
            {item.condition ||
              "Raw"}
          </p>

        </div>

      </div>

      {/* IMAGE */}

      <div className="p-5">

        <div className="aspect-[3/4] bg-black border border-zinc-900 rounded-2xl overflow-hidden">

          {card.image_url ? (
            <img
              src={card.image_url}
              alt={
                card.name ||
                "Card"
              }
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-700">
              No Image
            </div>
          )}

        </div>

        <h4 className="text-2xl font-black mt-5">
          {card.name}
        </h4>

        <p className="text-zinc-500 text-sm mt-1">
          {card.set_name}

          {card.card_number
            ? ` #${card.card_number}`
            : ""}
        </p>

        <div className="flex flex-wrap gap-2 mt-4">

          {card.edition && (
            <span className="bg-black border border-zinc-900 rounded-full px-3 py-1 text-xs text-zinc-400">
              {card.edition}
            </span>
          )}

          {card.finish && (
            <span className="bg-black border border-zinc-900 rounded-full px-3 py-1 text-xs text-zinc-400">
              {card.finish}
            </span>
          )}

        </div>

        <div className="mt-5 border-t border-zinc-900 pt-5">

          <p className="text-xs uppercase tracking-[0.15em] text-zinc-600 font-bold">
            Available From
          </p>

          <p className="text-lg font-black mt-1">
            {item.vendors
              ?.business_name ||
              "MintRadar Seller"}
          </p>

        </div>

        {item.notes && (
          <p className="text-zinc-500 text-sm mt-3">
            {item.notes}
          </p>
        )}

        <div className="flex items-end justify-between gap-4 mt-6">

          <div>

            <p className="text-xs uppercase tracking-[0.15em] text-zinc-600 font-bold">
              Price
            </p>

            <p className="text-3xl font-black text-emerald-400 mt-1">
              $
              {Number(
                item.price ?? 0
              ).toFixed(2)}
            </p>

          </div>

          <div className="text-right">

            <p className="text-xs uppercase tracking-[0.15em] text-zinc-600">
              Qty
            </p>

            <p className="font-black mt-1">
              {item.quantity ?? 0}
            </p>

          </div>

        </div>

      </div>
    </div>
  );
}