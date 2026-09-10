"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { getActiveVendorMembership } from "../../lib/active-vendor";

type TradeHistoryItem = {
  trade_transaction_id: string;
  trade_offer_id: string;
  conversation_id: string;
  role_in_trade: "offer_sender" | "offer_recipient" | string;
  status: string;
  offered_market_total: number | string | null;
  offered_trade_total: number | string | null;
  target_market_value: number | string | null;
  difference: number | string | null;
  gave_items: TradeAsset[];
  received_items: TradeAsset[];
  created_at: string;
  completed_at: string | null;
  settled_at: string | null;
};

type TradeAsset = {
  trade_offer_item_id?: string | null;
  received_item_id?: string | null;
  card_id?: string | null;
  inventory_id?: string | null;
  collection_item_id?: string | null;
  source?: string | null;
  quantity?: number | null;
  market_value?: number | string | null;
  trade_percentage?: number | string | null;
  adjusted_trade_value?: number | string | null;
  received_from?: string | null;
  destination?: "collection" | "inventory" | null;
  claimed_at?: string | null;
  recipient_vendor_id?: string | null;
  source_trade_offer_item_id?: string | null;
  snapshot?: Record<string, unknown> | null;
};

function money(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return "$0.00";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(numeric);
}

function dateTime(value?: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function assetText(
  item: TradeAsset,
  key: string
) {
  const value = item.snapshot?.[key];

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    return value.trim();
  }

  if (
    typeof value === "number"
  ) {
    return String(value);
  }

  return null;
}

function assetName(item: TradeAsset) {
  return (
    assetText(item, "card_name") ||
    assetText(item, "name") ||
    "Unknown Collectible"
  );
}

function assetSubtitle(item: TradeAsset) {
  return [
    assetText(item, "set_name"),
    assetText(item, "card_number")
      ? `#${assetText(item, "card_number")}`
      : null,
  ]
    .filter(Boolean)
    .join(" • ");
}

function assetImage(item: TradeAsset) {
  return assetText(item, "image_url");
}

function assetDetails(item: TradeAsset) {
  const itemType =
    assetText(item, "item_type") ||
    assetText(item, "listing_type");

  const gradingCompany =
    assetText(item, "grading_company");

  const grade =
    assetText(item, "grade");

  if (
    itemType === "graded" ||
    gradingCompany ||
    grade
  ) {
    return (
      [gradingCompany, grade]
        .filter(Boolean)
        .join(" ") || "Slab"
    );
  }

  return (
    [
      assetText(item, "condition"),
      assetText(item, "edition"),
      assetText(item, "finish") ||
        assetText(item, "parallel_name"),
    ]
      .filter(Boolean)
      .join(" • ") || "Raw"
  );
}

function assetSourceLabel(item: TradeAsset) {
  if (item.collection_item_id) {
    return "My Collection";
  }

  if (item.inventory_id) {
    return "My Inventory";
  }

  const source =
    item.source ||
    assetText(item, "source");

  if (source === "collection") {
    return "My Collection";
  }

  if (source === "inventory") {
    return "My Inventory";
  }

  return "Catalog";
}

function receiptDestinationLabel(
  item: TradeAsset
) {
  if (!item.claimed_at) {
    return "Received";
  }

  if (
    item.destination === "inventory"
  ) {
    return "My Inventory";
  }

  if (
    item.destination === "collection"
  ) {
    return "My Collection";
  }

  return "Received";
}

function TradeAssetCard({
  item,
  mode,
}: {
  item: TradeAsset;
  mode: "gave" | "received";
}) {
  const imageUrl =
    assetImage(item);

  return (
    <div className="rounded-2xl border border-zinc-900 bg-black p-3">
      <div className="flex gap-3">
        <div className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-900 bg-zinc-950">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={assetName(item)}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="px-2 text-center">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-emerald-400">
                MintRadar
              </p>
              <p className="mt-1 text-[9px] text-zinc-700">
                No Image
              </p>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-black text-white">
                {assetName(item)}
              </p>

              <p className="mt-1 text-xs text-zinc-600">
                {assetSubtitle(item) ||
                  "MintRadar collectible"}
              </p>
            </div>

            <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
              Qty{" "}
              {Math.max(
                1,
                Number(item.quantity || 1)
              )}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
              {assetDetails(item)}
            </span>

            {mode === "gave" ? (
              <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                From {assetSourceLabel(item)}
              </span>
            ) : (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                {receiptDestinationLabel(
                  item
                )}
              </span>
            )}
          </div>

          {mode === "gave" &&
            item.market_value != null && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-zinc-900 bg-zinc-950 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-wider text-zinc-700">
                    Market
                  </p>
                  <p className="mt-1 text-sm font-black text-zinc-300">
                    {money(
                      item.market_value
                    )}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-900 bg-zinc-950 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-wider text-zinc-700">
                    Trade Value
                  </p>
                  <p className="mt-1 text-sm font-black text-emerald-300">
                    {money(
                      item.adjusted_trade_value ??
                        item.market_value
                    )}
                  </p>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

export default function TradeHistoryPage() {
  const router = useRouter();

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [trades, setTrades] =
    useState<TradeHistoryItem[]>([]);

  const [isVendorUser, setIsVendorUser] =
    useState(false);

  const [filter, setFilter] =
    useState<
      "all" | "collection" | "inventory"
    >("all");

  async function loadTradeHistory() {
    try {
      setLoading(true);
      setError("");

      const {
        data: { session },
        error: sessionError,
      } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        router.replace(
          "/customer/login"
        );
        return;
      }

      const membership =
        await getActiveVendorMembership(
          supabase,
          session.user.id
        );

      setIsVendorUser(
        Boolean(membership)
      );

      const {
        data,
        error: historyError,
      } = await supabase.rpc(
        "get_my_trade_history"
      );

      if (historyError) {
        throw historyError;
      }

      setTrades(
        (data || []).map(
          (row: any) => ({
            ...row,
            gave_items:
              Array.isArray(
                row.gave_items
              )
                ? row.gave_items
                : [],
            received_items:
              Array.isArray(
                row.received_items
              )
                ? row.received_items
                : [],
          })
        ) as TradeHistoryItem[]
      );
    } catch (err: any) {
      console.error(
        "Trade history load error:",
        err
      );

      setError(
        err?.message ||
          "MintRadar could not load your trade history."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTradeHistory();
  }, []);

  const stats =
    useMemo(() => {
      let receivedCount = 0;
      let collectionCount = 0;
      let inventoryCount = 0;

      for (const trade of trades) {
        for (const item of
          trade.received_items) {
          receivedCount +=
            Math.max(
              1,
              Number(
                item.quantity || 1
              )
            );

          if (
            item.claimed_at &&
            item.destination ===
              "collection"
          ) {
            collectionCount += 1;
          } else if (
            item.claimed_at &&
            item.destination ===
              "inventory"
          ) {
            inventoryCount += 1;
          }
        }
      }

      return {
        tradeCount: trades.length,
        receivedCount,
        collectionCount,
        inventoryCount,
      };
    }, [trades]);

  const filteredTrades =
    useMemo(() => {
      if (filter === "all") {
        return trades;
      }

      return trades.filter(
        (trade) =>
          trade.received_items.some(
            (item) =>
              item.claimed_at &&
              item.destination ===
                filter
          )
      );
    }, [trades, filter]);

  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 border-b border-zinc-900 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/messages"
              className="text-xs font-black uppercase tracking-[0.18em] text-zinc-600 transition hover:text-emerald-400"
            >
              ← Back to Messages
            </Link>

            <p className="mt-6 text-xs font-black uppercase tracking-[0.24em] text-emerald-400">
              MintRadar
            </p>

            <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">
              Trade History
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
              Every completed MintRadar trade, what you gave, what you received, and where those cards went next.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void loadTradeHistory()
            }
            disabled={loading}
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-black text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-300 disabled:opacity-40"
          >
            {loading
              ? "Refreshing..."
              : "Refresh History"}
          </button>
        </header>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm font-bold text-red-300">
            {error}
          </div>
        )}

        <section
          className={`mt-7 grid gap-3 sm:grid-cols-2 ${
            isVendorUser
              ? "lg:grid-cols-4"
              : "lg:grid-cols-3"
          }`}
        >
          <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-700">
              Completed Trades
            </p>
            <p className="mt-2 text-3xl font-black">
              {stats.tradeCount}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-700">
              Cards Received
            </p>
            <p className="mt-2 text-3xl font-black text-emerald-300">
              {stats.receivedCount}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-700">
              Added to Collection
            </p>
            <p className="mt-2 text-3xl font-black">
              {stats.collectionCount}
            </p>
          </div>

          {isVendorUser && (
            <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-700">
                Added to Inventory
              </p>
              <p className="mt-2 text-3xl font-black">
                {stats.inventoryCount}
              </p>
            </div>
          )}
        </section>

        <section className="mt-6">
          <div className="flex flex-wrap gap-2">
            {[
              ["all", "All Trades"],
              [
                "collection",
                "Added to Collection",
              ],
              ...(isVendorUser
                ? [
                    [
                      "inventory",
                      "Added to Inventory",
                    ],
                  ]
                : []),
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  setFilter(
                    value as
                      | "all"
                      | "collection"
                      | "inventory"
                  )
                }
                className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-wider transition ${
                  filter === value
                    ? "border-emerald-400 bg-emerald-400 text-black"
                    : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-7 space-y-5">
          {loading ? (
            <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-8 text-center">
              <p className="font-black text-emerald-400">
                Loading trade history...
              </p>
            </div>
          ) : filteredTrades.length ===
            0 ? (
            <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-8 text-center">
              <p className="text-xl font-black">
                {trades.length === 0
                  ? "No completed trades yet."
                  : "No trades match this filter."}
              </p>

              <p className="mt-2 text-sm text-zinc-600">
                {trades.length === 0
                  ? "Completed trades will appear here automatically."
                  : "Try another Trade History filter."}
              </p>
            </div>
          ) : (
            filteredTrades.map(
              (trade) => (
                <article
                  key={
                    trade.trade_transaction_id
                  }
                  className="overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950"
                >
                  <div className="flex flex-col gap-4 border-b border-zinc-900 bg-black/40 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                          Completed
                        </span>

                        <span className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-600">
                          {trade.role_in_trade ===
                          "offer_sender"
                            ? "Offer Sender"
                            : "Offer Recipient"}
                        </span>
                      </div>

                      <p className="mt-3 text-sm font-bold text-zinc-400">
                        {dateTime(
                          trade.completed_at
                        )}
                      </p>

                      <p className="mt-1 font-mono text-[10px] text-zinc-800">
                        {trade.trade_transaction_id}
                      </p>
                    </div>

                    <Link
                      href={`/messages/${trade.conversation_id}`}
                      className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-center text-xs font-black uppercase tracking-wider text-zinc-400 transition hover:border-emerald-400/40 hover:text-emerald-300"
                    >
                      Open Conversation
                    </Link>
                  </div>

                  <div className="grid gap-0 lg:grid-cols-2">
                    <div className="border-b border-zinc-900 p-5 lg:border-b-0 lg:border-r">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-300">
                            You Gave
                          </p>
                          <p className="mt-1 text-xs text-zinc-700">
                            Assets that left your ownership.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {trade.gave_items.length >
                        0 ? (
                          trade.gave_items.map(
                            (item, index) => (
                              <TradeAssetCard
                                key={
                                  item.trade_offer_item_id ||
                                  item.card_id ||
                                  index
                                }
                                item={item}
                                mode="gave"
                              />
                            )
                          )
                        ) : (
                          <div className="rounded-2xl border border-zinc-900 bg-black p-4 text-sm text-zinc-700">
                            No outgoing assets were recorded.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-5">
                      <div className="mb-4">
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                          You Received
                        </p>
                        <p className="mt-1 text-xs text-zinc-700">
                          Assets received and their current MintRadar destination.
                        </p>
                      </div>

                      <div className="space-y-3">
                        {trade.received_items
                          .length > 0 ? (
                          trade.received_items.map(
                            (item, index) => (
                              <TradeAssetCard
                                key={
                                  item.received_item_id ||
                                  item.card_id ||
                                  index
                                }
                                item={item}
                                mode="received"
                              />
                            )
                          )
                        ) : (
                          <div className="rounded-2xl border border-zinc-900 bg-black p-4">
                            <p className="text-sm font-black text-amber-300">
                              Receipt unavailable
                            </p>
                            <p className="mt-1 text-xs text-zinc-700">
                              This trade may predate MintRadar&apos;s received-item ledger.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-px border-t border-zinc-900 bg-zinc-900 sm:grid-cols-4">
                    <div className="bg-zinc-950 p-4">
                      <p className="text-[9px] font-black uppercase tracking-wider text-zinc-700">
                        Target Value
                      </p>
                      <p className="mt-1 font-black">
                        {money(
                          trade.target_market_value
                        )}
                      </p>
                    </div>

                    <div className="bg-zinc-950 p-4">
                      <p className="text-[9px] font-black uppercase tracking-wider text-zinc-700">
                        Offered Market
                      </p>
                      <p className="mt-1 font-black">
                        {money(
                          trade.offered_market_total
                        )}
                      </p>
                    </div>

                    <div className="bg-zinc-950 p-4">
                      <p className="text-[9px] font-black uppercase tracking-wider text-zinc-700">
                        Offered Trade
                      </p>
                      <p className="mt-1 font-black text-emerald-300">
                        {money(
                          trade.offered_trade_total
                        )}
                      </p>
                    </div>

                    <div className="bg-zinc-950 p-4">
                      <p className="text-[9px] font-black uppercase tracking-wider text-zinc-700">
                        Difference
                      </p>
                      <p className="mt-1 font-black">
                        {money(
                          trade.difference
                        )}
                      </p>
                    </div>
                  </div>
                </article>
              )
            )
          )}
        </section>
      </div>
    </main>
  );
}
