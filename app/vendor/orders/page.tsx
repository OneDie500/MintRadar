"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { getActiveVendorMembership } from "../../../lib/active-vendor";

type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "ready_for_pickup"
  | "completed"
  | "cancelled";

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

type VendorOrder = {
  id: string;
  vendor_id: string;
  user_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  payment_method: string;
  status: OrderStatus;
  subtotal: number;
  created_at: string;
  updated_at: string;
  order_items?: OrderItem[];
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting Payment",
  paid: "Paid",
  ready_for_pickup: "Ready for Pickup",
  completed: "Completed",
  cancelled: "Cancelled",
};

const METHOD_LABELS: Record<string, string> = {
  paypal: "PayPal",
  venmo: "Venmo",
  cashapp: "Cash App",
  zelle: "Zelle",
  custom: "Custom",
};

const STATUS_STYLES: Record<OrderStatus, string> = {
  awaiting_payment:
    "border-amber-700/50 bg-amber-950/40 text-amber-300",
  paid:
    "border-emerald-700/50 bg-emerald-950/40 text-emerald-300",
  ready_for_pickup:
    "border-sky-700/50 bg-sky-950/40 text-sky-300",
  completed:
    "border-zinc-700 bg-zinc-800 text-zinc-200",
  cancelled:
    "border-red-800/60 bg-red-950/30 text-red-300",
};

function money(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function shortId(id: string) {
  return id.split("-")[0].toUpperCase();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function VendorOrdersPage() {
  const router = useRouter();

  const [vendorId, setVendorId] = useState("");
  const [vendorName, setVendorName] = useState("MintRadar Vendor");
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [filter, setFilter] = useState<"all" | OrderStatus>("all");

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  useEffect(() => {
    loadVendor();
  }, []);

  useEffect(() => {
    if (!vendorId) return;

    loadOrders(vendorId);

    const channel = supabase
      .channel(`vendor-orders-${vendorId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `vendor_id=eq.${vendorId}`,
        },
        () => loadOrders(vendorId)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vendorId]);

  async function loadVendor() {
    try {
      setLoading(true);
      setErrorMessage("");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session?.user) {
        router.replace("/vendor/login");
        return;
      }

      const membership = await getActiveVendorMembership(
        supabase,
        session.user.id
      );

      if (!membership?.vendor_id) {
        throw new Error(
          "Your account is not connected to an active MintRadar vendor."
        );
      }

      setVendorId(membership.vendor_id);
      setVendorName(
        membership.vendor?.business_name || "MintRadar Vendor"
      );
    } catch (error: any) {
      console.error("Vendor order account load error:", error);
      setErrorMessage(
        error?.message || "MintRadar could not load your vendor account."
      );
      setLoading(false);
    }
  }

  async function loadOrders(id: string) {
    try {
      setLoading(true);
      setErrorMessage("");

      const { data, error } = await supabase
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
          updated_at,
          order_items (
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
          )
        `)
        .eq("vendor_id", id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setOrders((data || []) as unknown as VendorOrder[]);
    } catch (error: any) {
      console.error("Vendor orders load error:", error);
      setErrorMessage(
        error?.message || "MintRadar could not load vendor orders."
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(order: VendorOrder, status: OrderStatus) {
    if (savingOrderId) return;

    const previousStatus = order.status;

    try {
      setSavingOrderId(order.id);
      setErrorMessage("");

      setOrders((current) =>
        current.map((entry) =>
          entry.id === order.id
            ? { ...entry, status, updated_at: new Date().toISOString() }
            : entry
        )
      );

      const { error } = await supabase.rpc(
        "update_order_status_with_inventory",
        {
          p_order_id: order.id,
          p_new_status: status,
        }
      );

      if (error) throw error;
    } catch (error: any) {
      console.error("Order status update error:", error);

      setOrders((current) =>
        current.map((entry) =>
          entry.id === order.id
            ? { ...entry, status: previousStatus }
            : entry
        )
      );

      setErrorMessage(
        error?.message || "The order status could not be updated."
      );
    } finally {
      setSavingOrderId(null);
    }
  }

  const counts = useMemo(() => {
    return {
      all: orders.length,
      awaiting_payment: orders.filter(
        (order) => order.status === "awaiting_payment"
      ).length,
      paid: orders.filter((order) => order.status === "paid").length,
      ready_for_pickup: orders.filter(
        (order) => order.status === "ready_for_pickup"
      ).length,
      completed: orders.filter(
        (order) => order.status === "completed"
      ).length,
      cancelled: orders.filter(
        (order) => order.status === "cancelled"
      ).length,
    };
  }, [orders]);

  const visibleOrders = useMemo(
    () =>
      filter === "all"
        ? orders
        : orders.filter((order) => order.status === filter),
    [orders, filter]
  );

  const openRevenue = useMemo(
    () =>
      orders
        .filter(
          (order) =>
            order.status !== "cancelled" &&
            order.status !== "completed"
        )
        .reduce((sum, order) => sum + Number(order.subtotal || 0), 0),
    [orders]
  );

  if (loading && !vendorId) {
    return (
      <main className="min-h-screen bg-zinc-950 text-white">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <p className="text-sm text-zinc-400">Loading vendor orders...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-7xl px-5 py-8 md:py-10">
        <header className="flex flex-col gap-5 border-b border-zinc-800 pb-7 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              {vendorName}
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
              Orders
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Confirm payments and move customer orders through pickup and completion.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/vendor"
              className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-black hover:bg-zinc-900"
            >
              Vendor Dashboard
            </Link>
            <Link
              href="/vendor/settings"
              className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-black hover:bg-zinc-900"
            >
              Settings
            </Link>
          </div>
        </header>

        {errorMessage && (
          <div className="mt-6 rounded-2xl border border-red-900/60 bg-red-950/20 p-4 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Awaiting Payment"
            value={counts.awaiting_payment}
          />
          <StatCard label="Paid" value={counts.paid} />
          <StatCard
            label="Ready for Pickup"
            value={counts.ready_for_pickup}
          />
          <StatCard
            label="Open Order Value"
            value={money(openRevenue)}
          />
        </section>

        <section className="mt-7 overflow-x-auto">
          <div className="flex min-w-max gap-2">
            <FilterButton
              active={filter === "all"}
              label="All"
              count={counts.all}
              onClick={() => setFilter("all")}
            />
            <FilterButton
              active={filter === "awaiting_payment"}
              label="Awaiting Payment"
              count={counts.awaiting_payment}
              onClick={() => setFilter("awaiting_payment")}
            />
            <FilterButton
              active={filter === "paid"}
              label="Paid"
              count={counts.paid}
              onClick={() => setFilter("paid")}
            />
            <FilterButton
              active={filter === "ready_for_pickup"}
              label="Ready"
              count={counts.ready_for_pickup}
              onClick={() => setFilter("ready_for_pickup")}
            />
            <FilterButton
              active={filter === "completed"}
              label="Completed"
              count={counts.completed}
              onClick={() => setFilter("completed")}
            />
            <FilterButton
              active={filter === "cancelled"}
              label="Cancelled"
              count={counts.cancelled}
              onClick={() => setFilter("cancelled")}
            />
          </div>
        </section>

        <section className="mt-5 space-y-4">
          {loading && vendorId && orders.length === 0 ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-8 text-sm text-zinc-400">
              Loading orders...
            </div>
          ) : visibleOrders.length === 0 ? (
            <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-10 text-center">
              <h2 className="text-xl font-black">No orders here yet.</h2>
              <p className="mt-2 text-sm text-zinc-500">
                New customer orders for {vendorName} will appear here.
              </p>
            </div>
          ) : (
            visibleOrders.map((order) => {
              const expanded = expandedOrderId === order.id;
              const itemCount = (order.order_items || []).reduce(
                (sum, item) => sum + item.quantity,
                0
              );

              return (
                <article
                  key={order.id}
                  className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/50"
                >
                  <div className="p-5 md:p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-black ${STATUS_STYLES[order.status]}`}
                          >
                            {STATUS_LABELS[order.status]}
                          </span>
                          <span className="text-xs font-bold uppercase tracking-wider text-zinc-600">
                            #{shortId(order.id)}
                          </span>
                        </div>

                        <h2 className="mt-3 text-xl font-black">
                          {order.customer_name}
                        </h2>
                        <p className="mt-1 text-sm text-zinc-400">
                          {order.customer_email}
                          {order.customer_phone
                            ? ` · ${order.customer_phone}`
                            : ""}
                        </p>
                        <p className="mt-2 text-xs text-zinc-600">
                          {formatDate(order.created_at)} · {itemCount}{" "}
                          {itemCount === 1 ? "item" : "items"} ·{" "}
                          {METHOD_LABELS[order.payment_method] ||
                            order.payment_method}
                        </p>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
                        <div className="sm:text-right">
                          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                            Order Total
                          </p>
                          <p className="mt-1 text-2xl font-black">
                            {money(order.subtotal)}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2 sm:justify-end">
                          <StatusActions
                            order={order}
                            busy={savingOrderId === order.id}
                            onUpdate={updateStatus}
                          />

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedOrderId(
                                expanded ? null : order.id
                              )
                            }
                            className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-black hover:bg-zinc-800"
                          >
                            {expanded ? "Hide Details" : "View Order"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-zinc-800 bg-black/20 p-5 md:p-6">
                      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                        <div>
                          <h3 className="text-sm font-black uppercase tracking-[0.16em] text-zinc-400">
                            Items
                          </h3>

                          <div className="mt-4 space-y-3">
                            {(order.order_items || []).map((item) => {
                              const card = item.cards;

                              return (
                                <div
                                  key={item.id}
                                  className="flex gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4"
                                >
                                  <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-black">
                                    {card?.image_url ? (
                                      <img
                                        src={card.image_url}
                                        alt={card.name || "Card"}
                                        className="h-full w-full object-contain"
                                      />
                                    ) : (
                                      <span className="text-[9px] font-bold uppercase text-zinc-700">
                                        No Image
                                      </span>
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <p className="font-black">
                                      {card?.name || "Card"}
                                    </p>
                                    <p className="mt-1 text-xs text-zinc-500">
                                      {[
                                        card?.set_name,
                                        card?.card_number
                                          ? `#${card.card_number}`
                                          : null,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ") || "MintRadar listing"}
                                    </p>
                                    <div className="mt-3 flex items-end justify-between gap-3">
                                      <span className="text-xs font-bold text-zinc-500">
                                        Qty {item.quantity} ×{" "}
                                        {money(item.unit_price)}
                                      </span>
                                      <span className="font-black">
                                        {money(
                                          Number(item.unit_price) *
                                            item.quantity
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <aside>
                          <h3 className="text-sm font-black uppercase tracking-[0.16em] text-zinc-400">
                            Order Details
                          </h3>

                          <div className="mt-4 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5">
                            <DetailRow
                              label="Payment"
                              value={
                                METHOD_LABELS[order.payment_method] ||
                                order.payment_method
                              }
                            />
                            <DetailRow
                              label="Status"
                              value={STATUS_LABELS[order.status]}
                            />
                            <DetailRow
                              label="Customer"
                              value={order.customer_name}
                            />
                            <DetailRow
                              label="Email"
                              value={order.customer_email}
                            />
                            {order.customer_phone && (
                              <DetailRow
                                label="Phone"
                                value={order.customer_phone}
                              />
                            )}
                            <DetailRow
                              label="Full Order ID"
                              value={order.id}
                              breakAll
                            />
                          </div>
                        </aside>
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function FilterButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-2.5 text-sm font-black transition ${
        active
          ? "border-white bg-white text-black"
          : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:bg-zinc-800"
      }`}
    >
      {label} <span className="ml-1 opacity-60">{count}</span>
    </button>
  );
}

function StatusActions({
  order,
  busy,
  onUpdate,
}: {
  order: VendorOrder;
  busy: boolean;
  onUpdate: (order: VendorOrder, status: OrderStatus) => Promise<void>;
}) {
  if (
    order.status === "completed" ||
    order.status === "cancelled"
  ) {
    return null;
  }

  const primary =
    order.status === "awaiting_payment"
      ? {
          label: "Confirm Payment",
          status: "paid" as OrderStatus,
          className:
            "bg-emerald-400 text-black hover:bg-emerald-300",
        }
      : order.status === "paid"
      ? {
          label: "Ready for Pickup",
          status: "ready_for_pickup" as OrderStatus,
          className:
            "bg-sky-400 text-black hover:bg-sky-300",
        }
      : {
          label: "Complete Order",
          status: "completed" as OrderStatus,
          className:
            "bg-white text-black hover:bg-zinc-200",
        };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => onUpdate(order, primary.status)}
        className={`rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50 ${primary.className}`}
      >
        {busy ? "Saving..." : primary.label}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={() => onUpdate(order, "cancelled")}
        className="rounded-xl border border-red-900/60 bg-red-950/10 px-4 py-2.5 text-sm font-black text-red-300 transition hover:bg-red-950/30 disabled:opacity-50"
      >
        {busy ? "Saving..." : "Cancel Order"}
      </button>
    </div>
  );
}

function DetailRow({
  label,
  value,
  breakAll = false,
}: {
  label: string;
  value: string;
  breakAll?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600">
        {label}
      </p>
      <p
        className={`mt-1 text-sm font-bold text-zinc-300 ${
          breakAll ? "break-all" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
