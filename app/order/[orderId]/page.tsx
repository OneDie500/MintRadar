"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

type OrderRow = {
  id: string;
  vendor_id: string;
  user_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  payment_method: "paypal" | "venmo" | "cashapp" | "zelle" | "custom";
  status:
    | "awaiting_payment"
    | "paid"
    | "ready_for_pickup"
    | "completed"
    | "cancelled";
  subtotal: number;
  created_at: string;
  vendors?: {
    id?: string | null;
    business_name?: string | null;
  } | null;
};

type OrderItem = {
  id: string;
  inventory_id: string;
  card_id: string | null;
  quantity: number;
  unit_price: number;
  cards?: {
    id?: string | null;
    name?: string | null;
    set_name?: string | null;
    card_number?: string | null;
    image_url?: string | null;
  } | null;
};

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

const METHOD_LABELS: Record<string, string> = {
  paypal: "PayPal",
  venmo: "Venmo",
  cashapp: "Cash App",
  zelle: "Zelle",
  custom: "Other Payment Method",
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_payment: "Awaiting Payment",
  paid: "Paid",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

function money(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function shortOrderId(id: string) {
  return id.split("-")[0].toUpperCase();
}

export default function OrderConfirmationPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId;

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    if (!orderId) return;
    loadOrder(orderId);
  }, [orderId]);

  async function loadOrder(id: string) {
    try {
      setLoading(true);
      setErrorMessage("");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session?.user) {
        throw new Error("Sign in to view this order.");
      }

      const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .select(`
          id,
          vendor_id,
          user_id,
          customer_name,
          customer_email,
          customer_phone,
          payment_method,
          status,
          subtotal,
          created_at,
          vendors (
            id,
            business_name
          )
        `)
        .eq("id", id)
        .single();

      if (orderError) throw orderError;

      const resolvedOrder = orderData as unknown as OrderRow;
      setOrder(resolvedOrder);

      const { data: itemData, error: itemError } = await supabase
        .from("order_items")
        .select(`
          id,
          inventory_id,
          card_id,
          quantity,
          unit_price,
          cards (
            id,
            name,
            set_name,
            card_number,
            image_url
          )
        `)
        .eq("order_id", id)
        .order("created_at", { ascending: true });

      if (itemError) throw itemError;
      setItems((itemData || []) as unknown as OrderItem[]);

      const { data: paymentData, error: paymentError } = await supabase
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
        .eq("vendor_id", resolvedOrder.vendor_id)
        .eq("method", resolvedOrder.payment_method)
        .eq("is_enabled", true)
        .maybeSingle();

      if (paymentError) {
        console.error("Payment method load error:", paymentError);
      } else {
        setPaymentMethod(
          (paymentData as PaymentMethod | null) ?? null
        );
      }
    } catch (error: any) {
      console.error("Order confirmation load error:", error);
      setErrorMessage(
        error?.message || "MintRadar could not load this order."
      );
    } finally {
      setLoading(false);
    }
  }

  async function copyPaymentHandle() {
    if (!paymentMethod?.payment_handle) return;

    try {
      await navigator.clipboard.writeText(
        paymentMethod.payment_handle
      );
      setCopyMessage("Copied!");
      window.setTimeout(() => setCopyMessage(""), 1800);
    } catch {
      setCopyMessage("Could not copy");
      window.setTimeout(() => setCopyMessage(""), 1800);
    }
  }

  const vendorName =
    order?.vendors?.business_name || "Vendor";

  const statusLabel = order
    ? STATUS_LABELS[order.status] || order.status
    : "";

  const methodLabel = paymentMethod?.display_name?.trim()
    ? paymentMethod.display_name
    : METHOD_LABELS[order?.payment_method || ""] ||
      order?.payment_method ||
      "Payment";

  const itemTotal = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum + Number(item.unit_price || 0) * item.quantity,
        0
      ),
    [items]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <div className="mx-auto max-w-4xl px-5 py-16">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/60 p-8">
            <p className="text-sm text-zinc-400">
              Loading your order...
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (errorMessage || !order) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <div className="rounded-3xl border border-red-900/60 bg-red-950/20 p-8">
            <h1 className="text-2xl font-black">
              We couldn&apos;t load that order.
            </h1>
            <p className="mt-3 text-sm text-red-200/80">
              {errorMessage || "Order not found."}
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-black text-black"
            >
              Back to MintRadar
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-5xl px-5 py-10 md:py-14">
        <section className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/60 shadow-2xl">
          <div className="border-b border-zinc-800 px-6 py-8 md:px-9">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-700/50 bg-emerald-950/40 px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                  <span>✓</span>
                  Order Placed
                </div>

                <h1 className="text-3xl font-black tracking-tight md:text-4xl">
                  Your order is in.
                </h1>

                <p className="mt-2 text-sm text-zinc-400">
                  Order #{shortOrderId(order.id)} · {vendorName}
                </p>
              </div>

              <div className="md:text-right">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                  Status
                </p>
                <div className="mt-2 inline-flex rounded-full border border-amber-700/50 bg-amber-950/40 px-4 py-2 text-sm font-black text-amber-300">
                  {statusLabel}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[1.25fr_.75fr]">
            <div className="border-b border-zinc-800 p-6 md:p-9 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-black">
                  Order Summary
                </h2>
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  {items.length} {items.length === 1 ? "item" : "items"}
                </span>
              </div>

              <div className="mt-5 space-y-4">
                {items.map((item) => {
                  const card = item.cards;
                  const lineTotal =
                    Number(item.unit_price || 0) * item.quantity;

                  return (
                    <div
                      key={item.id}
                      className="flex gap-4 rounded-2xl border border-zinc-800 bg-black/20 p-4"
                    >
                      <div className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
                        {card?.image_url ? (
                          <img
                            src={card.image_url}
                            alt={card?.name || "Card"}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <span className="px-2 text-center text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                            No Image
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="font-black">
                          {card?.name || "Card"}
                        </p>

                        <p className="mt-1 text-sm text-zinc-400">
                          {[card?.set_name, card?.card_number ? `#${card.card_number}` : null]
                            .filter(Boolean)
                            .join(" · ") || "MintRadar listing"}
                        </p>

                        <div className="mt-4 flex items-end justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                            Qty {item.quantity} × {money(item.unit_price)}
                          </p>
                          <p className="font-black">
                            {money(lineTotal)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-zinc-800 pt-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                    Total
                  </p>
                  {Math.abs(itemTotal - Number(order.subtotal)) > 0.009 && (
                    <p className="mt-1 text-xs text-zinc-600">
                      Item total {money(itemTotal)}
                    </p>
                  )}
                </div>
                <p className="text-3xl font-black">
                  {money(order.subtotal)}
                </p>
              </div>
            </div>

            <aside className="p-6 md:p-9">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                Complete Payment
              </p>

              <h2 className="mt-2 text-2xl font-black">
                Pay {vendorName}
              </h2>

              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Your order is saved and is waiting for the vendor to confirm payment.
              </p>

              <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                  Pay with
                </p>
                <p className="mt-2 text-xl font-black">
                  {methodLabel}
                </p>

                {paymentMethod?.payment_handle && (
                  <div className="mt-5">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                      Payment Handle
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 font-bold break-all">
                        {paymentMethod.payment_handle}
                      </div>
                      <button
                        type="button"
                        onClick={copyPaymentHandle}
                        className="shrink-0 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-black hover:bg-zinc-800"
                      >
                        {copyMessage || "Copy"}
                      </button>
                    </div>
                  </div>
                )}

                {paymentMethod?.instructions && (
                  <div className="mt-5">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                      Vendor Instructions
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                      {paymentMethod.instructions}
                    </p>
                  </div>
                )}

                {paymentMethod?.payment_url && (
                  <a
                    href={paymentMethod.payment_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-5 flex w-full items-center justify-center rounded-xl bg-white px-5 py-3.5 text-sm font-black text-black hover:bg-zinc-200"
                  >
                    Continue to {methodLabel}
                  </a>
                )}

                {!paymentMethod && (
                  <p className="mt-4 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-sm leading-6 text-amber-200">
                    The vendor&apos;s saved payment details are not currently available. Your order is still recorded as awaiting payment.
                  </p>
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-zinc-800 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                  Order #
                </p>
                <p className="mt-1 break-all text-sm font-bold text-zinc-300">
                  {order.id}
                </p>
              </div>

              <div className="mt-6 grid gap-3">
                <Link
                  href="/"
                  className="flex items-center justify-center rounded-xl bg-zinc-800 px-5 py-3.5 text-sm font-black hover:bg-zinc-700"
                >
                  Continue Shopping
                </Link>

                <Link
                  href="/cart"
                  className="flex items-center justify-center rounded-xl border border-zinc-800 px-5 py-3.5 text-sm font-black text-zinc-300 hover:bg-zinc-900"
                >
                  Back to Cart
                </Link>
              </div>
            </aside>
          </div>
        </section>

        <p className="mx-auto mt-5 max-w-2xl text-center text-xs leading-5 text-zinc-600">
          Keep your order number for reference. MintRadar records the order before payment so the vendor can track its status.
        </p>
      </div>
    </main>
  );
}
