"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import {
  mergeGuestCartIntoAccount,
  readGuestCart,
  writeGuestCart,
} from "../../lib/cart";

type CartRow = {
  id: string;
  inventory_id: string;
  quantity: number;
  isGuest?: boolean;
  inventory?: {
    id: string;
    quantity?: number | null;
    price?: number | null;
    listing_type?: string | null;
    condition?: string | null;
    grading_company?: string | null;
    grade?: string | null;
    cert_number?: string | null;
    cards?: {
      id?: string | null;
      name?: string | null;
      set_name?: string | null;
      card_number?: string | null;
      image_url?: string | null;
    } | null;
    vendors?: {
      id?: string | null;
      business_name?: string | null;
    } | null;
  } | null;
};

export default function CartPage() {
  const [items, setItems] =
    useState<CartRow[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [message, setMessage] =
    useState("");

  const [updatingId, setUpdatingId] =
    useState<string | null>(null);

  const [signedIn, setSignedIn] =
    useState<boolean | null>(null);

  useEffect(() => {
    loadCart();
  }, []);

  async function loadCart() {
    try {
      setLoading(true);
      setMessage("");

      const {
        data: { session },
        error: sessionError,
      } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const user =
        session?.user ?? null;

      if (!user) {
        setSignedIn(false);

        const guestItems =
          readGuestCart();

        if (
          guestItems.length ===
          0
        ) {
          setItems([]);
          return;
        }

        const inventoryIds =
          guestItems.map(
            (item) =>
              item.inventory_id
          );

        const {
          data:
            guestInventory,
          error:
            guestInventoryError,
        } = await supabase
          .from("inventory")
          .select(`
            id,
            quantity,
            price,
            listing_type,
            condition,
            grading_company,
            grade,
            cert_number,
            cards (
              id,
              name,
              set_name,
              card_number,
              image_url
            ),
            vendors (
              id,
              business_name
            )
          `)
          .in(
            "id",
            inventoryIds
          );

        if (
          guestInventoryError
        ) {
          throw guestInventoryError;
        }

        const inventoryMap =
          new Map(
            (
              guestInventory ||
              []
            ).map(
              (inventory: any) => [
                inventory.id,
                inventory,
              ]
            )
          );

        const hydrated =
          guestItems
            .map(
              (
                guestItem
              ) => {
                const inventory =
                  inventoryMap.get(
                    guestItem.inventory_id
                  );

                if (
                  !inventory
                ) {
                  return null;
                }

                return {
                  id:
                    guestItem.inventory_id,
                  inventory_id:
                    guestItem.inventory_id,
                  quantity:
                    Math.max(
                      Math.min(
                        Number(
                          guestItem.quantity ||
                            1
                        ),
                        Math.max(
                          Number(
                            inventory.quantity ||
                              0
                          ),
                          1
                        )
                      ),
                      1
                    ),
                  isGuest: true,
                  inventory,
                } as CartRow;
              }
            )
            .filter(
              (
                row
              ): row is CartRow =>
                Boolean(row)
            );

        setItems(hydrated);

        writeGuestCart(
          hydrated.map(
            (row) => ({
              inventory_id:
                row.inventory_id,
              quantity:
                row.quantity,
            })
          )
        );

        return;
      }

      setSignedIn(true);

      // Merge any browser guest cart into the signed-in
      // account cart before loading the final cart.
      await mergeGuestCartIntoAccount(
        user.id
      );

      const {
        data,
        error,
      } = await supabase
        .from("cart_items")
        .select(`
          id,
          inventory_id,
          quantity,
          inventory (
            id,
            quantity,
            price,
            listing_type,
            condition,
            grading_company,
            grade,
            cert_number,
            cards (
              id,
              name,
              set_name,
              card_number,
              image_url
            ),
            vendors (
              id,
              business_name
            )
          )
        `)
        .eq(
          "user_id",
          user.id
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        );

      if (error) {
        throw error;
      }

      setItems(
        (
          data ||
          []
        ) as unknown as CartRow[]
      );
    } catch (
      err: any
    ) {
      console.error(
        "Cart load error:",
        err
      );

      setMessage(
        err?.message ||
          "MintRadar could not load your cart."
      );
    } finally {
      setLoading(false);
    }
  }

  async function changeQuantity(
    row: CartRow,
    change: number
  ) {
    if (
      !row.inventory ||
      updatingId
    ) {
      return;
    }

    const available =
      Math.max(
        Number(
          row.inventory.quantity ??
            0
        ),
        0
      );

    const nextQuantity =
      Math.min(
        Math.max(
          row.quantity +
            change,
          1
        ),
        Math.max(
          available,
          1
        )
      );

    if (
      nextQuantity ===
      row.quantity
    ) {
      return;
    }

    setUpdatingId(
      row.id
    );
    setMessage("");

    try {
      if (
        row.isGuest
      ) {
        const nextItems =
          items.map(
            (item) =>
              item.id ===
              row.id
                ? {
                    ...item,
                    quantity:
                      nextQuantity,
                  }
                : item
          );

        setItems(
          nextItems
        );

        writeGuestCart(
          nextItems.map(
            (item) => ({
              inventory_id:
                item.inventory_id,
              quantity:
                item.quantity,
            })
          )
        );

        return;
      }

      const {
        error,
      } = await supabase
        .from("cart_items")
        .update({
          quantity:
            nextQuantity,
          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          row.id
        );

      if (error) {
        throw error;
      }

      setItems(
        (
          current
        ) =>
          current.map(
            (item) =>
              item.id ===
              row.id
                ? {
                    ...item,
                    quantity:
                      nextQuantity,
                  }
                : item
          )
      );
    } catch (
      err: any
    ) {
      console.error(
        "Cart quantity error:",
        err
      );

      setMessage(
        err?.message ||
          "Quantity could not be updated."
      );
    } finally {
      setUpdatingId(
        null
      );
    }
  }

  async function removeItem(
    row: CartRow
  ) {
    if (
      updatingId
    ) {
      return;
    }

    setUpdatingId(
      row.id
    );
    setMessage("");

    try {
      if (
        row.isGuest
      ) {
        const nextItems =
          items.filter(
            (item) =>
              item.id !==
              row.id
          );

        setItems(
          nextItems
        );

        writeGuestCart(
          nextItems.map(
            (item) => ({
              inventory_id:
                item.inventory_id,
              quantity:
                item.quantity,
            })
          )
        );

        return;
      }

      const {
        error,
      } = await supabase
        .from("cart_items")
        .delete()
        .eq(
          "id",
          row.id
        );

      if (error) {
        throw error;
      }

      setItems(
        (
          current
        ) =>
          current.filter(
            (item) =>
              item.id !==
              row.id
          )
      );
    } catch (
      err: any
    ) {
      console.error(
        "Cart remove error:",
        err
      );

      setMessage(
        err?.message ||
          "Item could not be removed."
      );
    } finally {
      setUpdatingId(
        null
      );
    }
  }

  const subtotal =
    useMemo(() => {
      return items.reduce(
        (
          total,
          row
        ) => {
          const price =
            Number(
              row.inventory
                ?.price ??
                0
            );

          return (
            total +
            price *
              Number(
                row.quantity ||
                  0
              )
          );
        },
        0
      );
    }, [items]);

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">
          Loading cart...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-5 py-8">
      <div className="max-w-5xl mx-auto">

        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">

          <div>
            <Link
              href="/"
              className="text-sm text-zinc-500 hover:text-emerald-400 transition"
            >
              ← Back to
              MintRadar
            </Link>

            <p className="text-emerald-400 text-xs uppercase tracking-[0.22em] font-black mt-6">
              MintRadar
              Marketplace
            </p>

            <h1 className="text-4xl sm:text-5xl font-black mt-2">
              Your Cart
            </h1>

            <p className="text-zinc-500 mt-2">
              {signedIn
                ? "Your cart is saved to your MintRadar account."
                : "Guest cart · no account required to shop."}
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl px-5 py-4">
            <p className="text-xs text-zinc-600 uppercase tracking-wider font-bold">
              Cart Subtotal
            </p>

            <p className="text-3xl font-black text-emerald-400 mt-1">
              $
              {subtotal.toFixed(
                2
              )}
            </p>
          </div>

        </header>

        {message && (
          <div className="mt-6 bg-red-500/10 border border-red-500/30 text-red-300 rounded-2xl p-4">
            {message}
          </div>
        )}

        {items.length ===
        0 ? (
          <section className="mt-8 bg-zinc-950 border border-zinc-900 rounded-3xl p-10 text-center">

            <h2 className="text-2xl font-black">
              Your cart is
              empty.
            </h2>

            <p className="text-zinc-500 mt-3">
              Find a listing you
              want and hit Add
              to Cart.
            </p>

            <Link
              href="/"
              className="inline-flex mt-6 bg-emerald-400 hover:bg-emerald-300 text-black rounded-xl px-5 py-3 font-black transition"
            >
              Browse Inventory
            </Link>

          </section>
        ) : (
          <section className="mt-8 space-y-4">

            {items.map(
              (
                row
              ) => {
                const inventory =
                  row.inventory;

                const card =
                  inventory?.cards;

                const vendor =
                  inventory?.vendors;

                const available =
                  Math.max(
                    Number(
                      inventory?.quantity ??
                        0
                    ),
                    0
                  );

                const lineTotal =
                  Number(
                    inventory?.price ??
                      0
                  ) *
                  Number(
                    row.quantity ||
                      0
                  );

                const listingLabel =
                  inventory
                    ?.listing_type ===
                  "graded"
                    ? `${inventory.grading_company || "Graded"} ${inventory.grade || ""}`.trim()
                    : inventory
                        ?.condition ||
                      "Raw";

                return (
                  <article
                    key={
                      row.id
                    }
                    className="bg-zinc-950 border border-zinc-900 rounded-3xl p-5 sm:p-6"
                  >

                    <div className="flex flex-col sm:flex-row gap-5">

                      <div className="w-full sm:w-28 aspect-[3/4] bg-black border border-zinc-900 rounded-2xl overflow-hidden shrink-0">
                        {card?.image_url ? (
                          <img
                            src={
                              card.image_url
                            }
                            alt={
                              card.name ||
                              "Card"
                            }
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs">
                            No Image
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">

                        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">

                          <div>
                            <p className="text-xs uppercase tracking-[0.15em] text-emerald-400 font-black">
                              {listingLabel}
                            </p>

                            <h2 className="text-2xl font-black mt-1">
                              {card?.name ||
                                "Collectible"}
                            </h2>

                            <p className="text-zinc-500 text-sm mt-1">
                              {card?.set_name}
                              {card?.card_number
                                ? ` #${card.card_number}`
                                : ""}
                            </p>

                            <p className="text-zinc-400 text-sm mt-3">
                              Sold by{" "}
                              <span className="font-black text-white">
                                {vendor
                                  ?.business_name ||
                                  "MintRadar Seller"}
                              </span>
                            </p>

                            {inventory?.cert_number && (
                              <p className="text-zinc-600 text-xs mt-2">
                                Cert #
                                {
                                  inventory.cert_number
                                }
                              </p>
                            )}
                          </div>

                          <div className="lg:text-right">
                            <p className="text-2xl font-black text-emerald-400">
                              $
                              {Number(
                                inventory?.price ??
                                  0
                              ).toFixed(
                                2
                              )}
                            </p>

                            <p className="text-zinc-600 text-xs mt-1">
                              each
                            </p>
                          </div>

                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-5 pt-5 border-t border-zinc-900">

                          <div className="flex items-center gap-2">

                            <button
                              type="button"
                              onClick={() =>
                                changeQuantity(
                                  row,
                                  -1
                                )
                              }
                              disabled={
                                updatingId ===
                                  row.id ||
                                row.quantity <=
                                  1
                              }
                              className="w-10 h-10 rounded-xl bg-black border border-zinc-800 font-black disabled:opacity-40"
                            >
                              −
                            </button>

                            <div className="min-w-14 h-10 rounded-xl bg-black border border-zinc-800 flex items-center justify-center font-black">
                              {
                                row.quantity
                              }
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                changeQuantity(
                                  row,
                                  1
                                )
                              }
                              disabled={
                                updatingId ===
                                  row.id ||
                                row.quantity >=
                                  available
                              }
                              className="w-10 h-10 rounded-xl bg-black border border-zinc-800 font-black disabled:opacity-40"
                            >
                              +
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                removeItem(
                                  row
                                )
                              }
                              disabled={
                                updatingId ===
                                row.id
                              }
                              className="w-10 h-10 rounded-xl bg-black border border-zinc-800 text-zinc-500 hover:border-red-400/50 hover:bg-red-400/10 hover:text-red-300 transition disabled:opacity-40 flex items-center justify-center"
                              aria-label="Remove from cart"
                              title="Remove from cart"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="w-4 h-4"
                                aria-hidden="true"
                              >
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M19 6l-1 14H6L5 6" />
                                <path d="M10 11v5" />
                                <path d="M14 11v5" />
                              </svg>
                            </button>

                            <span className="text-xs text-zinc-600 ml-2">
                              {
                                available
                              }{" "}
                              available
                            </span>

                          </div>

                          <div className="flex items-center gap-4">

                            <div className="text-right">
                              <p className="text-xs text-zinc-600 uppercase tracking-wider font-bold">
                                Total
                              </p>

                              <p className="text-xl font-black">
                                $
                                {lineTotal.toFixed(
                                  2
                                )}
                              </p>
                            </div>

                          </div>

                        </div>

                      </div>

                    </div>

                  </article>
                );
              }
            )}

            <div className="bg-emerald-400 text-black rounded-3xl p-6 sm:p-8 mt-6">

              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">

                <div>
                  <p className="text-xs uppercase tracking-[0.2em] font-black opacity-60">
                    Cart Subtotal
                  </p>

                  <p className="text-4xl font-black mt-1">
                    $
                    {subtotal.toFixed(
                      2
                    )}
                  </p>
                </div>

                <Link
                  href="/checkout"
                  className="bg-black hover:bg-zinc-900 text-white rounded-xl px-6 py-3 font-black transition text-center"
                >
                  Continue to Checkout
                </Link>

              </div>

              <p className="text-sm font-medium mt-4 opacity-70">
                Guest checkout
                supported. Adding an
                item to cart does not
                reserve vendor
                inventory yet.
              </p>

            </div>

          </section>
        )}

      </div>
    </main>
  );
}
