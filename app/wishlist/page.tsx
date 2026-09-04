"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type WishlistCard = {
  id: string;
  name?: string | null;
  set_name?: string | null;
  card_number?: string | null;
  image_url?: string | null;
  rarity?: string | null;
  category?: string | null;
  edition?: string | null;
  finish?: string | null;
};

type WishlistRow = {
  id: string;
  card_id: string;
  created_at?: string | null;
};

export default function WishlistPage() {
  const [cards, setCards] = useState<WishlistCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadWishlist() {
      try {
        setLoading(true);
        setError("");

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;
        if (cancelled) return;

        const user = session?.user ?? null;

        if (!user) {
          setSignedIn(false);
          setCards([]);
          return;
        }

        setSignedIn(true);

        const {
          data: wishlistRows,
          error: wishlistError,
        } = await supabase
          .from("wishlists")
          .select("id, card_id, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (wishlistError) throw wishlistError;

        const rows = (wishlistRows || []) as WishlistRow[];
        const cardIds = rows
          .map((row) => row.card_id)
          .filter(Boolean);

        if (cardIds.length === 0) {
          if (!cancelled) setCards([]);
          return;
        }

        const { data: cardRows, error: cardsError } = await supabase
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
            finish
          `)
          .in("id", cardIds);

        if (cardsError) throw cardsError;

        const cardMap = new Map(
          ((cardRows || []) as WishlistCard[]).map((card) => [
            card.id,
            card,
          ])
        );

        const orderedCards = cardIds
          .map((cardId) => cardMap.get(cardId))
          .filter((card): card is WishlistCard => Boolean(card));

        if (!cancelled) setCards(orderedCards);
      } catch (err: any) {
        console.error("Wishlist page load error:", err);

        if (!cancelled) {
          setError(
            err?.message || "MintRadar could not load your wishlist."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadWishlist();

    return () => {
      cancelled = true;
    };
  }, []);

  async function removeFromWishlist(cardId: string) {
    if (removingId) return;

    setRemovingId(cardId);
    setError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = session?.user ?? null;

      if (!user) {
        setSignedIn(false);
        return;
      }

      const { error: removeError } = await supabase
        .from("wishlists")
        .delete()
        .eq("user_id", user.id)
        .eq("card_id", cardId);

      if (removeError) throw removeError;

      setCards((current) =>
        current.filter((card) => card.id !== cardId)
      );
    } catch (err: any) {
      console.error("Wishlist remove error:", err);
      setError(
        err?.message || "MintRadar could not remove that card."
      );
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5">
          <Link href="/" className="text-xl font-black">
            Mint<span className="text-emerald-400">Radar</span>
          </Link>

        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:py-14">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-400">
          MintRadar Wishlist
        </p>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight sm:text-6xl">
              Your Hunt List
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-500">
              Keep the cards you&apos;re hunting for in one place,
              then jump straight back into the MintRadar marketplace.
            </p>
          </div>

          {signedIn && !loading && (
            <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-black text-emerald-300">
              {cards.length} card{cards.length === 1 ? "" : "s"}
            </div>
          )}
        </div>

        {loading ? (
          <div className="mt-10 rounded-3xl border border-zinc-900 bg-zinc-950 p-10 text-center text-zinc-500">
            Loading your wishlist...
          </div>
        ) : signedIn === false ? (
          <div className="mt-10 rounded-3xl border border-zinc-900 bg-zinc-950 p-8 sm:p-10">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Account Required
            </p>
            <h2 className="mt-3 text-3xl font-black">
              Sign in to see your wishlist.
            </h2>
            <p className="mt-3 max-w-xl text-zinc-500">
              Wishlists are tied to your MintRadar account so your hunt
              list stays with you.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/customer/login"
                className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black transition hover:bg-emerald-300"
              >
                Customer Login
              </Link>
              <Link
                href="/customer/signup"
                className="rounded-xl border border-zinc-800 px-5 py-3 font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
              >
                Create Account
              </Link>
            </div>
          </div>
        ) : error ? (
          <div className="mt-10 rounded-3xl border border-red-400/30 bg-zinc-950 p-8">
            <p className="text-sm font-black text-red-300">
              {error}
            </p>
          </div>
        ) : cards.length === 0 ? (
          <div className="mt-10 rounded-3xl border border-zinc-900 bg-zinc-950 p-10 text-center">
            <div className="text-5xl">♡</div>
            <h2 className="mt-4 text-3xl font-black">
              Your wishlist is empty.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-zinc-500">
              Find a card you want to keep an eye on and hit
              &ldquo;Add to Wishlist.&rdquo;
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex rounded-xl bg-emerald-400 px-5 py-3 font-black text-black transition hover:bg-emerald-300"
            >
              Browse Cards
            </Link>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cards.map((card) => (
              <article
                key={card.id}
                className="group overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950 transition hover:-translate-y-1 hover:border-emerald-400/50"
              >
                <Link href={`/card/${card.id}`} className="block p-5">
                  <div className="aspect-[3/4] overflow-hidden rounded-2xl border border-zinc-900 bg-black">
                    {card.image_url ? (
                      <img
                        src={card.image_url}
                        alt={card.name || "Card"}
                        className="h-full w-full object-contain transition duration-200 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-zinc-700">
                        No Image
                      </div>
                    )}
                  </div>

                  <div className="mt-5">
                    {card.category && (
                      <span className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300">
                        {card.category}
                      </span>
                    )}

                    <h2 className="mt-3 text-xl font-black leading-tight transition group-hover:text-emerald-300">
                      {card.name || "Untitled Card"}
                    </h2>

                    <p className="mt-1 text-sm text-zinc-500">
                      {card.set_name || "Unknown Set"}
                      {card.card_number
                        ? ` #${card.card_number}`
                        : ""}
                    </p>

                    {(card.rarity || card.edition || card.finish) && (
                      <p className="mt-3 text-xs text-zinc-600">
                        {[card.rarity, card.edition, card.finish]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    )}
                  </div>
                </Link>

                <div className="border-t border-zinc-900 p-4">
                  <button
                    type="button"
                    onClick={() => removeFromWishlist(card.id)}
                    disabled={removingId === card.id}
                    className="w-full rounded-xl border border-zinc-800 px-4 py-2.5 text-sm font-black text-zinc-300 transition hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {removingId === card.id
                      ? "Removing..."
                      : "♥ Remove from Wishlist"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
