"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TradeAnalyzer from "../components/TradeAnalyzer";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { getActiveVendorMembership } from "../../lib/active-vendor";
import QRCode from "qrcode";

type Card = {
  id: string;
  external_id?: string | null;
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

type LabelOrientation = "vertical" | "horizontal";

function normalizeImageCategory(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function isSportsCategory(value?: string | null) {
  const normalized = normalizeImageCategory(value);

  return [
    "sports",
    "baseball",
    "basketball",
    "football",
    "soccer",
    "hockey",
    "wrestling",
    "racing",
    "golf",
  ].some((term) => normalized.includes(term));
}

function VendorCardImage({
  card,
}: {
  card?: Card | null;
}) {
  const [currentSrc, setCurrentSrc] =
    useState<string | null>(card?.image_url || null);

  const [sportsFallbackAttempted, setSportsFallbackAttempted] =
    useState(false);

  const [imageFailed, setImageFailed] =
    useState(false);

  const sportsCard =
    isSportsCategory(card?.category);

  useEffect(() => {
    setCurrentSrc(card?.image_url || null);
    setSportsFallbackAttempted(false);
    setImageFailed(false);
  }, [
    card?.id,
    card?.external_id,
    card?.image_url,
    card?.category,
  ]);

  function trySportsFallback() {
    if (
      !sportsCard ||
      sportsFallbackAttempted ||
      !card?.external_id?.trim()
    ) {
      setImageFailed(true);
      return;
    }

    setSportsFallbackAttempted(true);
    setImageFailed(false);

    setCurrentSrc(
      `/api/catalog/sports-image?id=${encodeURIComponent(
        card.external_id.trim()
      )}`
    );
  }

  useEffect(() => {
    if (
      !currentSrc &&
      !sportsFallbackAttempted &&
      !imageFailed
    ) {
      if (sportsCard) {
        trySportsFallback();
      } else {
        setImageFailed(true);
      }
    }
  }, [
    currentSrc,
    sportsCard,
    sportsFallbackAttempted,
    imageFailed,
  ]);

  if (imageFailed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center p-2">
        <p className="text-emerald-400 text-[9px] font-black uppercase tracking-[0.12em]">
          MintRadar
        </p>
        <p className="text-zinc-700 text-[10px] mt-1">
          No Image
        </p>
      </div>
    );
  }

  if (!currentSrc) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs text-center p-2">
        Loading...
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={card?.name || "Card"}
      className="w-full h-full object-contain"
      onError={() => {
        const alreadyUsingSportsRoute =
          currentSrc.startsWith(
            "/api/catalog/sports-image?"
          );

        if (
          sportsCard &&
          !alreadyUsingSportsRoute
        ) {
          trySportsFallback();
          return;
        }

        setImageFailed(true);
      }}
    />
  );
}


function DashboardCompButtons({
  item,
}: {
  item: InventoryItem;
}) {
  const card = item.cards;

  if (!card) {
    return null;
  }

  const sports = isSportsCategory(card.category);
  const graded =
    item.listing_type === "graded";

  const baseQuery = [
    card.name,
    card.set_name,
    card.card_number
      ? `#${card.card_number}`
      : null,
    card.edition,
    card.finish,
  ]
    .filter(Boolean)
    .join(" ");

  const query = [
    baseQuery,
    graded
      ? item.grading_company
      : null,
    graded && item.grade
      ? `Grade ${item.grade}`
      : null,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const encodedQuery =
    encodeURIComponent(query);

  const links = sports
    ? [
        {
          name: "Card Ladder",
          logo: "/market-logos/cardladder.png",
          description:
            "Sports card sales and market data",
          href: `https://www.cardladder.com/ladder?query=${encodedQuery}`,
        },
        {
          name: "130point",
          logo: "/market-logos/130point.png",
          description:
            "Search recent sports card sales",
          href: "https://130point.com/search/",
        },
        {
          name: "eBay Sold",
          logo: "/market-logos/ebay.png",
          description:
            "Completed and sold listings",
          href: `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&LH_Sold=1&LH_Complete=1`,
        },
      ]
    : [
        {
          name: "TCGplayer",
          logo: "/market-logos/tcgplayer.png",
          description:
            "Search current TCG marketplace listings",
          href: `https://www.tcgplayer.com/search/all/product?q=${encodedQuery}`,
        },
        {
          name: "PriceCharting",
          logo: "/market-logos/pricecharting.png",
          description:
            "Search historical pricing",
          href: `https://www.pricecharting.com/search-products?q=${encodedQuery}&type=prices`,
        },
        {
          name: "Collectr",
          logo: "/market-logos/collectr.svg",
          description:
            "Open Collectr product search",
          href: "https://app.getcollectr.com/",
        },
        {
          name: "130point",
          logo: "/market-logos/130point.png",
          description:
            "Search recent collectible card sales",
          href: "https://130point.com/search/",
        },
        {
          name: "eBay Sold",
          logo: "/market-logos/ebay.png",
          description:
            "Completed and sold listings",
          href: `https://www.ebay.com/sch/i.html?_nkw=${encodedQuery}&LH_Sold=1&LH_Complete=1`,
        },
      ];

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-400/25 bg-black">
      <div className="border-b border-zinc-900 bg-emerald-400/[0.05] px-4 py-4 sm:px-5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
          📡 Market Radar
        </p>

        <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="text-lg font-black">
            Check Comps Before You Reprice
          </h3>

          <p className="text-xs text-zinc-600">
            Opens in a new tab
          </p>
        </div>

        <p className="mt-2 text-sm leading-6 text-zinc-500">
          {sports
            ? "Sports comps prioritize Card Ladder, 130point and eBay sold listings."
            : "TCG comps prioritize TCGplayer, PriceCharting, Collectr, 130point and eBay sold listings."}
        </p>
      </div>

      <div className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">
        {links.map((market) => (
          <a
            key={market.name}
            href={market.href}
            target="_blank"
            rel="noreferrer"
            className="group flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04]"
          >
            <div className="min-w-0">
              <p className="font-black text-white transition group-hover:text-emerald-300">
                {market.name}
              </p>

              <p className="mt-1 text-xs text-zinc-600">
                {market.description}
              </p>
            </div>

            <div className="flex h-12 w-24 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-transparent px-2.5 py-2 transition group-hover:border-emerald-400/40">
              <img
                src={market.logo}
                alt={`${market.name} logo`}
                className="max-h-8 max-w-full object-contain"
              />
            </div>
          </a>
        ))}
      </div>

      {query && (
        <div className="border-t border-zinc-900 px-4 py-3 sm:px-5">
          <p className="truncate text-[11px] text-zinc-700">
            Search: {query}
          </p>
        </div>
      )}
    </div>
  );
}

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

  const [labelOrientation, setLabelOrientation] =
    useState<LabelOrientation>("vertical");

  const [showPriceOnLabel, setShowPriceOnLabel] =
    useState(false);

  const [editItem, setEditItem] =
    useState<InventoryItem | null>(null);

  const [editPrice, setEditPrice] =
    useState("");

  const [editSaving, setEditSaving] =
    useState(false);

  const [editError, setEditError] =
    useState("");

  // -----------------------------------------
  // LOAD SAVED PRINT PREFERENCES
  // -----------------------------------------

  useEffect(() => {
    const savedOrientation =
      window.localStorage.getItem(
        "mintradar-label-orientation"
      );

    if (
      savedOrientation === "vertical" ||
      savedOrientation === "horizontal"
    ) {
      setLabelOrientation(savedOrientation);
    }
  }, []);

  function chooseLabelOrientation(
    orientation: LabelOrientation
  ) {
    setLabelOrientation(orientation);

    window.localStorage.setItem(
      "mintradar-label-orientation",
      orientation
    );
  }

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

        const membership =
          await getActiveVendorMembership(
            supabase,
            session.user.id
          );

        if (!membership) {
          setError(
            "Your login works, but this account is not connected to a vendor yet."
          );
          setLoading(false);
          return;
        }

        setVendorId(
          membership.vendor_id
        );

        setRole(
          membership.role || null
        );

        setVendorName(
          membership.vendor
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
              external_id,
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
  // EDIT LISTING PRICE
  // -----------------------------------------

  function openEditListing(
    item: InventoryItem
  ) {
    setEditItem(item);
    setEditPrice(
      Number(item.price ?? 0).toFixed(2)
    );
    setEditError("");
  }

  function closeEditListing() {
    if (editSaving) {
      return;
    }

    setEditItem(null);
    setEditPrice("");
    setEditError("");
  }

  async function saveListingPrice() {
    if (!editItem) {
      return;
    }

    const normalized =
      editPrice.trim().replace(
        /[$,]/g,
        ""
      );

    const nextPrice =
      Number(normalized);

    if (
      !normalized ||
      !Number.isFinite(nextPrice) ||
      nextPrice < 0
    ) {
      setEditError(
        "Enter a valid listing price."
      );
      return;
    }

    setEditSaving(true);
    setEditError("");
    setError("");

    const { error: updateError } =
      await supabase
        .from("inventory")
        .update({
          price: nextPrice,
        })
        .eq("id", editItem.id)
        .eq(
          "vendor_id",
          editItem.vendor_id
        );

    if (updateError) {
      console.error(
        "Price update error:",
        updateError
      );

      setEditError(
        updateError.message ||
          "This listing price could not be updated."
      );
      setEditSaving(false);
      return;
    }

    setInventory((current) =>
      current.map((inventoryItem) =>
        inventoryItem.id ===
        editItem.id
          ? {
              ...inventoryItem,
              price: nextPrice,
            }
          : inventoryItem
      )
    );

    setEditItem(null);
    setEditPrice("");
    setEditError("");
    setEditSaving(false);
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
    setShowPriceOnLabel(false);

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

    const graded =
      isGraded(qrItem);

    const condition =
      graded
        ? `${qrItem.grading_company || "Graded"} ${qrItem.grade || ""}`.trim()
        : qrItem.condition || "Raw";

    const price =
      Number(
        qrItem.price ?? 0
      ).toFixed(2);

    const isVertical =
      labelOrientation === "vertical";

    const pageWidth =
      isVertical ? "15mm" : "30mm";

    const pageHeight =
      isVertical ? "30mm" : "15mm";

    const printWindow =
      window.open(
        "",
        "_blank",
        "width=520,height=700"
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
              width: ${pageWidth};
              height: ${pageHeight};
              background: #fff;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
            }

            body {
              overflow: hidden;
            }

            .label {
              position: relative;
              width: ${pageWidth};
              height: ${pageHeight};
              background: #fff;
              overflow: hidden;
            }

            .content {
              position: absolute;
              top: 0;
              left: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              ${
                isVertical
                  ? `
                    width: 15mm;
                    height: 15mm;
                    flex-direction: column;
                    padding: 0.45mm 0.45mm 0.65mm;
                  `
                  : `
                    width: 15mm;
                    height: 15mm;
                    flex-direction: column;
                    align-items: stretch;
                    justify-content: flex-start;
                    padding: 0.4mm 0.45mm 0.65mm;
                  `
              }
            }

            .text {
              min-width: 0;
              overflow: hidden;
              ${
                isVertical
                  ? `
                    width: 100%;
                    text-align: center;
                    flex: 0 0 auto;
                  `
                  : `
                    width: 100%;
                    height: auto;
                    text-align: left;
                  `
              }
            }

            .vendor {
              width: 100%;
              font-size: 4.1pt;
              line-height: 1;
              font-weight: 900;
              text-transform: uppercase;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            .label-meta {
              width: 100%;
              min-width: 0;
              text-align: center;
              flex: 0 0 auto;
            }

            .condition {
              width: 100%;
              font-size: 3.7pt;
              line-height: 1;
              font-weight: 800;
              margin-top: 0.2mm;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            .scan-price {
              width: 100%;
              font-size: 3.4pt;
              line-height: 1;
              font-weight: 900;
              margin-top: 0.15mm;
              flex: 0 0 auto;
              letter-spacing: 0.01em;
              white-space: nowrap;
              text-align: center;
            }

            .qr-wrap {
              flex: 0 0 auto;
              display: flex;
              align-items: center;
              justify-content: center;
              width: 9.6mm;
              height: 9.6mm;
              margin: 0.2mm auto 0.15mm;
            }

            .qr {
              display: block;
              width: 9.6mm;
              height: 9.6mm;
              object-fit: contain;
              image-rendering: pixelated;
            }

            @page {
              size: ${pageWidth} ${pageHeight};
              margin: 0;
            }

            @media print {
              html,
              body,
              .label {
                width: ${pageWidth};
                height: ${pageHeight};
              }
            }
          </style>
        </head>

        <body>
          <div class="label">
            <div class="content">
              <div class="label-meta">
                <div class="vendor">${escapeHtml(vendorName)}</div>
                <div class="condition">${escapeHtml(condition)}</div>
              </div>

              <div class="qr-wrap">
                <img
                  class="qr"
                  src="${qrDataUrl}"
                  alt="MintRadar listing QR code"
                />
              </div>

              <div class="scan-price">${
                showPriceOnLabel
                  ? `$${escapeHtml(price)}`
                  : "SCAN FOR PRICE"
              }</div>
            </div>
          </div>

          <script>
            window.onload = function () {
              window.setTimeout(function () {
                window.print();
              }, 150);
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

        {/* TRADE ANALYZER */}

        <TradeAnalyzer />

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

                          <VendorCardImage
                            card={card}
                          />

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
                                openEditListing(
                                  item
                                )
                              }
                              disabled={
                                deletingId === item.id ||
                                savingId === item.id
                              }
                              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-black text-white transition hover:border-emerald-400/40 hover:bg-emerald-400/10 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Edit Listing
                            </button>

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

      {editItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeEditListing();
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-5 border-b border-zinc-900 p-5 sm:p-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                  Edit Listing
                </p>

                <h2 className="mt-2 text-2xl font-black">
                  {editItem.cards?.name ||
                    "Unknown Card"}
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {editItem.cards?.set_name ||
                    "Unknown Set"}
                  {editItem.cards?.card_number
                    ? ` #${editItem.cards.card_number}`
                    : ""}
                </p>
              </div>

              <button
                type="button"
                onClick={closeEditListing}
                disabled={editSaving}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-black text-xl text-zinc-400 transition hover:text-white disabled:opacity-50"
                aria-label="Close edit listing"
              >
                ×
              </button>
            </div>

            <div className="space-y-5 p-5 sm:p-6">
              <div className="flex items-center gap-4 rounded-2xl border border-zinc-900 bg-black p-4">
                <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-900 bg-zinc-950">
                  <VendorCardImage
                    card={editItem.cards}
                  />
                </div>

                <div className="min-w-0">
                  <p className="font-black text-white">
                    {getListingLabel(
                      editItem
                    )}
                  </p>

                  {isGraded(editItem) ? (
                    <p className="mt-1 text-sm text-zinc-500">
                      {editItem.grading_company}{" "}
                      {editItem.grade}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-zinc-500">
                      {editItem.condition ||
                        "Raw"}
                    </p>
                  )}

                  <p className="mt-2 text-xs text-zinc-700">
                    Current price: $
                    {Number(
                      editItem.price ?? 0
                    ).toFixed(2)}
                  </p>
                </div>
              </div>

              <DashboardCompButtons
                item={editItem}
              />

              <div className="rounded-2xl border border-zinc-800 bg-black p-4 sm:p-5">
                <label
                  htmlFor="edit-listing-price"
                  className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500"
                >
                  Listing Price
                </label>

                <div className="mt-2 flex items-center rounded-xl border border-zinc-800 bg-zinc-950 transition focus-within:border-emerald-400/50">
                  <span className="pl-4 text-lg font-black text-zinc-500">
                    $
                  </span>

                  <input
                    id="edit-listing-price"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={editPrice}
                    onChange={(event) =>
                      setEditPrice(
                        event.target.value
                      )
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key ===
                        "Enter"
                      ) {
                        event.preventDefault();
                        saveListingPrice();
                      }
                    }}
                    className="w-full bg-transparent px-3 py-4 text-xl font-black text-white outline-none"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>

                <p className="mt-2 text-xs leading-5 text-zinc-600">
                  Check comps above, set the new price, and save. Your existing QR code will keep pointing to this listing automatically.
                </p>

                {editError && (
                  <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">
                    {editError}
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeEditListing}
                  disabled={editSaving}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-3 text-sm font-black text-zinc-300 transition hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={saveListingPrice}
                  disabled={editSaving}
                  className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editSaving
                    ? "Saving..."
                    : "Save New Price"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-3xl">
            <div className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-5 border-b border-zinc-900 bg-zinc-950 p-5">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                  Print Label
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

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
                  <div className="mb-5">
                    <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
                      Orientation
                    </p>

                    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-zinc-800 bg-black p-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          chooseLabelOrientation(
                            "vertical"
                          )
                        }
                        className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                          labelOrientation ===
                          "vertical"
                            ? "bg-emerald-400 text-black"
                            : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                        }`}
                      >
                        Vertical
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          chooseLabelOrientation(
                            "horizontal"
                          )
                        }
                        className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                          labelOrientation ===
                          "horizontal"
                            ? "bg-emerald-400 text-black"
                            : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                        }`}
                      >
                        Horizontal
                      </button>
                    </div>

                    <p className="mt-2 text-xs text-zinc-600">
                      MintRadar will remember this choice for your next label.
                    </p>
                  </div>

                  <div className="mb-5">
                    <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
                      Display Price
                    </p>

                    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-zinc-800 bg-black p-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setShowPriceOnLabel(
                            false
                          )
                        }
                        className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                          !showPriceOnLabel
                            ? "bg-emerald-400 text-black"
                            : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                        }`}
                      >
                        Scan for Price
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setShowPriceOnLabel(
                            true
                          )
                        }
                        className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                          showPriceOnLabel
                            ? "bg-emerald-400 text-black"
                            : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
                        }`}
                      >
                        Show ${Number(
                          qrItem.price ?? 0
                        ).toFixed(2)}
                      </button>
                    </div>

                    <p className="mt-2 text-xs text-zinc-600">
                      Choose whether this label prints the current price or keeps pricing behind the QR code.
                    </p>
                  </div>

                  <div className="rounded-3xl border border-zinc-800 bg-black p-5">
                    <div
                      className={`relative mx-auto overflow-hidden rounded-xl bg-white shadow-2xl ${
                        labelOrientation ===
                        "vertical"
                          ? "h-[300px] w-[150px]"
                          : "h-[150px] w-[300px]"
                      }`}
                    >
                      <div
                        className={`absolute left-0 top-0 flex overflow-hidden text-black ${
                          labelOrientation ===
                          "vertical"
                            ? "h-1/2 w-full flex-col items-center px-2 pt-2 pb-2 text-center"
                            : "h-full w-1/2 flex-col items-center px-2 py-2 text-center"
                        }`}
                      >
                        <div className="w-full min-w-0 shrink-0">
                          <p className="truncate text-[10px] font-black uppercase leading-none">
                            {vendorName}
                          </p>

                          <p className="mt-1 truncate text-[9px] font-bold leading-none">
                            {isGraded(qrItem)
                              ? `${qrItem.grading_company || "Graded"} ${qrItem.grade || ""}`.trim()
                              : qrItem.condition ||
                                "Raw"}
                          </p>
                        </div>

                        <div
                          className={`mt-1 flex aspect-square w-[68%] max-w-[108px] items-center justify-center ${
                            labelOrientation ===
                            "vertical"
                              ? "flex-1"
                              : "flex-1"
                          }`}
                        >
                          <img
                            src={qrDataUrl}
                            alt="Listing QR code"
                            className="h-full max-h-[108px] w-full max-w-[108px] object-contain"
                          />
                        </div>

                        <p className="mt-1 shrink-0 whitespace-nowrap text-[9px] font-black uppercase leading-none">
                          {showPriceOnLabel
                            ? `$${Number(
                                qrItem.price ?? 0
                              ).toFixed(2)}`
                            : "Scan for Price"}
                        </p>
                      </div>

                      <div
                        className={`pointer-events-none absolute border-zinc-200 ${
                          labelOrientation ===
                          "vertical"
                            ? "left-0 top-1/2 w-full border-t border-dashed"
                            : "left-1/2 top-0 h-full border-l border-dashed"
                        }`}
                      />
                    </div>

                    <p className="mt-4 text-center text-xs text-zinc-600">
                      15 × 30 mm label • front half is printed • back half wraps around the card holder
                    </p>
                  </div>

                  <div className="sticky bottom-0 z-10 -mx-5 mt-5 border-t border-zinc-900 bg-zinc-950/95 px-5 pb-1 pt-4 backdrop-blur">
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={closeQrLabel}
                        className="rounded-xl border border-zinc-800 bg-black px-3 py-3 text-sm font-black text-zinc-400 transition hover:border-zinc-600 hover:text-white"
                      >
                        Close
                      </button>

                      <a
                        href={`/listing/${qrItem.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-xl border border-zinc-800 bg-black px-3 py-3 text-center text-sm font-black text-zinc-300 transition hover:border-zinc-600 hover:text-white"
                      >
                        Preview
                      </a>

                      <button
                        type="button"
                        onClick={printQrLabel}
                        className="rounded-xl bg-emerald-400 px-3 py-3 text-sm font-black text-black transition hover:bg-emerald-300"
                      >
                        Print
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 text-center text-xs text-zinc-600">
                    {showPriceOnLabel
                      ? "Vendor → Condition / Grade → QR → Printed Price. Reprint this label whenever you change the listing price."
                      : "Vendor → Condition / Grade → QR → Scan for Price. Update the live price anytime without reprinting the label."}
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