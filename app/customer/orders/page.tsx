"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "ready_for_pickup"
  | "completed"
  | "cancelled";

type OrderItem = {
  id: string;
  quantity: number;
  unit_price: number;
  card_id?: string | null;
  cards?: {
    id?: string | null;
    name?: string | null;
    set_name?: string | null;
    card_number?: string | null;
    image_url?: string | null;
  } | null;
};

type CustomerOrder = {
  id: string;
  vendor_id: string;
  customer_name?: string | null;
  customer_email?: string | null;
  payment_method?: string | null;
  status: OrderStatus;
  subtotal: number;
  created_at: string;
  vendors?: {
    id?: string | null;
    business_name?: string | null;
  } | null;
  order_items?: OrderItem[] | null;
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting Payment",
  paid: "Paid",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

function statusClasses(status: OrderStatus) {
  switch (status) {
    case "awaiting_payment":
      return "border-amber-400/30 bg-amber-400/10 text-amber-300";
    case "paid":
      return "border-sky-400/30 bg-sky-400/10 text-sky-300";
    case "ready_for_pickup":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
    case "completed":
      return "border-zinc-600 bg-zinc-800/70 text-zinc-200";
    case "cancelled":
      return "border-red-400/30 bg-red-400/10 text-red-300";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }
}

function formatPaymentMethod(method?: string | null) {
  if (!method) return "Payment method";

  return method
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function CustomerOrdersPage() {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadOrders() {
      try {
        setLoading(true);
        setMessage("");

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        const user = session?.user;

        if (!user) {
          window.location.assign("/customer/login");
          return;
        }

        const { data, error } = await supabase
          .from("orders")
          .select(`
            id,
            vendor_id,
            customer_name,
            customer_email,
            payment_method,
            status,
            subtotal,
            created_at,
            vendors (
              id,
              business_name
            ),
            order_items (
              id,
              quantity,
              unit_price,
              card_id,
              cards (
                id,
                name,
                set_name,
                card_number,
                image_url
              )
            )
          `)
          .eq("user_id", user.id)
          .order("created_at", {
            ascending: false,
          });

        if (error) {
          throw error;
        }

        if (!mounted) return;

        setOrders((data || []) as unknown as CustomerOrder[]);
      } catch (error: any) {
        console.error("MintRadar customer orders load error:", error);

        if (!mounted) return;

        setMessage(
          error?.message ||
            "MintRadar could not load your orders."
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadOrders();

    return () => {
      mounted = false;
    };
  }, []);

  const activeOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.status !== "completed" &&
          order.status !== "cancelled"
      ),
    [orders]
  );

  const pastOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.status === "completed" ||
          order.status === "cancelled"
      ),
    [orders]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">Loading your orders...</p>
      </main>
    );
  }

  function OrderCard({ order }: { order: CustomerOrder }) {
    const items = order.order_items || [];
    const vendorName =
      order.vendors?.business_name || "MintRadar Seller";
    const itemCount = items.reduce(
      (total, item) => total + Number(item.quantity || 0),
      0
    );

    return (
      <article className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950">
        <div className="flex flex-col gap-4 border-b border-zinc-900 bg-black/50 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
              {vendorName}
            </p>

            <h2 className="mt-1 text-xl font-black text-white">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </h2>

            <p className="mt-1 text-xs text-zinc-600">
              {formatDate(order.created_at)}
            </p>
          </div>

          <span
            className={`inline-flex w-fit rounded-full border px-3 py-1.5 text-xs font-black ${statusClasses(
              order.status
            )}`}
          >
            {STATUS_LABELS[order.status] || order.status}
          </span>
        </div>

        <div className="divide-y divide-zinc-900">
          {items.length > 0 ? (
            items.map((item) => {
              const card = item.cards;
              const lineTotal =
                Number(item.unit_price || 0) *
                Number(item.quantity || 0);

              return (
                <div
                  key={item.id}
                  className="flex gap-4 px-5 py-4 sm:px-6"
                >
                  <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-900 bg-black">
                    {card?.image_url ? (
                      <img
                        src={card.image_url}
                        alt={card.name || "Card"}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-zinc-700">
                        No Image
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-black text-white">
                      {card?.name || "Collectible"}
                    </p>

                    <p className="mt-1 text-xs text-zinc-600">
                      {card?.set_name || "MintRadar Listing"}
                      {card?.card_number
                        ? ` #${card.card_number}`
                        : ""}
                    </p>

                    <p className="mt-2 text-xs font-bold text-zinc-400">
                      Qty {item.quantity} · $
                      {Number(item.unit_price || 0).toFixed(2)} each
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-black text-white">
                      ${lineTotal.toFixed(2)}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-5 py-5 text-sm text-zinc-600 sm:px-6">
              Order item details are unavailable.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5 border-t border-zinc-800 bg-black/30 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
              Payment
            </p>

            <p className="mt-1 text-sm font-bold text-zinc-300">
              {formatPaymentMethod(order.payment_method)}
            </p>

            <p className="mt-2 text-xs text-zinc-600">
              {itemCount} {itemCount === 1 ? "item" : "items"}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:items-end">
            <div className="sm:text-right">
              <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                Order Total
              </p>

              <p className="mt-1 text-2xl font-black text-emerald-400">
                ${Number(order.subtotal || 0).toFixed(2)}
              </p>
            </div>

            <Link
              href={`/order/${order.id}`}
              className="rounded-xl bg-emerald-400 px-5 py-3 text-center text-sm font-black text-black transition hover:bg-emerald-300"
            >
              View Order
            </Link>
          </div>
        </div>
      </article>
    );
  }

  return (
    <main className="min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/"
              className="text-sm text-zinc-500 transition hover:text-emerald-400"
            >
              ← Back to MintRadar
            </Link>

            <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-emerald-400">
              MintRadar Marketplace
            </p>

            <h1 className="mt-2 text-4xl font-black sm:text-5xl">
              My Orders
            </h1>

            <p className="mt-2 max-w-2xl text-zinc-500">
              Track your purchases, payment status, and pickup progress.
            </p>
          </div>

          {orders.length > 0 && (
            <div className="rounded-2xl border border-zinc-900 bg-zinc-950 px-5 py-4">
              <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                Total Orders
              </p>
              <p className="mt-1 text-3xl font-black text-emerald-400">
                {orders.length}
              </p>
            </div>
          )}
        </header>

        {message && (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {message}
          </div>
        )}

        {!message && orders.length === 0 ? (
          <section className="mt-8 rounded-3xl border border-zinc-900 bg-zinc-950 p-10 text-center">
            <h2 className="text-2xl font-black">
              No orders yet.
            </h2>

            <p className="mt-3 text-zinc-500">
              When you purchase through MintRadar, your orders will show up here.
            </p>

            <Link
              href="/"
              className="mt-6 inline-flex rounded-xl bg-emerald-400 px-5 py-3 font-black text-black transition hover:bg-emerald-300"
            >
              Browse Inventory
            </Link>
          </section>
        ) : (
          <div className="mt-8 space-y-10">
            {activeOrders.length > 0 && (
              <section>
                <div className="mb-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                    In Progress
                  </p>
                  <h2 className="mt-1 text-2xl font-black">
                    Active Orders
                  </h2>
                </div>

                <div className="space-y-5">
                  {activeOrders.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </div>
              </section>
            )}

            {pastOrders.length > 0 && (
              <section>
                <div className="mb-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-600">
                    History
                  </p>
                  <h2 className="mt-1 text-2xl font-black">
                    Past Orders
                  </h2>
                </div>

                <div className="space-y-5">
                  {pastOrders.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
