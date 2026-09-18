"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import {
  mergeGuestCartIntoAccount,
  readGuestCart,
} from "../../lib/cart";

type PaymentMethod = {
  id: string;
  vendor_id: string;
  method: "paypal" | "venmo" | "cashapp" | "zelle" | "custom";
  display_name: string | null;
  payment_url: string | null;
  payment_handle: string | null;
  instructions: string | null;
  is_enabled: boolean;
};

type CartRow = {
  id: string;
  inventory_id: string;
  quantity: number;
  inventory?: {
    id: string;
    quantity?: number | null;
    price?: number | null;
    card_id?: string | null;
    listing_type?: string | null;
    condition?: string | null;
    grading_company?: string | null;
    grade?: string | null;
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

type VendorGroup = {
  vendorId: string;
  vendorName: string;
  items: CartRow[];
  subtotal: number;
  paymentMethods: PaymentMethod[];
};

const METHOD_LABELS: Record<string, string> = {
  paypal: "PayPal",
  venmo: "Venmo",
  cashapp: "Cash App",
  zelle: "Zelle",
  custom: "Other Payment Method",
};

export default function CheckoutPage() {
  const [signedIn, setSignedIn] =
    useState<boolean | null>(null);
  const [userId, setUserId] =
    useState<string | null>(null);

  const [name, setName] =
    useState("");
  const [email, setEmail] =
    useState("");
  const [phone, setPhone] =
    useState("");

  const [items, setItems] =
    useState<CartRow[]>([]);
  const [paymentMethods, setPaymentMethods] =
    useState<PaymentMethod[]>([]);
  const [selectedMethods, setSelectedMethods] =
    useState<Record<string, string>>({});

  const [loading, setLoading] =
    useState(true);
  const [submitting, setSubmitting] =
    useState(false);
  const [message, setMessage] =
    useState("");
  const [errorMessage, setErrorMessage] =
    useState("");

  useEffect(() => {
    loadCheckout();
  }, []);

  async function loadCheckout() {
    try {
      setLoading(true);
      setErrorMessage("");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const user = session?.user ?? null;

      setSignedIn(Boolean(user));
      setUserId(user?.id ?? null);

      if (user?.email) {
        setEmail(user.email);
      }

      if (!user) {
        setItems([]);
        setPaymentMethods([]);
        return;
      }

      await mergeGuestCartIntoAccount(user.id);

      const { data, error } = await supabase
        .from("cart_items")
        .select(`
          id,
          inventory_id,
          quantity,
          inventory (
            id,
            quantity,
            price,
            card_id,
            listing_type,
            condition,
            grading_company,
            grade,
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
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      const cartRows =
        (data || []) as unknown as CartRow[];

      setItems(cartRows);

      const vendorIds = Array.from(
        new Set(
          cartRows
            .map((row) => row.inventory?.vendors?.id)
            .filter((id): id is string => Boolean(id))
        )
      );

      if (vendorIds.length === 0) {
        setPaymentMethods([]);
        return;
      }

      const {
        data: methods,
        error: methodsError,
      } = await supabase
        .from("vendor_payment_methods")
        .select(`
          id,
          vendor_id,
          method,
          display_name,
          payment_url,
          payment_handle,
          instructions,
          is_enabled
        `)
        .in("vendor_id", vendorIds)
        .eq("is_enabled", true)
        .order("created_at", { ascending: true });

      if (methodsError) {
        throw methodsError;
      }

      const enabledMethods =
        (methods || []) as PaymentMethod[];

      setPaymentMethods(enabledMethods);

      const defaults: Record<string, string> = {};

      for (const vendorId of vendorIds) {
        const firstMethod = enabledMethods.find(
          (method) => method.vendor_id === vendorId
        );

        if (firstMethod) {
          defaults[vendorId] = firstMethod.id;
        }
      }

      setSelectedMethods(defaults);
    } catch (error: any) {
      console.error("Checkout load error:", error);
      setErrorMessage(
        error?.message ||
          "MintRadar could not load checkout."
      );
    } finally {
      setLoading(false);
    }
  }

  const vendorGroups = useMemo<VendorGroup[]>(() => {
    const groups = new Map<string, VendorGroup>();

    for (const row of items) {
      const vendorId =
        row.inventory?.vendors?.id || "unknown-vendor";
      const vendorName =
        row.inventory?.vendors?.business_name ||
        "MintRadar Seller";
      const price = Number(row.inventory?.price ?? 0);
      const lineTotal =
        price * Number(row.quantity || 0);

      const existing = groups.get(vendorId);

      if (existing) {
        existing.items.push(row);
        existing.subtotal += lineTotal;
      } else {
        groups.set(vendorId, {
          vendorId,
          vendorName,
          items: [row],
          subtotal: lineTotal,
          paymentMethods: [],
        });
      }
    }

    const result = Array.from(groups.values());

    for (const group of result) {
      group.paymentMethods = paymentMethods.filter(
        (method) => method.vendor_id === group.vendorId
      );
    }

    return result.sort((a, b) =>
      a.vendorName.localeCompare(b.vendorName)
    );
  }, [items, paymentMethods]);

  const cartSubtotal = useMemo(
    () =>
      vendorGroups.reduce(
        (total, group) => total + group.subtotal,
        0
      ),
    [vendorGroups]
  );

  function getMethodLabel(method: PaymentMethod) {
    if (
      method.method === "custom" &&
      method.display_name?.trim()
    ) {
      return method.display_name.trim();
    }

    return METHOD_LABELS[method.method] || method.method;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    setMessage("");
    setErrorMessage("");

    if (!userId) {
      setErrorMessage(
        "Please sign in to place an order. Guest payment will be added through the protected checkout flow next."
      );
      return;
    }

    if (items.length === 0) {
      setErrorMessage("Your cart is empty.");
      return;
    }

    for (const group of vendorGroups) {
      if (group.vendorId === "unknown-vendor") {
        setErrorMessage(
          "One of the listings in your cart is missing vendor information."
        );
        return;
      }

      if (group.paymentMethods.length === 0) {
        setErrorMessage(
          `${group.vendorName} does not have an enabled payment method yet.`
        );
        return;
      }

      if (!selectedMethods[group.vendorId]) {
        setErrorMessage(
          `Choose a payment method for ${group.vendorName}.`
        );
        return;
      }
    }

    try {
      setSubmitting(true);

      const createdOrders: {
        orderId: string;
        vendorName: string;
        paymentMethod: PaymentMethod;
      }[] = [];

      for (const group of vendorGroups) {
        const selectedMethod = group.paymentMethods.find(
          (method) =>
            method.id === selectedMethods[group.vendorId]
        );

        if (!selectedMethod) {
          throw new Error(
            `Payment method could not be resolved for ${group.vendorName}.`
          );
        }

        const reservationItems = group.items.map((row) => ({
          inventory_id: row.inventory_id,
          quantity: row.quantity,
        }));

        const {
          data: orderId,
          error: orderError,
        } = await supabase.rpc(
          "create_order_with_reservation",
          {
            p_vendor_id: group.vendorId,
            p_customer_name: name.trim(),
            p_customer_email: email.trim(),
            p_customer_phone: phone.trim(),
            p_payment_method: selectedMethod.method,
            p_items: reservationItems,
          }
        );

        if (orderError) {
          throw orderError;
        }

        if (!orderId) {
          throw new Error(
            `MintRadar could not create the order for ${group.vendorName}.`
          );
        }

        createdOrders.push({
          orderId: String(orderId),
          vendorName: group.vendorName,
          paymentMethod: selectedMethod,
        });
      }

      const { error: clearError } = await supabase
        .from("cart_items")
        .delete()
        .eq("user_id", userId);

      if (clearError) {
        console.error(
          "Order created, but cart clear failed:",
          clearError
        );
      }

      setItems([]);

      if (createdOrders.length === 1) {
        window.location.href = `/order/${createdOrders[0].orderId}`;
        return;
      }

      setMessage(
        `${createdOrders.length} vendor orders created. Complete each vendor payment separately.`
      );
    } catch (error: any) {
      console.error("Checkout submit error:", error);

      setErrorMessage(
        error?.message ||
          "MintRadar could not create your order."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">
          Loading checkout...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-5 py-8">
      <div className="max-w-4xl mx-auto">
        <Link
          href="/cart"
          className="text-sm text-zinc-500 hover:text-emerald-400 transition"
        >
          ← Back to Cart
        </Link>

        <p className="text-emerald-400 text-xs uppercase tracking-[0.22em] font-black mt-6">
          MintRadar Checkout
        </p>

        <h1 className="text-4xl sm:text-5xl font-black mt-2">
          Checkout
        </h1>

        <p className="text-zinc-500 mt-3">
          {signedIn
            ? "Confirm your contact details and choose how you want to pay each vendor."
            : "You can browse as a guest. Sign in before placing an order."}
        </p>

        {!signedIn && (
          <div className="mt-6 bg-zinc-950 border border-zinc-900 rounded-2xl p-5">
            <p className="font-black">
              Sign in to place this order
            </p>

            <p className="text-zinc-500 text-sm mt-1">
              Your guest cart will merge into your MintRadar
              account after you sign in.
            </p>

            <Link
              href="/customer/login?next=/checkout"
              className="inline-flex mt-4 border border-zinc-800 hover:border-emerald-400 rounded-xl px-4 py-2.5 font-black transition"
            >
              Sign In
            </Link>
          </div>
        )}

        {errorMessage && (
          <div className="mt-6 bg-red-500/10 border border-red-500/30 text-red-300 rounded-2xl p-4">
            {errorMessage}
          </div>
        )}

        {items.length === 0 && signedIn ? (
          <section className="mt-8 bg-zinc-950 border border-zinc-900 rounded-3xl p-8 text-center">
            <h2 className="text-2xl font-black">
              Your cart is empty.
            </h2>
            <Link
              href="/"
              className="inline-flex mt-5 bg-emerald-400 hover:bg-emerald-300 text-black rounded-xl px-5 py-3 font-black transition"
            >
              Browse Inventory
            </Link>
          </section>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-8 space-y-6"
          >
            <section className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 sm:p-8 space-y-5">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-400 font-black">
                  Contact
                </p>
                <h2 className="text-2xl font-black mt-1">
                  Buyer Details
                </h2>
              </div>

              <div>
                <label className="block text-sm font-black mb-2">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(event) =>
                    setName(event.target.value)
                  }
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="block text-sm font-black mb-2">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="block text-sm font-black mb-2">
                  Phone{" "}
                  <span className="text-zinc-600 font-normal">
                    Optional
                  </span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) =>
                    setPhone(event.target.value)
                  }
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 outline-none focus:border-emerald-400"
                />
              </div>
            </section>

            {vendorGroups.map((group) => (
              <section
                key={group.vendorId}
                className="bg-zinc-950 border border-zinc-900 rounded-3xl overflow-hidden"
              >
                <div className="p-6 sm:p-8 border-b border-zinc-900">
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-emerald-400 font-black">
                        Vendor Order
                      </p>
                      <h2 className="text-2xl font-black mt-1">
                        {group.vendorName}
                      </h2>
                    </div>

                    <div className="sm:text-right">
                      <p className="text-xs uppercase tracking-wider text-zinc-600 font-black">
                        Subtotal
                      </p>
                      <p className="text-2xl font-black text-emerald-400">
                        ${group.subtotal.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-zinc-900">
                  {group.items.map((row) => {
                    const card = row.inventory?.cards;
                    const lineTotal =
                      Number(row.inventory?.price ?? 0) *
                      Number(row.quantity || 0);

                    return (
                      <div
                        key={row.id}
                        className="flex gap-4 p-5 sm:px-8"
                      >
                        <div className="w-16 aspect-[3/4] bg-black border border-zinc-900 rounded-xl overflow-hidden shrink-0">
                          {card?.image_url ? (
                            <img
                              src={card.image_url}
                              alt={card.name || "Card"}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-700">
                              No Image
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="font-black">
                            {card?.name || "Collectible"}
                          </p>
                          <p className="text-sm text-zinc-600 mt-1">
                            {card?.set_name}
                            {card?.card_number
                              ? ` #${card.card_number}`
                              : ""}
                          </p>
                          <p className="text-sm text-zinc-500 mt-2">
                            Qty {row.quantity}
                          </p>
                        </div>

                        <p className="font-black">
                          ${lineTotal.toFixed(2)}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="p-6 sm:p-8 border-t border-zinc-900">
                  <p className="text-sm font-black">
                    Payment Method
                  </p>

                  {group.paymentMethods.length === 0 ? (
                    <div className="mt-3 bg-amber-400/10 border border-amber-400/30 text-amber-200 rounded-xl p-4 text-sm">
                      {group.vendorName} has not enabled a
                      payment method yet. This vendor order
                      cannot be placed until they do.
                    </div>
                  ) : (
                    <div className="grid sm:grid-cols-2 gap-3 mt-3">
                      {group.paymentMethods.map((method) => {
                        const selected =
                          selectedMethods[group.vendorId] ===
                          method.id;

                        return (
                          <label
                            key={method.id}
                            className={`cursor-pointer rounded-2xl border p-4 transition ${
                              selected
                                ? "border-emerald-400 bg-emerald-400/10"
                                : "border-zinc-800 bg-black hover:border-zinc-700"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="radio"
                                name={`payment-${group.vendorId}`}
                                value={method.id}
                                checked={selected}
                                onChange={() =>
                                  setSelectedMethods(
                                    (current) => ({
                                      ...current,
                                      [group.vendorId]:
                                        method.id,
                                    })
                                  )
                                }
                                className="mt-1 accent-emerald-400"
                              />

                              <div className="min-w-0">
                                <p className="font-black">
                                  {getMethodLabel(method)}
                                </p>

                                {method.payment_handle && (
                                  <p className="text-sm text-zinc-400 mt-1 break-all">
                                    {method.payment_handle}
                                  </p>
                                )}

                                {method.instructions && (
                                  <p className="text-xs leading-5 text-zinc-600 mt-2">
                                    {method.instructions}
                                  </p>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            ))}

            <section className="bg-emerald-400 text-black rounded-3xl p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] font-black opacity-60">
                    Cart Total
                  </p>
                  <p className="text-4xl font-black mt-1">
                    ${cartSubtotal.toFixed(2)}
                  </p>
                  <p className="text-sm font-medium mt-3 opacity-70">
                    MintRadar creates a separate order for each
                    vendor. Payment is completed directly with
                    that vendor.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={
                    submitting ||
                    !signedIn ||
                    vendorGroups.length === 0 ||
                    vendorGroups.some(
                      (group) =>
                        group.paymentMethods.length === 0
                    )
                  }
                  className="bg-black hover:bg-zinc-900 text-white rounded-xl px-6 py-4 font-black transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting
                    ? "Creating Orders..."
                    : vendorGroups.length > 1
                      ? `Place ${vendorGroups.length} Vendor Orders`
                      : "Place Order"}
                </button>
              </div>

              {message && (
                <div className="mt-5 bg-black/10 border border-black/20 rounded-xl p-4 text-sm font-bold">
                  {message}
                </div>
              )}
            </section>
          </form>
        )}
      </div>
    </main>
  );
}
