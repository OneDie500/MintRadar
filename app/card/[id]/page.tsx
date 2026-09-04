"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

import {
  readGuestCart,
  writeGuestCart,
} from "../../../lib/cart";

type Vendor = {
  id: string;
  business_name?: string | null;
  phone?: string | null;
  show_phone?: boolean | null;
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
  source_url?: string | null;
  updated_at?: string | null;
};

type CompDraft = {
  average: string;
  last_sold: string;
  source_url: string;
};

const MARKET_COMP_SOURCES = [
  "TCGplayer",
  "PriceCharting",
  "Collectr",
  "eBay",
] as const;

function buildCompDrafts(comps: Comp[] = []) {
  const drafts: Record<string, CompDraft> = {};

  for (const source of MARKET_COMP_SOURCES) {
    const comp = comps.find(
      (item) => (item.source || "").toLowerCase() === source.toLowerCase()
    );

    drafts[source] = {
      average: comp?.average == null ? "" : String(comp.average),
      last_sold: comp?.last_sold == null ? "" : String(comp.last_sold),
      source_url: comp?.source_url || "",
    };
  }

  return drafts;
}

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
  const router = useRouter();

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

  const [wishlistLoading, setWishlistLoading] =
    useState(false);

  const [isWishlisted, setIsWishlisted] =
    useState(false);

  const [wishlistMessage, setWishlistMessage] =
    useState("");

  const [showCustomerPrompt, setShowCustomerPrompt] =
    useState(false);

  const [savedListingIds, setSavedListingIds] =
    useState<Set<string>>(new Set());

  const [savingListingId, setSavingListingId] =
    useState<string | null>(null);

  const [cartListingIds, setCartListingIds] =
    useState<Set<string>>(new Set());

  const [cartLoadingId, setCartLoadingId] =
    useState<string | null>(null);

  const [messageLoadingId, setMessageLoadingId] =
    useState<string | null>(null);

  const [messageError, setMessageError] =
    useState("");

  const [currentVendorId, setCurrentVendorId] =
    useState<string | null>(null);
  const [isMarketAdmin, setIsMarketAdmin] =
    useState(false);

  const [marketEditorOpen, setMarketEditorOpen] =
    useState(false);

  const [marketCompDrafts, setMarketCompDrafts] =
    useState<Record<string, CompDraft>>({});

  const [marketCompSaving, setMarketCompSaving] =
    useState(false);

  const [marketCompMessage, setMarketCompMessage] =
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
                business_name,
                phone,
                show_phone
              )
            ),
            comps (
              source,
              last_sold,
              average,
              source_url,
              updated_at
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

  useEffect(() => {
    let cancelled = false;

    async function checkMarketAdminAccess() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          if (!cancelled) {
            setIsMarketAdmin(false);
          }
          return;
        }

        const response = await fetch("/api/admin/comps", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (!cancelled) {
          setIsMarketAdmin(response.ok);
        }
      } catch (err) {
        console.error("Market admin access check failed:", err);

        if (!cancelled) {
          setIsMarketAdmin(false);
        }
      }
    }

    checkMarketAdminAccess();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;

    async function loadWishlistStatus() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          console.error(
            "Wishlist session lookup error:",
            sessionError
          );
          return;
        }

        const user =
          session?.user ?? null;

        if (!user) {
          if (!cancelled) {
            setIsWishlisted(false);
          }
          return;
        }

        const {
          data: wishlistItem,
          error: wishlistError,
        } = await supabase
          .from("wishlists")
          .select("id")
          .eq("user_id", user.id)
          .eq("card_id", id)
          .maybeSingle();

        if (wishlistError) {
          console.error(
            "Wishlist status error:",
            wishlistError
          );
          return;
        }

        if (!cancelled) {
          setIsWishlisted(
            Boolean(wishlistItem)
          );
        }
      } catch (err) {
        console.error(
          "Unexpected wishlist status error:",
          err
        );
      }
    }

    loadWishlistStatus();

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleWishlist() {
    if (!card || wishlistLoading) {
      return;
    }

    setWishlistLoading(true);
    setWishlistMessage("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const user =
        session?.user ?? null;

      if (!user) {
        setShowCustomerPrompt(true);
        return;
      }

      if (isWishlisted) {
        const { error: removeError } =
          await supabase
            .from("wishlists")
            .delete()
            .eq("user_id", user.id)
            .eq("card_id", card.id);

        if (removeError) {
          throw removeError;
        }

        setIsWishlisted(false);
        setWishlistMessage(
          "Removed from your wishlist."
        );

        return;
      }

      const { error: addError } =
        await supabase
          .from("wishlists")
          .upsert(
            {
              user_id: user.id,
              card_id: card.id,
            },
            {
              onConflict:
                "user_id,card_id",
              ignoreDuplicates: true,
            }
          );

      if (addError) {
        throw addError;
      }

      setIsWishlisted(true);
      setWishlistMessage(
        "Added to your wishlist."
      );
    } catch (err: any) {
      console.error(
        "Wishlist update error:",
        err
      );

      setWishlistMessage(
        err?.message ||
          "MintRadar could not update your wishlist."
      );
    } finally {
      setWishlistLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSavedListings() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          console.error(
            "Saved listings session lookup error:",
            sessionError
          );
          return;
        }

        const user =
          session?.user ?? null;

        if (!user) {
          if (!cancelled) {
            setSavedListingIds(new Set());
          }
          return;
        }

        const {
          data: savedListings,
          error: savedListingsError,
        } = await supabase
          .from("saved_listings")
          .select("inventory_id")
          .eq("user_id", user.id);

        if (savedListingsError) {
          console.error(
            "Saved listings load error:",
            savedListingsError
          );
          return;
        }

        if (!cancelled) {
          setSavedListingIds(
            new Set(
              (savedListings || [])
                .map(
                  (row: {
                    inventory_id?: string | null;
                  }) => row.inventory_id
                )
                .filter(
                  (inventoryId): inventoryId is string =>
                    Boolean(inventoryId)
                )
            )
          );
        }
      } catch (err) {
        console.error(
          "Unexpected saved listings load error:",
          err
        );
      }
    }

    loadSavedListings();

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSavedListing(
    inventoryId?: string
  ) {
    if (
      !inventoryId ||
      savingListingId
    ) {
      return;
    }

    setSavingListingId(inventoryId);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const user =
        session?.user ?? null;

      if (!user) {
        setShowCustomerPrompt(true);
        return;
      }

      const isAlreadySaved =
        savedListingIds.has(inventoryId);

      if (isAlreadySaved) {
        const { error: removeError } =
          await supabase
            .from("saved_listings")
            .delete()
            .eq("user_id", user.id)
            .eq(
              "inventory_id",
              inventoryId
            );

        if (removeError) {
          throw removeError;
        }

        setSavedListingIds(
          (current) => {
            const next =
              new Set(current);

            next.delete(inventoryId);

            return next;
          }
        );

        return;
      }

      const { error: addError } =
        await supabase
          .from("saved_listings")
          .insert({
            user_id: user.id,
            inventory_id: inventoryId,
          });

      if (addError) {
        throw addError;
      }

      setSavedListingIds(
        (current) => {
          const next =
            new Set(current);

          next.add(inventoryId);

          return next;
        }
      );
    } catch (err) {
      console.error(
        "Saved listing update error:",
        err
      );
    } finally {
      setSavingListingId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadCartItems() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          console.error(
            "Cart session lookup error:",
            sessionError
          );
          return;
        }

        const user =
          session?.user ?? null;

        if (!user) {
          if (!cancelled) {
            setCartListingIds(
              new Set(
                readGuestCart().map(
                  (item) =>
                    item.inventory_id
                )
              )
            );
          }
          return;
        }

        const {
          data: cartItems,
          error: cartError,
        } = await supabase
          .from("cart_items")
          .select("inventory_id")
          .eq("user_id", user.id);

        if (cartError) {
          console.error(
            "Cart load error:",
            cartError
          );
          return;
        }

        if (!cancelled) {
          setCartListingIds(
            new Set(
              (cartItems || [])
                .map(
                  (row: {
                    inventory_id?: string | null;
                  }) => row.inventory_id
                )
                .filter(
                  (inventoryId): inventoryId is string =>
                    Boolean(inventoryId)
                )
            )
          );
        }
      } catch (err) {
        console.error(
          "Unexpected cart load error:",
          err
        );
      }
    }

    loadCartItems();

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleCartListing(
    inventoryId?: string
  ) {
    if (
      !inventoryId ||
      cartLoadingId
    ) {
      return;
    }

    setCartLoadingId(inventoryId);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const user =
        session?.user ?? null;

      if (!user) {
        const currentGuestCart =
          readGuestCart();

        const isAlreadyInCart =
          currentGuestCart.some(
            (item) =>
              item.inventory_id ===
              inventoryId
          );

        const nextGuestCart =
          isAlreadyInCart
            ? currentGuestCart.filter(
                (item) =>
                  item.inventory_id !==
                  inventoryId
              )
            : [
                ...currentGuestCart,
                {
                  inventory_id:
                    inventoryId,
                  quantity: 1,
                },
              ];

        writeGuestCart(
          nextGuestCart
        );

        setCartListingIds(
          new Set(
            nextGuestCart.map(
              (item) =>
                item.inventory_id
            )
          )
        );

        return;
      }

      const isAlreadyInCart =
        cartListingIds.has(inventoryId);

      if (isAlreadyInCart) {
        const { error: removeError } =
          await supabase
            .from("cart_items")
            .delete()
            .eq("user_id", user.id)
            .eq(
              "inventory_id",
              inventoryId
            );

        if (removeError) {
          throw removeError;
        }

        setCartListingIds(
          (current) => {
            const next =
              new Set(current);

            next.delete(inventoryId);

            return next;
          }
        );

        return;
      }

      const { error: addError } =
        await supabase
          .from("cart_items")
          .insert({
            user_id: user.id,
            inventory_id: inventoryId,
            quantity: 1,
          });

      if (addError) {
        throw addError;
      }

      setCartListingIds(
        (current) => {
          const next =
            new Set(current);

          next.add(inventoryId);

          return next;
        }
      );
    } catch (err) {
      console.error(
        "Cart update error:",
        err
      );
    } finally {
      setCartLoadingId(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentVendorMembership() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        const user =
          session?.user ?? null;

        if (!user) {
          if (!cancelled) {
            setCurrentVendorId(null);
          }
          return;
        }

        const {
          data: membership,
          error: membershipError,
        } = await supabase
          .from("vendor_members")
          .select("vendor_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (membershipError) {
          throw membershipError;
        }

        if (!cancelled) {
          setCurrentVendorId(
            membership?.vendor_id ?? null
          );
        }
      } catch (err) {
        console.error(
          "Vendor membership lookup error:",
          err
        );

        if (!cancelled) {
          setCurrentVendorId(null);
        }
      }
    }

    loadCurrentVendorMembership();

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleMessageVendor(
    item: InventoryItem
  ) {
    if (
      !item.id ||
      !item.vendor_id ||
      messageLoadingId
    ) {
      return;
    }

    setMessageLoadingId(item.id);
    setMessageError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        router.push(
          `/customer/login?next=${encodeURIComponent(
            `/card/${id}`
          )}`
        );
        return;
      }

      if (
        currentVendorId &&
        currentVendorId === item.vendor_id
      ) {
        throw new Error(
          "This is your own vendor listing."
        );
      }

      const {
        data: conversationId,
        error: conversationError,
      } = currentVendorId
        ? await supabase.rpc(
            "get_or_create_vendor_vendor_conversation",
            {
              p_target_vendor_id:
                item.vendor_id,
              p_inventory_id:
                item.id,
            }
          )
        : await supabase.rpc(
            "get_or_create_customer_vendor_conversation",
            {
              p_vendor_id:
                item.vendor_id,
              p_inventory_id:
                item.id,
            }
          );

      if (conversationError) {
        throw conversationError;
      }

      if (!conversationId) {
        throw new Error(
          "MintRadar could not start this conversation."
        );
      }

      router.push(
        `/messages/${conversationId}`
      );
    } catch (err: any) {
      const readableMessage =
        err?.message ||
        err?.details ||
        err?.hint ||
        (typeof err === "string"
          ? err
          : "MintRadar could not start this conversation.");

      console.error(
        "Message vendor error:",
        {
          message: err?.message,
          details: err?.details,
          hint: err?.hint,
          code: err?.code,
        }
      );

      setMessageError(
        readableMessage
      );
    } finally {
      setMessageLoadingId(null);
    }
  }

  function openMarketEditor() {
    if (!card) {
      return;
    }

    setMarketCompDrafts(
      buildCompDrafts(card.comps || [])
    );
    setMarketCompMessage("");
    setMarketEditorOpen(true);
  }

  function updateMarketCompDraft(
    source: string,
    field: keyof CompDraft,
    value: string
  ) {
    setMarketCompDrafts((current) => ({
      ...current,
      [source]: {
        ...(current[source] || {
          average: "",
          last_sold: "",
          source_url: "",
        }),
        [field]: value,
      },
    }));
  }

  async function saveMarketComps() {
    if (!card || marketCompSaving) {
      return;
    }

    setMarketCompSaving(true);
    setMarketCompMessage("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session?.access_token) {
        throw new Error("Your admin session has expired. Please sign in again.");
      }

      const comps = MARKET_COMP_SOURCES.map((source) => {
        const draft =
          marketCompDrafts[source] || {
            average: "",
            last_sold: "",
            source_url: "",
          };

        return {
          source,
          average:
            draft.average.trim() === ""
              ? null
              : Number(draft.average),
          last_sold:
            draft.last_sold.trim() === ""
              ? null
              : Number(draft.last_sold),
          source_url:
            draft.source_url.trim() === ""
              ? null
              : draft.source_url.trim(),
        };
      });

      const response = await fetch("/api/admin/comps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          cardId: card.id,
          comps,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.error ||
            "MintRadar could not save the market comps."
        );
      }

      setCard((current) =>
        current
          ? {
              ...current,
              comps: Array.isArray(result?.comps)
                ? result.comps
                : current.comps,
            }
          : current
      );

      setMarketCompMessage("Market comps saved.");
      setMarketEditorOpen(false);
    } catch (err: any) {
      console.error("Save market comps error:", err);
      setMarketCompMessage(
        err?.message ||
          "MintRadar could not save the market comps."
      );
    } finally {
      setMarketCompSaving(false);
    }
  }

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

      {/* CUSTOMER ACCOUNT PROMPT */}

      {showCustomerPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-5"
          onClick={() =>
            setShowCustomerPrompt(false)
          }
        >
          <div
            className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <p className="text-xs font-black uppercase tracking-[0.25em] text-emerald-400">
              MintRadar Wishlist
            </p>

            <h2 className="mt-3 text-3xl font-black">
              Save this card?
            </h2>

            <p className="mt-3 leading-7 text-zinc-400">
              Create a customer account or sign in to
              save cards to your wishlist and keep track
              of what you&apos;re hunting for.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">

              <button
                type="button"
                onClick={() =>
                  setShowCustomerPrompt(false)
                }
                className="rounded-xl border border-zinc-800 px-4 py-3 font-black text-zinc-300 transition hover:border-zinc-600 hover:text-white"
              >
                Not Now
              </button>

              <Link
                href="/customer/signup"
                className="rounded-xl bg-emerald-400 px-4 py-3 text-center font-black text-black transition hover:bg-emerald-300"
              >
                Create Customer Account
              </Link>

            </div>
          </div>
        </div>
      )}

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

            {/* WISHLIST */}

            <div className="mt-6">

              <button
                type="button"
                onClick={handleWishlist}
                disabled={wishlistLoading}
                className={`inline-flex items-center justify-center rounded-xl px-5 py-3 font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  isWishlisted
                    ? "bg-emerald-400 text-black hover:bg-emerald-300"
                    : "bg-zinc-950 border border-zinc-800 text-white hover:border-emerald-400 hover:text-emerald-400"
                }`}
              >
                {wishlistLoading
                  ? "Saving..."
                  : isWishlisted
                    ? "♥ Wishlisted"
                    : "♡ Add to Wishlist"}
              </button>

              {wishlistMessage && (
                <p className="text-sm text-zinc-500 mt-3">
                  {wishlistMessage}
                </p>
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

        {messageError && (
          <div className="mt-8 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-300">
            {messageError}
          </div>
        )}

        <section className="mt-12">

          <p className="text-emerald-400 text-xs uppercase tracking-[0.2em] font-bold">
            Available Now
          </p>

          <h2 className="text-3xl sm:text-4xl font-black mt-2">
            Shop This Card
          </h2>

          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mt-2">

            <p className="text-zinc-500">
              Compare raw and graded copies
              currently available from MintRadar vendors.
            </p>

            <Link
              href="/cart"
              className="inline-flex items-center justify-center bg-zinc-950 border border-zinc-800 hover:border-emerald-400 hover:text-emerald-400 rounded-xl px-4 py-2.5 text-sm font-black transition"
            >
              🛒 View Cart
              {cartListingIds.size > 0
                ? ` (${cartListingIds.size})`
                : ""}
            </Link>

          </div>

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


        <section className="mb-8 overflow-hidden rounded-2xl border border-emerald-400/30 bg-zinc-950">
          <div className="border-b border-zinc-800 bg-emerald-400/5 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-400">
                  📡 Market Radar
                </p>
                <h2 className="mt-1 text-2xl font-black text-white">
                  Market Comps
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(card.comps || []).length > 0 && (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-300">
                    Manually Verified
                  </span>
                )}

                {isMarketAdmin && (
                  <button
                    type="button"
                    onClick={openMarketEditor}
                    className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-zinc-200 transition hover:border-emerald-400/50 hover:text-emerald-300"
                  >
                    ✏️ Edit Market Comps
                  </button>
                )}
              </div>
            </div>
          </div>

          {(card.comps || []).length === 0 ? (
            <div className="px-5 py-8">
              <p className="text-lg font-black text-zinc-200">
                Market data coming soon.
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                MintRadar has not added verified marketplace comps for this
                card yet.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-px bg-zinc-800 sm:grid-cols-2 lg:grid-cols-4">
                {(card.comps || []).map((comp, index) => {
                  const marketValue =
                    comp.average == null ? null : Number(comp.average);
                  const lastSold =
                    comp.last_sold == null ? null : Number(comp.last_sold);

                  return (
                    <div
                      key={`${comp.source || "source"}-${index}`}
                      className="bg-zinc-950 p-5"
                    >
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">
                        {comp.source || "Market Source"}
                      </p>

                      <p className="mt-2 text-2xl font-black text-zinc-100">
                        {marketValue != null && Number.isFinite(marketValue)
                          ? `$${marketValue.toFixed(2)}`
                          : "—"}
                      </p>

                      {lastSold != null && Number.isFinite(lastSold) && (
                        <p className="mt-2 text-xs text-zinc-500">
                          Last observed sale: ${lastSold.toFixed(2)}
                        </p>
                      )}

                      {comp.updated_at && (
                        <p className="mt-1 text-xs text-zinc-600">
                          Updated{" "}
                          {new Date(comp.updated_at).toLocaleDateString()}
                        </p>
                      )}

                      {comp.source_url && (
                        <a
                          href={comp.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-block text-xs font-black text-emerald-400 transition hover:text-emerald-300"
                        >
                          View Source ↗
                        </a>
                      )}
                    </div>
                  );
                })}

                {(() => {
                  const values = (card.comps || [])
                    .map((comp) => Number(comp.average))
                    .filter(
                      (value) => Number.isFinite(value) && value > 0
                    );

                  const mintRadarMarket =
                    values.length > 0
                      ? values.reduce((sum, value) => sum + value, 0) /
                        values.length
                      : null;

                  return (
                    <div className="bg-emerald-400/10 p-5">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-400">
                        MintRadar Market
                      </p>
                      <p className="mt-2 text-2xl font-black text-emerald-300">
                        {mintRadarMarket != null
                          ? `$${mintRadarMarket.toFixed(2)}`
                          : "—"}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">
                        Average of the verified market values currently
                        available for this card.
                      </p>
                    </div>
                  );
                })()}
              </div>

              <div className="px-5 py-4 text-xs leading-5 text-zinc-500">
                Marketplace comps are manually researched and entered into
                MintRadar. Values may change after they are recorded. Use the
                source link when available to review the referenced
                marketplace page.
              </div>
            </>
          )}
        </section>

                    {gradedListings.map(
                      (item) => (
                        <GradedListingCard
                          key={item.id}
                          item={item}
                          card={card}
                          isSaved={
                            item.id
                              ? savedListingIds.has(
                                  item.id
                                )
                              : false
                          }
                          saveLoading={
                            savingListingId ===
                            item.id
                          }
                          onSaveListing={() =>
                            handleSavedListing(
                              item.id
                            )
                          }
                          isInCart={
                            item.id
                              ? cartListingIds.has(
                                  item.id
                                )
                              : false
                          }
                          cartLoading={
                            cartLoadingId ===
                            item.id
                          }
                          onCartListing={() =>
                            handleCartListing(
                              item.id
                            )
                          }
                          messageLoading={
                            messageLoadingId ===
                            item.id
                          }
                          onMessageVendor={() =>
                            handleMessageVendor(
                              item
                            )
                          }
                          isOwnVendorListing={
                            Boolean(
                              currentVendorId &&
                              currentVendorId ===
                                item.vendor_id
                            )
                          }
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
                          isSaved={
                            item.id
                              ? savedListingIds.has(
                                  item.id
                                )
                              : false
                          }
                          saveLoading={
                            savingListingId ===
                            item.id
                          }
                          onSaveListing={() =>
                            handleSavedListing(
                              item.id
                            )
                          }
                          isInCart={
                            item.id
                              ? cartListingIds.has(
                                  item.id
                                )
                              : false
                          }
                          cartLoading={
                            cartLoadingId ===
                            item.id
                          }
                          onCartListing={() =>
                            handleCartListing(
                              item.id
                            )
                          }
                          messageLoading={
                            messageLoadingId ===
                            item.id
                          }
                          onMessageVendor={() =>
                            handleMessageVendor(
                              item
                            )
                          }
                          isOwnVendorListing={
                            Boolean(
                              currentVendorId &&
                              currentVendorId ===
                                item.vendor_id
                            )
                          }
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
      {isMarketAdmin && marketEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-emerald-400/30 bg-zinc-950 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-950 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                  MintRadar Admin
                </p>
                <h2 className="mt-1 text-xl font-black text-white">
                  Edit Market Comps
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {card.name || "Card"} · {card.set_name || "Unknown Set"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!marketCompSaving) {
                    setMarketEditorOpen(false);
                  }
                }}
                className="rounded-xl border border-zinc-800 px-3 py-2 text-sm font-bold text-zinc-400 transition hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 p-5">
              {MARKET_COMP_SOURCES.map((source) => {
                const draft =
                  marketCompDrafts[source] || {
                    average: "",
                    last_sold: "",
                    source_url: "",
                  };

                return (
                  <div
                    key={source}
                    className="rounded-2xl border border-zinc-800 bg-black p-4"
                  >
                    <h3 className="font-black text-zinc-100">
                      {source}
                    </h3>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
                          Market / Reference Value
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.average}
                          onChange={(event) =>
                            updateMarketCompDraft(
                              source,
                              "average",
                              event.target.value
                            )
                          }
                          placeholder="0.00"
                          className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-white outline-none transition focus:border-emerald-400/50"
                        />
                      </label>

                      <label className="block">
                        <span className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
                          Last Observed Sale
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft.last_sold}
                          onChange={(event) =>
                            updateMarketCompDraft(
                              source,
                              "last_sold",
                              event.target.value
                            )
                          }
                          placeholder="Optional"
                          className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-white outline-none transition focus:border-emerald-400/50"
                        />
                      </label>
                    </div>

                    <label className="mt-4 block">
                      <span className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
                        Exact Source URL
                      </span>
                      <input
                        type="url"
                        value={draft.source_url}
                        onChange={(event) =>
                          updateMarketCompDraft(
                            source,
                            "source_url",
                            event.target.value
                          )
                        }
                        placeholder="https://..."
                        className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-white outline-none transition focus:border-emerald-400/50"
                      />
                    </label>

                    <p className="mt-3 text-xs leading-5 text-zinc-600">
                      Leave all three fields blank to remove this source from
                      the card.
                    </p>
                  </div>
                );
              })}

              {marketCompMessage && (
                <p className="rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm text-zinc-300">
                  {marketCompMessage}
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={marketCompSaving}
                  onClick={() => setMarketEditorOpen(false)}
                  className="rounded-xl border border-zinc-800 px-4 py-3 text-sm font-black text-zinc-300 transition hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={marketCompSaving}
                  onClick={saveMarketComps}
                  className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {marketCompSaving
                    ? "Saving..."
                    : "Save Market Comps"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

// =============================================
// GRADED LISTING
// =============================================

function GradedListingCard({
  item,
  card,
  isSaved,
  saveLoading,
  onSaveListing,
  isInCart,
  cartLoading,
  onCartListing,
  messageLoading,
  onMessageVendor,
  isOwnVendorListing,
}: {
  item: InventoryItem;
  card: Card;
  isSaved: boolean;
  saveLoading: boolean;
  onSaveListing: () => void;
  isInCart: boolean;
  cartLoading: boolean;
  onCartListing: () => void;
  messageLoading: boolean;
  onMessageVendor: () => void;
  isOwnVendorListing: boolean;
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

        <button
          type="button"
          onClick={onSaveListing}
          disabled={saveLoading}
          className={`w-full mt-5 rounded-xl px-4 py-3 font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
            isSaved
              ? "bg-emerald-400 text-black hover:bg-emerald-300"
              : "bg-black border border-zinc-800 text-white hover:border-emerald-400 hover:text-emerald-400"
          }`}
        >
          {saveLoading
            ? "Saving..."
            : isSaved
              ? "♥ Listing Saved"
              : "♡ Save This Listing"}
        </button>

        <button
          type="button"
          onClick={onCartListing}
          disabled={cartLoading}
          className={`w-full mt-3 rounded-xl px-4 py-3 font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
            isInCart
              ? "bg-white text-black hover:bg-zinc-200"
              : "bg-emerald-400 text-black hover:bg-emerald-300"
          }`}
        >
          {cartLoading
            ? "Updating Cart..."
            : isInCart
              ? "✓ In Cart · Remove"
              : "🛒 Add to Cart"}
        </button>

        <button
          type="button"
          onClick={onMessageVendor}
          disabled={
            messageLoading ||
            isOwnVendorListing
          }
          className="w-full mt-3 rounded-xl border border-emerald-400/30 bg-black px-4 py-3 font-black text-emerald-300 transition hover:border-emerald-400 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isOwnVendorListing
            ? "Your Vendor Listing"
            : messageLoading
              ? "Opening Messages..."
              : "💬 Message Vendor"}
        </button>

        {item.vendors?.show_phone &&
          item.vendors.phone?.trim() && (
          <a
            href={`tel:${item.vendors.phone.trim()}`}
            className="flex w-full mt-3 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
          >
            📞 Call Vendor
          </a>
        )}

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
  isSaved,
  saveLoading,
  onSaveListing,
  isInCart,
  cartLoading,
  onCartListing,
  messageLoading,
  onMessageVendor,
  isOwnVendorListing,
}: {
  item: InventoryItem;
  card: Card;
  isSaved: boolean;
  saveLoading: boolean;
  onSaveListing: () => void;
  isInCart: boolean;
  cartLoading: boolean;
  onCartListing: () => void;
  messageLoading: boolean;
  onMessageVendor: () => void;
  isOwnVendorListing: boolean;
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

        <button
          type="button"
          onClick={onSaveListing}
          disabled={saveLoading}
          className={`w-full mt-5 rounded-xl px-4 py-3 font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
            isSaved
              ? "bg-emerald-400 text-black hover:bg-emerald-300"
              : "bg-black border border-zinc-800 text-white hover:border-emerald-400 hover:text-emerald-400"
          }`}
        >
          {saveLoading
            ? "Saving..."
            : isSaved
              ? "♥ Listing Saved"
              : "♡ Save This Listing"}
        </button>

        <button
          type="button"
          onClick={onCartListing}
          disabled={cartLoading}
          className={`w-full mt-3 rounded-xl px-4 py-3 font-black transition disabled:cursor-not-allowed disabled:opacity-60 ${
            isInCart
              ? "bg-white text-black hover:bg-zinc-200"
              : "bg-emerald-400 text-black hover:bg-emerald-300"
          }`}
        >
          {cartLoading
            ? "Updating Cart..."
            : isInCart
              ? "✓ In Cart · Remove"
              : "🛒 Add to Cart"}
        </button>

        <button
          type="button"
          onClick={onMessageVendor}
          disabled={
            messageLoading ||
            isOwnVendorListing
          }
          className="w-full mt-3 rounded-xl border border-emerald-400/30 bg-black px-4 py-3 font-black text-emerald-300 transition hover:border-emerald-400 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isOwnVendorListing
            ? "Your Vendor Listing"
            : messageLoading
              ? "Opening Messages..."
              : "💬 Message Vendor"}
        </button>

        {item.vendors?.show_phone &&
          item.vendors.phone?.trim() && (
          <a
            href={`tel:${item.vendors.phone.trim()}`}
            className="flex w-full mt-3 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
          >
            📞 Call Vendor
          </a>
        )}

      </div>
    </div>
  );
}