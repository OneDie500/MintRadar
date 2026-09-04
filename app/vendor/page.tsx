"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import QRCode from "qrcode";

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
};

type InventoryItem = {
  id: string;
  vendor_id: string;
  card_id: string;

  listing_type?: string | null;

  condition?: string | null;

  grading_company?: string | null;
  grade?: string | null;
  cert_number?: string | null;

  price?: number | null;
  quantity?: number | null;
  notes?: string | null;

  cards?: Card | null;
};

type Vendor = {
  id: string;
  business_name?: string | null;
};

type Membership = {
  vendor_id: string;
  role?: string | null;
  vendors?: Vendor | null;
};

export default function VendorDashboardPage() {
  const router = useRouter();

  const [vendorId, setVendorId] =
    useState<string | null>(null);

  const [vendorName, setVendorName] =
    useState("MintRadar Vendor");

  const [role, setRole] =
    useState<string | null>(null);

  const [inventory, setInventory] =
    useState<InventoryItem[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [savingId, setSavingId] =
    useState<string | null>(null);

  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  const [qrItem, setQrItem] =
    useState<InventoryItem | null>(null);

  const [qrDataUrl, setQrDataUrl] =
    useState("");

  const [qrLoading, setQrLoading] =
    useState(false);

  const [qrError, setQrError] =
    useState("");

  // -----------------------------------------
  // LOAD CURRENT VENDOR
  // -----------------------------------------

  useEffect(() => {
    async function loadVendor() {
      try {
        setLoading(true);
        setError("");

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session) {
          router.replace("/vendor/login");
          return;
        }

        const {
          data: membership,
          error: membershipError,
        } = await supabase
          .from("vendor_members")
          .select(`
            vendor_id,
            role,
            vendors (
              id,
              business_name
            )
          `)
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (membershipError) {
          throw membershipError;
        }

        if (!membership) {
          setError(
            "Your login works, but this account is not connected to a vendor yet."
          );
          setLoading(false);
          return;
        }

        const typedMembership =
          membership as unknown as Membership;

        setVendorId(
          typedMembership.vendor_id
        );

        setRole(
          typedMembership.role || null
        );

        setVendorName(
          typedMembership.vendors
            ?.business_name ||
            "MintRadar Vendor"
        );
      } catch (err: any) {
        console.error(
          "Vendor dashboard error:",
          err
        );

        setError(
          err?.message ||
            "We couldn't load your vendor account."
        );

        setLoading(false);
      }
    }

    loadVendor();
  }, [router]);

  // -----------------------------------------
  // LOAD INVENTORY
  // -----------------------------------------

  useEffect(() => {
    if (!vendorId) {
      return;
    }

    async function loadInventory() {
      try {
        setLoading(true);
        setError("");

        const {
          data,
          error: inventoryError,
        } = await supabase
          .from("inventory")
          .select(`
            id,
            vendor_id,
            card_id,
            listing_type,
            condition,
            grading_company,
            grade,
            cert_number,
            price,
            quantity,
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
            )
          `)
          .eq("vendor_id", vendorId)
          .order("id", {
            ascending: false,
          });

        if (inventoryError) {
          throw inventoryError;
        }

        setInventory(
          (data || []) as unknown as InventoryItem[]
        );
      } catch (err: any) {
        console.error(
          "Inventory load error:",
          err
        );

        setError(
          err?.message ||
            "We couldn't load your inventory."
        );
      } finally {
        setLoading(false);
      }
    }

    loadInventory();

    const channel = supabase
      .channel(
        `vendor-inventory-${vendorId}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory",
          filter: `vendor_id=eq.${vendorId}`,
        },
        () => {
          loadInventory();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vendorId]);

  // -----------------------------------------
  // UPDATE QUANTITY
  // -----------------------------------------

  async function updateQuantity(
    item: InventoryItem,
    change: number
  ) {
    const currentQuantity =
      item.quantity ?? 0;

    const newQuantity =
      Math.max(
        0,
        currentQuantity + change
      );

    // Reaching zero with the minus button removes the listing completely.
    if (
      change < 0 &&
      currentQuantity > 0 &&
      newQuantity === 0
    ) {
      setDeletingId(item.id);
      setError("");

      const { error: deleteError } =
        await supabase
          .from("inventory")
          .delete()
          .eq("id", item.id)
          .eq(
            "vendor_id",
            item.vendor_id
          );

      if (deleteError) {
        console.error(
          "Zero-quantity delete error:",
          deleteError
        );

        setError(
          deleteError.message ||
            "This listing could not be removed."
        );

        setDeletingId(null);
        return;
      }

      setInventory((current) =>
        current.filter(
          (inventoryItem) =>
            inventoryItem.id !== item.id
        )
      );

      setDeletingId(null);
      return;
    }

    setSavingId(item.id);

    setInventory((current) =>
      current.map((inventoryItem) =>
        inventoryItem.id === item.id
          ? {
              ...inventoryItem,
              quantity: newQuantity,
            }
          : inventoryItem
      )
    );

    const { error: updateError } =
      await supabase
        .from("inventory")
        .update({
          quantity: newQuantity,
        })
        .eq("id", item.id)
        .eq(
          "vendor_id",
          item.vendor_id
        );

    if (updateError) {
      console.error(
        "Quantity update error:",
        updateError
      );

      setInventory((current) =>
        current.map((inventoryItem) =>
          inventoryItem.id === item.id
            ? {
                ...inventoryItem,
                quantity:
                  currentQuantity,
              }
            : inventoryItem
        )
      );

      setError(
        "Quantity could not be updated."
      );
    }

    setSavingId(null);
  }

  // -----------------------------------------
  // DELETE LISTING
  // -----------------------------------------

  async function deleteListing(
    item: InventoryItem
  ) {
    const cardName =
      item.cards?.name || "this listing";

    const okay = window.confirm(
      `Delete ${cardName} from your MintRadar inventory? This removes the listing completely and cannot be undone.`
    );

    if (!okay) {
      return;
    }

    setDeletingId(item.id);
    setError("");

    const { error: deleteError } =
      await supabase
        .from("inventory")
        .delete()
        .eq("id", item.id)
        .eq(
          "vendor_id",
          item.vendor_id
        );

    if (deleteError) {
      console.error(
        "Delete listing error:",
        deleteError
      );

      setError(
        deleteError.message ||
          "This listing could not be deleted."
      );

      setDeletingId(null);
      return;
    }

    setInventory((current) =>
      current.filter(
        (inventoryItem) =>
          inventoryItem.id !== item.id
      )
    );

    setDeletingId(null);
  }

  // -----------------------------------------
  // QR LABELS
  // -----------------------------------------

  async function openQrLabel(
    item: InventoryItem
  ) {
    setQrItem(item);
    setQrDataUrl("");
    setQrError("");
    setQrLoading(true);

    try {
      const listingUrl =
        `${window.location.origin}/listing/${item.id}`;

      const dataUrl =
        await QRCode.toDataURL(
          listingUrl,
          {
            width: 420,
            margin: 1,
            errorCorrectionLevel: "H",
          }
        );

      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error(
        "QR generation error:",
        err
      );

      setQrError(
        "Could not generate this QR code."
      );
    } finally {
      setQrLoading(false);
    }
  }

  function closeQrLabel() {
    setQrItem(null);
    setQrDataUrl("");
    setQrError("");
    setQrLoading(false);
  }

  function printQrLabel() {
    if (
      !qrItem ||
      !qrDataUrl
    ) {
      return;
    }

    const card =
      qrItem.cards;

    const graded =
      isGraded(qrItem);

    const listingLabel =
      getListingLabel(qrItem);

    const price =
      Number(
        qrItem.price ?? 0
      ).toFixed(2);

    const details =
      graded
        ? `${qrItem.grading_company || ""} ${qrItem.grade || ""}`.trim()
        : listingLabel;

    const printWindow =
      window.open(
        "",
        "_blank",
        "width=480,height=640"
      );

    if (!printWindow) {
      setQrError(
        "Your browser blocked the print window. Allow pop-ups and try again."
      );
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>MintRadar Label</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            * {
              box-sizing: border-box;
            }

            html,
            body {
              margin: 0;
              padding: 0;
              background: #fff;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
            }

            body {
              display: flex;
              justify-content: center;
              padding: 8px;
            }

            .label {
              width: 2in;
              min-height: 2in;
              border: 1px solid #000;
              padding: 0.08in;
              text-align: center;
              overflow: hidden;
            }

            .brand {
              font-size: 9px;
              font-weight: 900;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              margin-bottom: 4px;
            }

            .vendor {
              font-size: 10px;
              font-weight: 900;
              margin-bottom: 4px;
            }

            .name {
              font-size: 12px;
              line-height: 1.1;
              font-weight: 900;
              margin: 2px 0;
            }

            .meta {
              font-size: 8px;
              line-height: 1.2;
              margin: 2px 0;
            }

            .price {
              font-size: 18px;
              line-height: 1;
              font-weight: 900;
              margin: 5px 0;
            }

            .qr {
              width: 0.85in;
              height: 0.85in;
              image-rendering: pixelated;
              display: block;
              margin: 4px auto;
            }

            .scan {
              font-size: 7px;
              line-height: 1.1;
              font-weight: 700;
              margin-top: 2px;
            }

            @page {
              size: 2in 2in;
              margin: 0;
            }

            @media print {
              body {
                padding: 0;
              }

              .label {
                border: none;
                width: 2in;
                min-height: 2in;
              }
            }
          </style>
        </head>
        <body>
          <div class="label">
            <div class="brand">MintRadar Live Price</div>
            <div class="vendor">${escapeHtml(vendorName)}</div>
            <div class="name">${escapeHtml(card?.name || "Unknown Card")}</div>
            <div class="meta">${escapeHtml(
              [card?.set_name, card?.card_number ? `#${card.card_number}` : null]
                .filter(Boolean)
                .join(" • ")
            )}</div>
            <div class="meta">${escapeHtml(details || "Raw")}</div>
            <div class="price">$${price}</div>
            <img class="qr" src="${qrDataUrl}" alt="QR code" />
            <div class="scan">Scan for current vendor price & listing details</div>
          </div>

          <script>
            window.onload = function () {
              window.print();
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
  }

  function escapeHtml(
    value: string
  ) {
    return value
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
      );
  }

  // -----------------------------------------
  // HELPERS
  // -----------------------------------------

  function isGraded(
    item: InventoryItem
  ) {
    return (
      item.listing_type ===
      "graded"
    );
  }

  function getListingLabel(
    item: InventoryItem
  ) {
    if (
      isGraded(item)
    ) {
      const company =
        item.grading_company ||
        "Graded";

      const grade =
        item.grade || "";

      return `${company} ${grade}`.trim();
    }

    return (
      item.condition ||
      "Raw"
    );
  }

  // -----------------------------------------
  // LOADING
  // -----------------------------------------

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-emerald-400 text-xs uppercase tracking-[0.25em] font-bold">
            MintRadar
          </p>

          <p className="text-zinc-500 mt-3">
            Loading vendor dashboard...
          </p>
        </div>
      </main>
    );
  }

  // -----------------------------------------
  // ACCOUNT ERROR
  // -----------------------------------------

  if (error && !vendorId) {
    return (
      <main className="min-h-screen bg-black text-white px-5 py-10">
        <div className="max-w-2xl mx-auto">
          <div className="bg-zinc-950 border border-red-400/30 rounded-3xl p-8">

            <p className="text-red-400 text-xs uppercase tracking-[0.2em] font-bold">
              Vendor Account Issue
            </p>

            <h1 className="text-3xl font-black mt-3">
              We couldn't load your
              dashboard.
            </h1>

            <p className="text-zinc-400 mt-4">
              {error}
            </p>

            <Link
              href="/"
              className="inline-block mt-7 bg-white text-black px-5 py-3 rounded-xl font-black"
            >
              Back to Marketplace
            </Link>

          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">

      {/* HEADER */}

      <header className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-5 py-5 flex items-center justify-between gap-5">

          <Link
            href="/"
            className="font-black text-xl"
          >
            Mint
            <span className="text-emerald-400">
              Radar
            </span>
          </Link>

          <div className="flex items-center gap-3">

          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-5 py-8">

        {/* INTRO */}

        <section className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-8">

          <div>
            <p className="text-emerald-400 text-xs uppercase tracking-[0.25em] font-bold">
              Vendor Dashboard
            </p>

            <h1 className="text-4xl sm:text-5xl font-black mt-2">
              {vendorName}
            </h1>

            <div className="flex flex-wrap gap-2 mt-3">

              {role && (
                <span className="bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1 text-xs uppercase tracking-wider text-zinc-400">
                  {role}
                </span>
              )}

              <span className="bg-emerald-400/10 border border-emerald-400/20 rounded-full px-3 py-1 text-xs text-emerald-400">
                Realtime Inventory
              </span>

            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/"
              className="border border-zinc-800 bg-zinc-950 hover:border-emerald-400 hover:text-emerald-300 text-white font-black px-6 py-4 rounded-xl text-center transition"
              title="Browse MintRadar without signing out"
            >
              Browse Marketplace
            </Link>

            <Link
              href="/vendor/add"
              className="bg-emerald-400 hover:bg-emerald-300 text-black font-black px-6 py-4 rounded-xl text-center transition"
            >
              + Add Item
            </Link>
          </div>

        </section>

        {/* STATS */}

        <section className="grid sm:grid-cols-3 gap-4 mb-8">

          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5">
            <p className="text-zinc-500 text-sm">
              Listings
            </p>

            <p className="text-3xl font-black mt-1">
              {inventory.length}
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5">
            <p className="text-zinc-500 text-sm">
              Total Items
            </p>

            <p className="text-3xl font-black mt-1">
              {inventory.reduce(
                (total, item) =>
                  total +
                  (item.quantity ?? 0),
                0
              )}
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5">
            <p className="text-zinc-500 text-sm">
              Inventory Value
            </p>

            <p className="text-3xl font-black mt-1">
              $
              {inventory
                .reduce(
                  (total, item) =>
                    total +
                    (item.price ?? 0) *
                      (item.quantity ??
                        0),
                  0
                )
                .toLocaleString(
                  undefined,
                  {
                    minimumFractionDigits:
                      2,
                    maximumFractionDigits:
                      2,
                  }
                )}
            </p>
          </div>

        </section>

        {/* ERROR */}

        {error && (
          <div className="mb-6 bg-red-400/10 border border-red-400/30 text-red-300 rounded-xl p-4">
            {error}
          </div>
        )}

        {/* EMPTY */}

        {inventory.length === 0 ? (
          <section className="bg-zinc-950 border border-zinc-900 rounded-3xl p-10 text-center">

            <p className="text-emerald-400 text-xs uppercase tracking-[0.2em] font-bold">
              Inventory
            </p>

            <h2 className="text-3xl font-black mt-3">
              Nothing listed yet.
            </h2>

            <p className="text-zinc-500 mt-3 max-w-lg mx-auto">
              Add your first collectible
              to make it searchable on
              MintRadar.
            </p>

            <Link
              href="/vendor/add"
              className="inline-block mt-7 bg-emerald-400 hover:bg-emerald-300 text-black font-black px-6 py-4 rounded-xl transition"
            >
              Add First Item
            </Link>

          </section>
        ) : (

          /* INVENTORY */

          <section>

            <div className="flex items-center justify-between mb-4">

              <div>
                <p className="text-emerald-400 text-xs uppercase tracking-[0.2em] font-bold">
                  Live Inventory
                </p>

                <h2 className="text-2xl font-black mt-1">
                  Your Listings
                </h2>
              </div>

              <p className="text-zinc-600 text-sm">
                {inventory.length}{" "}
                {inventory.length === 1
                  ? "listing"
                  : "listings"}
              </p>

            </div>

            <div className="space-y-3">

              {inventory.map(
                (item) => {
                  const card =
                    item.cards;

                  const quantity =
                    item.quantity ?? 0;

                  const graded =
                    isGraded(item);

                  return (
                    <div
                      key={item.id}
                      className={`bg-zinc-950 rounded-2xl p-4 sm:p-5 border ${
                        graded
                          ? "border-emerald-400/30"
                          : "border-zinc-900"
                      }`}
                    >

                      <div className="flex flex-col sm:flex-row sm:items-center gap-5">

                        {/* IMAGE */}

                        <div className="w-20 h-28 bg-black border border-zinc-900 rounded-xl overflow-hidden shrink-0">

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
                            <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs text-center p-2">
                              No Image
                            </div>
                          )}

                        </div>

                        {/* CARD INFO */}

                        <div className="flex-1 min-w-0">

                          <div className="flex flex-wrap items-center gap-2">

                            <h3 className="text-xl font-black">
                              {card?.name ||
                                "Unknown Card"}
                            </h3>

                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-black border ${
                                graded
                                  ? "bg-emerald-400/10 border-emerald-400/30 text-emerald-400"
                                  : "bg-zinc-900 border-zinc-800 text-zinc-300"
                              }`}
                            >
                              {getListingLabel(
                                item
                              )}
                            </span>

                          </div>

                          <p className="text-zinc-500 text-sm mt-1">

                            {card?.set_name ||
                              "Unknown Set"}

                            {card?.card_number
                              ? ` #${card.card_number}`
                              : ""}

                          </p>

                          {/* GRADED INFO */}

                          {graded && (
                            <div className="mt-3">

                              <p className="text-sm font-black text-white">
                                {
                                  item.grading_company
                                }{" "}
                                {
                                  item.grade
                                }
                              </p>

                              {item.cert_number && (
                                <p className="text-xs text-zinc-600 mt-1">
                                  Cert #
                                  {
                                    item.cert_number
                                  }
                                </p>
                              )}

                            </div>
                          )}

                          {/* RAW INFO */}

                          {!graded && (
                            <div className="flex flex-wrap gap-2 mt-3">

                              {card?.edition && (
                                <span className="text-xs text-zinc-400 bg-black border border-zinc-900 rounded-lg px-2 py-1">
                                  {
                                    card.edition
                                  }
                                </span>
                              )}

                              {card?.finish && (
                                <span className="text-xs text-zinc-400 bg-black border border-zinc-900 rounded-lg px-2 py-1">
                                  {
                                    card.finish
                                  }
                                </span>
                              )}

                            </div>
                          )}

                          {item.notes && (
                            <p className="text-zinc-600 text-sm mt-3">
                              {
                                item.notes
                              }
                            </p>
                          )}

                        </div>

                        {/* PRICE */}

                        <div className="sm:text-right sm:min-w-28">

                          <p className="text-xs uppercase tracking-wider text-zinc-600">
                            Price
                          </p>

                          <p className="text-2xl font-black text-emerald-400 mt-1">
                            $
                            {Number(
                              item.price ??
                                0
                            ).toFixed(2)}
                          </p>

                        </div>

                        {/* QUANTITY */}

                        <div className="sm:min-w-44">

                          <p className="text-xs uppercase tracking-wider text-zinc-600 mb-2">
                            Quantity
                          </p>

                          <div className="flex items-center gap-2">

                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(
                                  item,
                                  -1
                                )
                              }
                              disabled={
                                savingId === item.id ||
                                deletingId === item.id
                              }
                              className="w-10 h-10 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl font-black disabled:opacity-50 transition"
                            >
                              −
                            </button>

                            <div className="min-w-12 h-10 bg-black border border-zinc-900 rounded-xl flex items-center justify-center font-black">
                              {quantity}
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(
                                  item,
                                  1
                                )
                              }
                              disabled={
                                savingId === item.id ||
                                deletingId === item.id
                              }
                              className="w-10 h-10 bg-emerald-400 hover:bg-emerald-300 text-black rounded-xl font-black disabled:opacity-50 transition"
                            >
                              +
                            </button>

                          </div>

                          {savingId ===
                            item.id && (
                            <p className="text-xs text-zinc-600 mt-2">
                              Saving...
                            </p>
                          )}

                        </div>

                        {/* LISTING ACTIONS */}

                        <div className="sm:min-w-36">
                          <p className="text-xs uppercase tracking-wider text-zinc-600 mb-2">
                            Listing
                          </p>

                          <div className="flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                openQrLabel(
                                  item
                                )
                              }
                              disabled={
                                deletingId === item.id
                              }
                              className="w-full rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              QR Code
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                deleteListing(
                                  item
                                )
                              }
                              disabled={
                                deletingId === item.id ||
                                savingId === item.id
                              }
                              className="w-full rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm font-black text-red-300 transition hover:bg-red-400/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {deletingId === item.id
                                ? "Deleting..."
                                : "Delete Listing"}
                            </button>
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                }
              )}

            </div>

          </section>
        )}

      </div>

      {qrItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-5"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeQrLabel();
            }
          }}
        >
          <div className="w-full max-w-md rounded-t-3xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-5 border-b border-zinc-900 p-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                  Printable QR Label
                </p>

                <h2 className="mt-2 text-2xl font-black">
                  {qrItem.cards?.name ||
                    "Unknown Card"}
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {vendorName}
                </p>
              </div>

              <button
                type="button"
                onClick={closeQrLabel}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-black text-xl text-zinc-400 transition hover:text-white"
                aria-label="Close QR label"
              >
                ×
              </button>
            </div>

            <div className="p-5">
              {qrLoading ? (
                <div className="py-12 text-center text-zinc-500">
                  Generating QR code...
                </div>
              ) : qrError ? (
                <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-sm text-red-300">
                  {qrError}
                </div>
              ) : qrDataUrl ? (
                <>
                  <div className="mx-auto w-[250px] rounded-2xl bg-white p-4 text-center text-black">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em]">
                      MintRadar Live Price
                    </p>

                    <p className="mt-1 text-xs font-black">
                      {vendorName}
                    </p>

                    <p className="mt-2 text-sm font-black leading-tight">
                      {qrItem.cards?.name ||
                        "Unknown Card"}
                    </p>

                    <p className="mt-1 text-[10px]">
                      {[
                        qrItem.cards?.set_name,
                        qrItem.cards?.card_number
                          ? `#${qrItem.cards.card_number}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </p>

                    <p className="mt-1 text-[10px] font-bold">
                      {getListingLabel(
                        qrItem
                      )}
                    </p>

                    <p className="my-2 text-2xl font-black">
                      $
                      {Number(
                        qrItem.price ?? 0
                      ).toFixed(2)}
                    </p>

                    <img
                      src={qrDataUrl}
                      alt="Listing QR code"
                      className="mx-auto h-36 w-36"
                    />

                    <p className="mt-2 text-[9px] font-bold">
                      Scan for current vendor price
                    </p>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <a
                      href={`/listing/${qrItem.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-zinc-800 bg-black px-4 py-3 text-center text-sm font-black text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                    >
                      Preview
                    </a>

                    <button
                      type="button"
                      onClick={printQrLabel}
                      className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-300"
                    >
                      Print Label
                    </button>
                  </div>

                  <p className="mt-4 text-center text-xs text-zinc-600">
                    The QR stays the same when you update the price.
                  </p>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}