"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import TradeAnalyzer from "../components/TradeAnalyzer";
import BuyingAnalyzer from "../components/BuyingAnalyzer";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { getActiveVendorMembership } from "../../lib/active-vendor";
import QRCode from "qrcode";
import {
  P31SWebPrinter,
  supportsWebBluetooth,
} from "../../lib/p31s-web";
import {
  identifyD11H,
  printD11HImage,
  supportsNiimbotWebBluetooth,
} from "../../lib/niimbot-web";
import { encodeListingId } from "../../lib/listing-short-code";

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

type VendorSaleItem = {
  id: string;
  sale_id: string;
  vendor_id: string;
  inventory_id: string | null;
  card_id: string | null;
  quantity: number;
  unit_price: number | string;
  line_total: number | string;
  snapshot: Record<string, unknown> | null;
  created_at: string;
};

type VendorSale = {
  id: string;
  vendor_id: string;
  sold_by_user_id: string;
  sold_by_display_name: string;
  total_amount: number | string;
  total_quantity: number;
  sale_source: string;
  notes: string | null;
  sold_at: string;
  created_at: string;
  vendor_sale_items?: VendorSaleItem[];
};

type Vendor = {
  id: string;
  business_name?: string | null;
};

const p31sPrinter =
  new P31SWebPrinter();

function saleMoney(
  value: number | string | null | undefined
) {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return "$0.00";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(numeric);
}

function saleTime(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function saleSnapshotText(
  item: VendorSaleItem | undefined,
  key: string
) {
  const value = item?.snapshot?.[key];

  if (
    typeof value === "string" &&
    value.trim()
  ) {
    return value.trim();
  }

  return null;
}

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

  const [
    inventoryFilter,
    setInventoryFilter,
  ] = useState<
    "all" | "needs-price" | "published"
  >("all");

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [savingId, setSavingId] =
    useState<string | null>(null);

  const [deletingId, setDeletingId] =
    useState<string | null>(null);

  const [
    deletingAllInventory,
    setDeletingAllInventory,
  ] = useState(false);

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

  const [
    p31sSupported,
    setP31sSupported,
  ] = useState(false);

  const [
    p31sConnected,
    setP31sConnected,
  ] = useState(false);

  const [
    p31sBusy,
    setP31sBusy,
  ] = useState(false);

  const [
    p31sStatus,
    setP31sStatus,
  ] = useState("");

  const [
    niimbotSupported,
    setNiimbotSupported,
  ] = useState(false);

  const [
    niimbotConnected,
    setNiimbotConnected,
  ] = useState(false);

  const [
    niimbotBusy,
    setNiimbotBusy,
  ] = useState(false);

  const [
    niimbotStatus,
    setNiimbotStatus,
  ] = useState("");

  const [editItem, setEditItem] =
    useState<InventoryItem | null>(null);

  const [editPrice, setEditPrice] =
    useState("");

  const [editSaving, setEditSaving] =
    useState(false);

  const [editError, setEditError] =
    useState("");

  const [sales, setSales] =
    useState<VendorSale[]>([]);

  const [salesLoading, setSalesLoading] =
    useState(false);

  const [saleItem, setSaleItem] =
    useState<InventoryItem | null>(null);

  const [saleQuantity, setSaleQuantity] =
    useState("1");

  const [saleUnitPrice, setSaleUnitPrice] =
    useState("");

  const [saleNotes, setSaleNotes] =
    useState("");

  const [saleSaving, setSaleSaving] =
    useState(false);

  const [saleError, setSaleError] =
    useState("");

  // -----------------------------------------
  // LOAD SAVED PRINT PREFERENCES
  // -----------------------------------------

  useEffect(() => {
    setP31sSupported(
      supportsWebBluetooth()
    );

    setNiimbotSupported(
      supportsNiimbotWebBluetooth()
    );

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
          .gt("quantity", 0)
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
  // LOAD SALES / TEAM ACTIVITY
  // -----------------------------------------

  async function loadSales() {
    if (!vendorId) {
      setSales([]);
      return;
    }

    try {
      setSalesLoading(true);

      const {
        data,
        error: salesError,
      } = await supabase
        .from("vendor_sales")
        .select(`
          id,
          vendor_id,
          sold_by_user_id,
          sold_by_display_name,
          total_amount,
          total_quantity,
          sale_source,
          notes,
          sold_at,
          created_at,
          vendor_sale_items (
            id,
            sale_id,
            vendor_id,
            inventory_id,
            card_id,
            quantity,
            unit_price,
            line_total,
            snapshot,
            created_at
          )
        `)
        .eq("vendor_id", vendorId)
        .order("sold_at", {
          ascending: false,
        })
        .limit(50);

      if (salesError) {
        throw salesError;
      }

      setSales(
        (data || []) as unknown as VendorSale[]
      );
    } catch (err: any) {
      console.error(
        "Vendor sales load error:",
        err
      );
    } finally {
      setSalesLoading(false);
    }
  }

  useEffect(() => {
    if (!vendorId) {
      return;
    }

    void loadSales();

    const channel = supabase
      .channel(
        `vendor-sales-${vendorId}`
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "vendor_sales",
          filter: `vendor_id=eq.${vendorId}`,
        },
        () => {
          void loadSales();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [vendorId]);

  function openSale(item: InventoryItem) {
    setSaleItem(item);
    setSaleQuantity("1");
    setSaleUnitPrice(
      String(item.price ?? "")
    );
    setSaleNotes("");
    setSaleError("");
  }

  function closeSale() {
    if (saleSaving) return;

    setSaleItem(null);
    setSaleQuantity("1");
    setSaleUnitPrice("");
    setSaleNotes("");
    setSaleError("");
  }

  async function recordSale() {
    if (
      !saleItem ||
      !vendorId ||
      saleSaving
    ) {
      return;
    }

    const quantity =
      Number(saleQuantity);

    const unitPrice =
      Number(saleUnitPrice);

    if (
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      setSaleError(
        "Enter a valid quantity sold."
      );
      return;
    }

    if (
      quantity >
      Number(
        saleItem.quantity || 0
      )
    ) {
      setSaleError(
        "Sale quantity cannot exceed available inventory."
      );
      return;
    }

    if (
      !Number.isFinite(unitPrice) ||
      unitPrice < 0
    ) {
      setSaleError(
        "Enter a valid sold price."
      );
      return;
    }

    try {
      setSaleSaving(true);
      setSaleError("");
      setError("");

      const {
        data,
        error: saleRpcError,
      } = await supabase.rpc(
        "record_vendor_sale",
        {
          p_vendor_id:
            vendorId,
          p_inventory_id:
            saleItem.id,
          p_quantity:
            quantity,
          p_unit_price:
            unitPrice,
          p_notes:
            saleNotes.trim() || null,
        }
      );

      if (saleRpcError) {
        throw saleRpcError;
      }

      const result =
        data as {
          remaining_quantity?: number;
        } | null;

      const remaining =
        Number(
          result?.remaining_quantity ??
            Math.max(
              0,
              Number(
                saleItem.quantity || 0
              ) - quantity
            )
        );

      setInventory((current) =>
        current
          .map((item) =>
            item.id === saleItem.id
              ? {
                  ...item,
                  quantity:
                    remaining,
                }
              : item
          )
          .filter(
            (item) =>
              Number(
                item.quantity || 0
              ) > 0
          )
      );

      await loadSales();

      closeSale();
    } catch (err: any) {
      console.error(
        "Record vendor sale error:",
        {
          message: err?.message,
          details: err?.details,
          hint: err?.hint,
          code: err?.code,
          raw: err,
        }
      );

      setSaleError(
        err?.message ||
          err?.details ||
          "MintRadar could not record this sale."
      );
    } finally {
      setSaleSaving(false);
    }
  }

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
  // DELETE ALL INVENTORY
  // -----------------------------------------

  async function deleteAllInventory() {
    if (
      deletingAllInventory ||
      !vendorId ||
      inventory.length === 0
    ) {
      return;
    }

    const confirmation =
      window.prompt(
        `This will permanently delete all ${inventory.length} ${
          inventory.length === 1 ? "listing" : "listings"
        } from ${vendorName}.\n\nThis only affects the currently active vendor.\n\nType DELETE ALL to continue.`
      );

    if (confirmation !== "DELETE ALL") {
      return;
    }

    try {
      setDeletingAllInventory(true);
      setError("");

      const {
        error: deleteError,
      } = await supabase
        .from("inventory")
        .delete()
        .eq(
          "vendor_id",
          vendorId
        );

      if (deleteError) {
        throw deleteError;
      }

      setInventory([]);

      window.alert(
        `${vendorName} inventory has been deleted.`
      );
    } catch (err: any) {
      console.error(
        "Delete all inventory error:",
        err
      );

      setError(
        err?.message ||
          "MintRadar could not delete this vendor's inventory."
      );
    } finally {
      setDeletingAllInventory(false);
    }
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
      item.price != null &&
      Number(item.price) > 0
        ? Number(item.price).toFixed(2)
        : ""
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
      nextPrice <= 0
    ) {
      setEditError(
        "Enter a price greater than $0 to publish this listing."
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
    setP31sStatus("");
    setNiimbotStatus("");

    try {
      const shortCode =
        encodeListingId(
          item.id
        );

      const listingUrl =
        `${window.location.origin}/l/${shortCode}`;

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

  function loadLabelImage(
    src: string
  ) {
    return new Promise<HTMLImageElement>(
      (resolve, reject) => {
        const image =
          new window.Image();

        image.onload = () =>
          resolve(image);

        image.onerror = () =>
          reject(
            new Error(
              "MintRadar could not load the QR image for Bluetooth printing."
            )
          );

        image.src = src;
      }
    );
  }

  function fitCanvasText(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    maxSize: number,
    minSize: number,
    weight = 900
  ) {
    for (
      let size = maxSize;
      size >= minSize;
      size -= 1
    ) {
      ctx.font =
        `${weight} ${size}px Arial, Helvetica, sans-serif`;

      if (
        ctx.measureText(text)
          .width <= maxWidth
      ) {
        return size;
      }
    }

    return minSize;
  }

  async function buildP31SLabelCanvas() {
    if (
      !qrItem
    ) {
      throw new Error(
        "Open a MintRadar label first."
      );
    }

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = 320;
    canvas.height = 112;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      throw new Error(
        "MintRadar could not create the P31S label image."
      );
    }

    ctx.imageSmoothingEnabled =
      false;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.fillStyle = "#000000";
    ctx.textBaseline = "top";

    const graded =
      isGraded(qrItem);

    const condition =
      graded
        ? `${qrItem.grading_company || "Graded"} ${
            qrItem.grade || ""
          }`.trim()
        : qrItem.condition ||
          "Raw";

    const price =
      Number(
        qrItem.price ?? 0
      ).toFixed(2);

    // --------------------------------------------------
    // P31S 13 × 38 MM CALIBRATED LABEL
    // --------------------------------------------------
    //
    // Important:
    // The general preview QR is generated large at high error correction.
    // Shrinking that image into a tiny thermal bitmap can make QR modules
    // uneven and hard for a phone camera to resolve.
    //
    // For the P31S we generate a dedicated QR at its native print size,
    // with medium error correction and its own quiet zone.
    // --------------------------------------------------

    const shortCode =
      encodeListingId(
        qrItem.id
      );

    const listingUrl =
      `${window.location.origin}/l/${shortCode}`;

    const p31sQrDataUrl =
      await QRCode.toDataURL(
        listingUrl,
        {
          width: 100,
          margin: 2,
          errorCorrectionLevel: "M",
        }
      );

    const qr =
      await loadLabelImage(
        p31sQrDataUrl
      );

    // Keep the entire QR well inside the printer's real 13 mm safe area.
    // 100 px is larger than the previous readable area, but ends at y=102,
    // leaving 10 px of bottom clearance on the 112 px bitmap.
    const qrSize = 100;
    const qrX = 4;
    const qrY = 2;

    ctx.drawImage(
      qr,
      qrX,
      qrY,
      qrSize,
      qrSize
    );

    // --------------------------------------------------
    // TEXT COLUMN
    // --------------------------------------------------

    const pad = 8;

    const textX =
      qrX + qrSize + 10;

    const textWidth =
      canvas.width -
      textX -
      pad;

    ctx.fillStyle = "#000000";
    ctx.textAlign = "left";

    // --------------------------------------------------
    // VENDOR BRANDING
    // --------------------------------------------------

    const normalizedVendorName =
      vendorName
        .trim()
        .toLowerCase();

    if (
      normalizedVendorName ===
      "onlyslabs"
    ) {
      try {
        const logo =
          await loadLabelImage(
            "/onlyslabs-label-logo.png"
          );

        const maxLogoWidth =
          Math.min(
            textWidth,
            176
          );

        const maxLogoHeight = 22;

        const logoScale =
          Math.min(
            maxLogoWidth /
              logo.naturalWidth,
            maxLogoHeight /
              logo.naturalHeight
          );

        const logoWidth =
          Math.max(
            1,
            Math.round(
              logo.naturalWidth *
                logoScale
            )
          );

        const logoHeight =
          Math.max(
            1,
            Math.round(
              logo.naturalHeight *
                logoScale
            )
          );

        ctx.drawImage(
          logo,
          textX,
          13,
          logoWidth,
          logoHeight
        );
      } catch (
        logoError
      ) {
        console.warn(
          "OnlySlabs label logo could not be loaded. Falling back to text.",
          logoError
        );

        const vendorText =
          vendorName.toUpperCase();

        const vendorSize =
          fitCanvasText(
            ctx,
            vendorText,
            textWidth,
            18,
            10,
            900
          );

        ctx.font =
          `900 ${vendorSize}px Arial, Helvetica, sans-serif`;

        ctx.fillText(
          vendorText,
          textX,
          14
        );
      }
    } else {
      const vendorText =
        vendorName.toUpperCase();

      const vendorSize =
        fitCanvasText(
          ctx,
          vendorText,
          textWidth,
          18,
          10,
          900
        );

      ctx.font =
        `900 ${vendorSize}px Arial, Helvetica, sans-serif`;

      ctx.fillText(
        vendorText,
        textX,
        14
      );
    }

    // --------------------------------------------------
    // CONDITION / GRADE
    // --------------------------------------------------

    const conditionSize =
      fitCanvasText(
        ctx,
        condition,
        textWidth,
        15,
        9,
        800
      );

    ctx.font =
      `800 ${conditionSize}px Arial, Helvetica, sans-serif`;

    ctx.fillText(
      condition,
      textX,
      41
    );

    // --------------------------------------------------
    // PRICE / SCAN MESSAGE
    // --------------------------------------------------

    const bottomText =
      showPriceOnLabel
        ? `$${price}`
        : "SCAN FOR PRICE";

    const bottomSize =
      fitCanvasText(
        ctx,
        bottomText,
        textWidth,
        showPriceOnLabel
          ? 25
          : 17,
        10,
        900
      );

    ctx.font =
      `900 ${bottomSize}px Arial, Helvetica, sans-serif`;

    ctx.fillText(
      bottomText,
      textX,
      68
    );

    return canvas;
  }

  async function connectP31S() {
    if (!p31sSupported) {
      setP31sStatus(
        "Web Bluetooth is not available in this browser/device."
      );
      return;
    }

    setP31sBusy(true);
    setP31sStatus("");

    try {
      const deviceName =
        await p31sPrinter.connect();

      setP31sConnected(true);
      setP31sStatus(
        `Connected to ${deviceName}.`
      );
    } catch (error: any) {
      console.error(
        "P31S connect error:",
        error
      );

      setP31sConnected(false);
      setP31sStatus(
        error?.message ||
          "MintRadar could not connect to the P31S."
      );
    } finally {
      setP31sBusy(false);
    }
  }

  async function printQrLabelP31S() {
    setP31sBusy(true);
    setP31sStatus("");

    try {
      if (
        !p31sPrinter.connected
      ) {
        const deviceName =
          await p31sPrinter.connect();

        setP31sConnected(true);
        setP31sStatus(
          `Connected to ${deviceName}. Sending label...`
        );
      }

      const canvas =
        await buildP31SLabelCanvas();

      await p31sPrinter.printCanvas(
        canvas
      );

      setP31sConnected(true);
      setP31sStatus(
        "MintRadar label sent to the P31S."
      );
    } catch (error: any) {
      console.error(
        "P31S label print error:",
        error
      );

      setP31sConnected(false);

      setP31sStatus(
        error?.message ||
          "MintRadar could not print this label to the P31S."
      );
    } finally {
      setP31sBusy(false);
    }
  }

  async function buildD11HLabelCanvas() {
    if (!qrItem || !qrDataUrl) {
      throw new Error("Open a MintRadar label first.");
    }

    // --------------------------------------------------
    // NIIMBOT D11_H • 12 × 40 MM STOCK
    // --------------------------------------------------
    //
    // D11_H has a measured 144 px printhead.
    // 12 mm stock is ~142 px wide at 300 dpi.
    // 40 mm feed length is ~472 px.
    // --------------------------------------------------

    const canvas =
      document.createElement("canvas");

    canvas.width = 142;
    canvas.height = 472;

    const ctx =
      canvas.getContext("2d");

    if (!ctx) {
      throw new Error(
        "MintRadar could not create the D11_H label image."
      );
    }

    ctx.imageSmoothingEnabled =
      false;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const graded =
      isGraded(qrItem);

    const condition =
      graded
        ? `${qrItem.grading_company || "Graded"} ${
            qrItem.grade || ""
          }`.trim()
        : qrItem.condition || "Raw";

    const price =
      Number(qrItem.price ?? 0)
        .toFixed(2);

    const centerX =
      canvas.width / 2;

    const textWidth = 132;

    const normalizedVendorName =
      vendorName
        .trim()
        .toLowerCase();

    if (
      normalizedVendorName ===
      "onlyslabs"
    ) {
      try {
        const logo =
          await loadLabelImage(
            "/onlyslabs-label-logo.png"
          );

        const maxLogoWidth = 132;
        const maxLogoHeight = 25;

        const logoScale =
          Math.min(
            maxLogoWidth /
              logo.naturalWidth,
            maxLogoHeight /
              logo.naturalHeight
          );

        const logoWidth =
          Math.max(
            1,
            Math.round(
              logo.naturalWidth *
                logoScale
            )
          );

        const logoHeight =
          Math.max(
            1,
            Math.round(
              logo.naturalHeight *
                logoScale
            )
          );

        ctx.drawImage(
          logo,
          Math.round(
            centerX -
              logoWidth / 2
          ),
          8,
          logoWidth,
          logoHeight
        );
      } catch (
        logoError
      ) {
        console.warn(
          "OnlySlabs label logo could not be loaded. Falling back to text.",
          logoError
        );

        const vendorText =
          vendorName.toUpperCase();

        const vendorSize =
          fitCanvasText(
            ctx,
            vendorText,
            textWidth,
            20,
            11,
            900
          );

        ctx.font =
          `900 ${vendorSize}px Arial, Helvetica, sans-serif`;

        ctx.fillText(
          vendorText,
          centerX,
          10
        );
      }
    } else {
      const vendorText =
        vendorName.toUpperCase();

      const vendorSize =
        fitCanvasText(
          ctx,
          vendorText,
          textWidth,
          20,
          11,
          900
        );

      ctx.font =
        `900 ${vendorSize}px Arial, Helvetica, sans-serif`;

      ctx.fillText(
        vendorText,
        centerX,
        10
      );
    }

    const conditionSize =
      fitCanvasText(
        ctx,
        condition,
        textWidth,
        18,
        10,
        800
      );

    ctx.font =
      `800 ${conditionSize}px Arial, Helvetica, sans-serif`;

    ctx.fillText(
      condition,
      centerX,
      42
    );

    const qr =
      await loadLabelImage(
        qrDataUrl
      );

    const qrSize = 136;
    const qrX =
      Math.floor(
        (canvas.width - qrSize) /
          2
      );
    const qrY = 82;

    ctx.drawImage(
      qr,
      qrX,
      qrY,
      qrSize,
      qrSize
    );

    const bottomText =
      showPriceOnLabel
        ? `$${price}`
        : "SCAN FOR PRICE";

    const bottomSize =
      fitCanvasText(
        ctx,
        bottomText,
        textWidth,
        showPriceOnLabel
          ? 30
          : 20,
        11,
        900
      );

    ctx.font =
      `900 ${bottomSize}px Arial, Helvetica, sans-serif`;

    ctx.fillText(
      bottomText,
      centerX,
      236
    );

    ctx.font =
      "900 17px Arial, Helvetica, sans-serif";

    ctx.fillText(
      "MINT RADAR",
      centerX,
      316
    );

    ctx.font =
      "700 11px Arial, Helvetica, sans-serif";

    ctx.fillText(
      "LIVE LISTING",
      centerX,
      344
    );

    return canvas;
  }

  async function connectD11H() {
    if (!niimbotSupported) {
      setNiimbotStatus(
        "Web Bluetooth is not available in this browser/device."
      );
      return;
    }

    setNiimbotBusy(true);
    setNiimbotStatus("");

    try {
      const printer = await identifyD11H();
      setNiimbotConnected(true);
      setNiimbotStatus(
        `Connected to ${printer?.label || "Niimbot D11_H"}.`
      );
    } catch (error: any) {
      console.error("D11_H connect error:", error);
      setNiimbotConnected(false);
      setNiimbotStatus(
        error?.message ||
          "MintRadar could not connect to the Niimbot D11_H."
      );
    } finally {
      setNiimbotBusy(false);
    }
  }

  async function printQrLabelD11H() {
    setNiimbotBusy(true);
    setNiimbotStatus("");

    try {
      if (!niimbotConnected) {
        const printer = await identifyD11H();
        setNiimbotConnected(true);
        setNiimbotStatus(
          `Connected to ${printer?.label || "Niimbot D11_H"}. Sending label...`
        );
      }

      const canvas = await buildD11HLabelCanvas();
      const imageDataUrl = canvas.toDataURL("image/png");

      await printD11HImage(imageDataUrl);

      setNiimbotConnected(true);
      setNiimbotStatus(
        "MintRadar label sent to the Niimbot D11_H."
      );
    } catch (error: any) {
      console.error("D11_H label print error:", error);
      setNiimbotStatus(
        error?.message ||
          "MintRadar could not print this label to the D11_H."
      );
    } finally {
      setNiimbotBusy(false);
    }
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
              width: ${pageWidth};
              height: ${pageHeight};
              background: #fff;
              overflow: hidden;
            }

            .content {
              width: 100%;
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              ${
                isVertical
                  ? `
                    flex-direction: column;
                    padding: 0.75mm 0.65mm;
                  `
                  : `
                    flex-direction: row;
                    padding: 0.65mm 0.8mm;
                    gap: 0.7mm;
                  `
              }
            }

            .label-meta {
              min-width: 0;
              ${
                isVertical
                  ? `
                    width: 100%;
                    text-align: center;
                    flex: 0 0 auto;
                  `
                  : `
                    flex: 1 1 auto;
                    text-align: left;
                  `
              }
            }

            .vendor {
              width: 100%;
              font-size: ${isVertical ? "5pt" : "5.4pt"};
              line-height: 1;
              font-weight: 900;
              text-transform: uppercase;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            .condition {
              width: 100%;
              font-size: ${isVertical ? "4.2pt" : "4.6pt"};
              line-height: 1;
              font-weight: 800;
              margin-top: 0.45mm;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }

            .scan-price {
              width: 100%;
              font-size: ${isVertical ? "4pt" : "4.6pt"};
              line-height: 1;
              font-weight: 900;
              margin-top: 0.5mm;
              letter-spacing: 0.01em;
              white-space: nowrap;
              ${
                isVertical
                  ? "text-align:center;"
                  : "text-align:left;"
              }
            }

            .qr-wrap {
              flex: 0 0 auto;
              display: flex;
              align-items: center;
              justify-content: center;
              ${
                isVertical
                  ? `
                    width: 12.2mm;
                    height: 12.2mm;
                    margin: 0.65mm auto 0.45mm;
                  `
                  : `
                    width: 13.2mm;
                    height: 13.2mm;
                    margin: 0;
                  `
              }
            }

            .qr {
              display: block;
              width: 100%;
              height: 100%;
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
              ${
                isVertical
                  ? `
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
                  `
                  : `
                    <div class="qr-wrap">
                      <img
                        class="qr"
                        src="${qrDataUrl}"
                        alt="MintRadar listing QR code"
                      />
                    </div>

                    <div class="label-meta">
                      <div class="vendor">${escapeHtml(vendorName)}</div>
                      <div class="condition">${escapeHtml(condition)}</div>
                      <div class="scan-price">${
                        showPriceOnLabel
                          ? `$${escapeHtml(price)}`
                          : "SCAN FOR PRICE"
                      }</div>
                    </div>
                  `
              }
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

  const needsPriceCount =
    inventory.filter(
      (item) =>
        item.price == null ||
        Number(item.price) <= 0
    ).length;

  const publishedCount =
    inventory.filter(
      (item) =>
        Number(item.price ?? 0) > 0
    ).length;

  const visibleInventory =
    inventory.filter((item) => {
      const hasPrice =
        Number(item.price ?? 0) > 0;

      if (
        inventoryFilter ===
        "needs-price"
      ) {
        return !hasPrice;
      }

      if (
        inventoryFilter ===
        "published"
      ) {
        return hasPrice;
      }

      return true;
    });

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
    <main className="min-h-screen bg-black px-4 pb-16 pt-20 text-white sm:px-5 sm:pt-24">
      <div className="mx-auto max-w-6xl">

        {/* HEADER / INTRO */}

        <header className="mb-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/"
              className="w-fit"
            >
              <Image
                src="/mintradar-logo.png"
                alt="MintRadar by OnlySlabs"
                width={600}
                height={300}
                priority
                className="h-auto w-[210px] sm:w-[260px]"
              />
            </Link>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/"
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-black text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
                title="Browse MintRadar without signing out"
              >
                Browse Marketplace
              </Link>

              <a
                href="#sales-history"
                className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-black text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
              >
                Sales History
              </a>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                Vendor Dashboard
              </p>

              <h1 className="mt-2 text-4xl font-black sm:text-5xl">
                {vendorName}
              </h1>

              <p className="mt-3 max-w-2xl text-zinc-500">
                Manage live inventory, evaluate trades, record sales, and keep your team synced in real time.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {role && (
                  <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs font-black uppercase tracking-wider text-zinc-500">
                    {role}
                  </span>
                )}

                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300">
                  Realtime Inventory
                </span>
              </div>
            </div>

            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 lg:w-auto [&>button]:flex [&>button]:h-full [&>button]:w-full [&>button]:items-center [&>button]:justify-center [&>button]:whitespace-nowrap">
              <TradeAnalyzer
                inventory={inventory}
              />

              <BuyingAnalyzer />

              <Link
                href="/vendor/import"
                className="flex h-full w-full items-center justify-center whitespace-nowrap rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-6 py-4 text-center font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black"
              >
                Import CSV
              </Link>

              <button
                type="button"
                onClick={deleteAllInventory}
                disabled={
                  deletingAllInventory ||
                  inventory.length === 0
                }
                className="rounded-xl border border-red-400/30 bg-red-400/10 px-6 py-4 text-center font-black text-red-300 transition hover:bg-red-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deletingAllInventory
                  ? "Deleting..."
                  : "Delete All Inventory"}
              </button>

              <Link
                href="/vendor/add"
                className="flex h-full w-full items-center justify-center whitespace-nowrap rounded-xl bg-emerald-400 px-6 py-4 text-center font-black text-black transition hover:bg-emerald-300"
              >
                + Add Item
              </Link>
            </div>
          </div>
        </header>

        {/* STATS */}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
              Listings
            </p>

            <p className="mt-2 text-3xl font-black">
              {inventory.length}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
              Total Items
            </p>

            <p className="mt-2 text-3xl font-black">
              {inventory.reduce(
                (total, item) =>
                  total +
                  (item.quantity ?? 0),
                0
              )}
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-zinc-950 p-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-600">
              Inventory Value
            </p>

            <p className="mt-2 text-3xl font-black text-emerald-400">
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

          <section className="mt-8">

            <div className="mb-5 flex flex-col gap-4">

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-emerald-400 text-xs uppercase tracking-[0.2em] font-bold">
                    Vendor Inventory
                  </p>

                  <h2 className="text-2xl font-black mt-1">
                    Your Listings
                  </h2>

                  {needsPriceCount > 0 && (
                    <p className="mt-2 text-sm font-bold text-amber-300">
                      ⚠ {needsPriceCount} item
                      {needsPriceCount === 1 ? "" : "s"} need pricing before they can appear on the marketplace.
                    </p>
                  )}
                </div>

                <p className="text-zinc-600 text-sm">
                  {visibleInventory.length} shown
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  {
                    value: "all",
                    label: `All (${inventory.length})`,
                  },
                  {
                    value: "needs-price",
                    label: `Needs Price (${needsPriceCount})`,
                  },
                  {
                    value: "published",
                    label: `Published (${publishedCount})`,
                  },
                ].map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() =>
                      setInventoryFilter(
                        filter.value as
                          | "all"
                          | "needs-price"
                          | "published"
                      )
                    }
                    className={`rounded-xl border px-4 py-2 text-xs font-black transition ${
                      inventoryFilter ===
                      filter.value
                        ? "border-emerald-400 bg-emerald-400 text-black"
                        : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-emerald-400/40 hover:text-white"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">

              {visibleInventory.map(
                (item) => {
                  const card =
                    item.cards;

                  const quantity =
                    item.quantity ?? 0;

                  const graded =
                    isGraded(item);

                  const hasPrice =
                    Number(
                      item.price ?? 0
                    ) > 0;

                  return (
                    <article
                      key={item.id}
                      className={`overflow-hidden rounded-3xl border bg-zinc-950 ${
                        !hasPrice
                          ? "border-amber-400/40"
                          : graded
                            ? "border-emerald-400/30"
                            : "border-zinc-900"
                      }`}
                    >
                      {/* CARD / LISTING INFO */}

                      <div className="flex gap-4 p-4">
                        <div className="flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-900 bg-black">
                          <VendorCardImage
                            card={card}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-lg font-black">
                            {card?.name ||
                              "Unknown Card"}
                          </p>

                          <p className="mt-1 text-xs text-zinc-500">
                            {[
                              card?.set_name,
                              card?.card_number
                                ? `#${card.card_number}`
                                : null,
                              card?.finish,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </p>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span
                              className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
                                graded
                                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                                  : "border-zinc-800 bg-black text-zinc-500"
                              }`}
                            >
                              {graded
                                ? "Slab"
                                : "Raw"}
                            </span>

                            <span className="rounded-full border border-zinc-800 bg-black px-2 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                              {getListingLabel(
                                item
                              )}
                            </span>

                            <span className="rounded-full border border-zinc-800 bg-black px-2 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-500">
                              Qty {quantity}
                            </span>

                            <span
                              className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
                                hasPrice
                                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                                  : "border-amber-400/30 bg-amber-400/10 text-amber-300"
                              }`}
                            >
                              {hasPrice
                                ? "Published"
                                : "Needs Price"}
                            </span>
                          </div>

                          {graded &&
                            item.cert_number && (
                            <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-zinc-700">
                              Cert #{item.cert_number}
                            </p>
                          )}

                          {!graded &&
                            card?.edition && (
                            <p className="mt-2 text-xs text-zinc-600">
                              {card.edition}
                            </p>
                          )}

                          <p className="mt-3 text-xs font-black uppercase tracking-wider text-zinc-700">
                            Listing Price
                          </p>

                          {hasPrice ? (
                            <p className="mt-1 text-xl font-black text-emerald-400">
                              $
                              {Number(
                                item.price
                              ).toFixed(2)}
                            </p>
                          ) : (
                            <div className="mt-1">
                              <p className="text-lg font-black text-amber-300">
                                Unpriced
                              </p>
                              <p className="mt-1 text-[11px] font-bold leading-4 text-amber-300/60">
                                Hidden from marketplace
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* QUANTITY */}

                      <div className="border-t border-zinc-900 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
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
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 font-black transition hover:bg-zinc-800 disabled:opacity-50"
                            >
                              −
                            </button>

                            <div className="flex h-9 min-w-11 items-center justify-center rounded-xl border border-zinc-900 bg-black px-3 font-black">
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
                              className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400 font-black text-black transition hover:bg-emerald-300 disabled:opacity-50"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        {savingId ===
                          item.id && (
                          <p className="mt-2 text-right text-xs text-zinc-600">
                            Saving...
                          </p>
                        )}
                      </div>

                      {/* NOTES */}

                      {item.notes && (
                        <div className="border-t border-zinc-900 px-4 py-3">
                          <p className="line-clamp-2 text-xs leading-5 text-zinc-600">
                            {item.notes}
                          </p>
                        </div>
                      )}

                      {/* ACTIONS */}

                      <div className="grid grid-cols-2 gap-2 border-t border-zinc-900 p-4">
                        {!hasPrice ? (
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
                            className="col-span-2 rounded-xl bg-emerald-400 px-3 py-3 text-xs font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Publish Listing
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                openSale(item)
                              }
                              disabled={
                                deletingId === item.id ||
                                savingId === item.id
                              }
                              className="rounded-xl bg-emerald-400 px-3 py-3 text-xs font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Mark Sold
                            </button>

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
                              className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-xs font-black text-white transition hover:border-emerald-400/40 hover:bg-emerald-400/10 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Edit Listing
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            openQrLabel(
                              item
                            )
                          }
                          disabled={
                            deletingId === item.id ||
                            !hasPrice
                          }
                          className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-3 text-xs font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
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
                          className="rounded-xl border border-red-400/30 bg-red-400/5 px-3 py-3 text-xs font-black text-red-300 transition hover:bg-red-400/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === item.id
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                      </div>
                    </article>
                  );
                }
              )}

            </div>

          </section>
        )}

        {/* SALES / TEAM ACTIVITY */}

        <section
          id="sales-history"
          className="mt-10 scroll-mt-24"
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
                Sales
              </p>

              <h2 className="mt-1 text-2xl font-black">
                Team Activity
              </h2>

              <p className="mt-2 text-sm text-zinc-600">
                See who sold what, when it sold, and the actual price it moved for.
              </p>
            </div>

            <Link
              href="/trades"
              className="text-sm font-black text-zinc-600 transition hover:text-emerald-300"
            >
              Trade History →
            </Link>
          </div>

          {salesLoading ? (
            <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5 text-sm font-bold text-emerald-400">
              Loading sales activity...
            </div>
          ) : sales.length === 0 ? (
            <div className="rounded-2xl border border-zinc-900 bg-zinc-950 p-6">
              <p className="font-black text-white">
                No recorded sales yet.
              </p>
              <p className="mt-2 text-sm text-zinc-600">
                Use Mark Sold on an inventory item and the seller log will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950">
              {sales.map(
                (sale, index) => {
                  const line =
                    sale.vendor_sale_items?.[0];

                  const cardName =
                    saleSnapshotText(
                      line,
                      "card_name"
                    ) ||
                    "Unknown Collectible";

                  const setName =
                    saleSnapshotText(
                      line,
                      "set_name"
                    );

                  const cardNumber =
                    saleSnapshotText(
                      line,
                      "card_number"
                    );

                  const listedPrice =
                    saleSnapshotText(
                      line,
                      "listed_price"
                    );

                  return (
                    <div
                      key={sale.id}
                      className={`grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center ${
                        index !==
                        sales.length - 1
                          ? "border-b border-zinc-900"
                          : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-white">
                            {
                              sale.sold_by_display_name
                            }
                          </p>

                          <span className="rounded-full border border-zinc-800 bg-black px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-zinc-600">
                            Qty{" "}
                            {
                              sale.total_quantity
                            }
                          </span>
                        </div>

                        <p className="mt-1 text-sm text-zinc-400">
                          Sold{" "}
                          <span className="font-black text-white">
                            {cardName}
                          </span>
                          {setName
                            ? ` • ${setName}`
                            : ""}
                          {cardNumber
                            ? ` #${cardNumber}`
                            : ""}
                        </p>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-700">
                          <span>
                            {saleTime(
                              sale.sold_at
                            )}
                          </span>

                          {listedPrice && (
                            <span>
                              Listed{" "}
                              {saleMoney(
                                listedPrice
                              )}
                            </span>
                          )}

                          {sale.notes && (
                            <span>
                              {sale.notes}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="sm:text-right">
                        <p className="text-[10px] font-black uppercase tracking-wider text-zinc-700">
                          Sold For
                        </p>

                        <p className="mt-1 text-2xl font-black text-emerald-400">
                          {saleMoney(
                            sale.total_amount
                          )}
                        </p>

                        {line &&
                          Number(
                            line.quantity
                          ) > 1 && (
                            <p className="mt-1 text-xs text-zinc-700">
                              {saleMoney(
                                line.unit_price
                              )}{" "}
                              each
                            </p>
                          )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}
        </section>

      </div>

      {saleItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeSale();
            }
          }}
        >
          <div className="w-full max-w-lg rounded-t-3xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-900 p-5 sm:p-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                  Mark Sold
                </p>

                <h3 className="mt-2 text-2xl font-black">
                  {saleItem.cards?.name ||
                    "Inventory Item"}
                </h3>

                <p className="mt-1 text-sm text-zinc-600">
                  {saleItem.cards?.set_name ||
                    "Unknown Set"}
                  {saleItem.cards?.card_number
                    ? ` #${saleItem.cards.card_number}`
                    : ""}
                </p>
              </div>

              <button
                type="button"
                onClick={closeSale}
                disabled={saleSaving}
                className="text-xl font-black text-zinc-600 transition hover:text-white disabled:opacity-40"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 p-5 sm:p-6">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Quantity Sold
                </p>

                <input
                  type="number"
                  min="1"
                  max={
                    saleItem.quantity ??
                    1
                  }
                  step="1"
                  value={saleQuantity}
                  onChange={(event) =>
                    setSaleQuantity(
                      event.target.value
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 font-black text-white outline-none focus:border-emerald-400/50"
                />

                <p className="mt-1.5 text-xs text-zinc-700">
                  Available:{" "}
                  {saleItem.quantity ?? 0}
                </p>
              </div>

              <div>
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Sold Price — Per Item
                </p>

                <div className="mt-2 flex items-center rounded-xl border border-zinc-800 bg-black focus-within:border-emerald-400/50">
                  <span className="pl-4 font-black text-zinc-600">
                    $
                  </span>

                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={saleUnitPrice}
                    onChange={(event) =>
                      setSaleUnitPrice(
                        event.target.value
                      )
                    }
                    className="min-w-0 flex-1 bg-transparent px-2 py-3 font-black text-white outline-none"
                  />
                </div>

                <p className="mt-1.5 text-xs text-zinc-700">
                  Current listing:{" "}
                  {saleMoney(
                    saleItem.price
                  )}
                </p>
              </div>

              <div>
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Notes — Optional
                </p>

                <input
                  type="text"
                  value={saleNotes}
                  onChange={(event) =>
                    setSaleNotes(
                      event.target.value
                    )
                  }
                  placeholder="Cash, show sale, bundle, etc."
                  className="mt-2 w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-zinc-800 focus:border-emerald-400/50"
                />
              </div>

              {saleError && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm font-bold text-red-300">
                  {saleError}
                </div>
              )}

              <div className="rounded-2xl border border-zinc-900 bg-black p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-bold text-zinc-500">
                    Sale Total
                  </span>

                  <span className="text-2xl font-black text-emerald-400">
                    {saleMoney(
                      Number(
                        saleUnitPrice ||
                          0
                      ) *
                        Number(
                          saleQuantity ||
                            0
                        )
                    )}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  void recordSale()
                }
                disabled={saleSaving}
                className="w-full rounded-xl bg-emerald-400 px-4 py-4 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saleSaving
                  ? "Recording Sale..."
                  : "Confirm Sale"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                        className={`absolute inset-0 flex overflow-hidden text-black ${
                          labelOrientation ===
                          "vertical"
                            ? "flex-col items-center px-3 py-3 text-center"
                            : "flex-row items-center gap-3 px-3 py-2 text-left"
                        }`}
                      >
                        {labelOrientation ===
                        "horizontal" && (
                          <div className="flex h-[126px] w-[126px] shrink-0 items-center justify-center">
                            <img
                              src={qrDataUrl}
                              alt="Listing QR code"
                              className="h-full w-full object-contain"
                            />
                          </div>
                        )}

                        <div
                          className={`min-w-0 ${
                            labelOrientation ===
                            "vertical"
                              ? "w-full shrink-0"
                              : "flex-1"
                          }`}
                        >
                          <p
                            className={`truncate font-black uppercase leading-none ${
                              labelOrientation ===
                              "vertical"
                                ? "text-[12px]"
                                : "text-[13px]"
                            }`}
                          >
                            {vendorName}
                          </p>

                          <p
                            className={`truncate font-bold leading-none ${
                              labelOrientation ===
                              "vertical"
                                ? "mt-1 text-[10px]"
                                : "mt-2 text-[11px]"
                            }`}
                          >
                            {isGraded(qrItem)
                              ? `${qrItem.grading_company || "Graded"} ${qrItem.grade || ""}`.trim()
                              : qrItem.condition ||
                                "Raw"}
                          </p>

                          {labelOrientation ===
                            "horizontal" && (
                              <p className="mt-3 whitespace-nowrap text-[12px] font-black uppercase leading-none">
                                {showPriceOnLabel
                                  ? `$${Number(
                                      qrItem.price ?? 0
                                    ).toFixed(2)}`
                                  : "Scan for Price"}
                              </p>
                            )}
                        </div>

                        {labelOrientation ===
                        "vertical" ? (
                          <>
                            <div className="mt-2 flex aspect-square w-[82%] max-w-[126px] flex-1 items-center justify-center">
                              <img
                                src={qrDataUrl}
                                alt="Listing QR code"
                                className="h-full max-h-[126px] w-full max-w-[126px] object-contain"
                              />
                            </div>

                            <p className="mt-2 shrink-0 whitespace-nowrap text-[11px] font-black uppercase leading-none">
                              {showPriceOnLabel
                                ? `$${Number(
                                    qrItem.price ?? 0
                                  ).toFixed(2)}`
                                : "Scan for Price"}
                            </p>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <p className="mt-4 text-center text-xs text-zinc-600">
                      Full-label preview • MintRadar now uses the entire label surface for a larger, easier-to-scan QR code.
                    </p>
                  </div>

                  <div className="mt-5 rounded-2xl border border-zinc-800 bg-black p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                          Direct Bluetooth
                        </p>

                        <p className="mt-1 text-sm font-black text-white">
                          Polono P31S • Full-label Bluetooth print
                        </p>

                        <p className="mt-1 text-xs leading-5 text-zinc-600">
                          Uses the full printable label area with an enlarged MintRadar QR code.
                        </p>
                      </div>

                      <span
                        className={`w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
                          p31sConnected
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                            : "border-zinc-800 bg-zinc-950 text-zinc-600"
                        }`}
                      >
                        {p31sConnected
                          ? "Connected"
                          : "Not Connected"}
                      </span>
                    </div>

                    {!p31sSupported && (
                      <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs font-bold leading-5 text-amber-200">
                        This browser/device does not expose Web Bluetooth. After MintRadar is deployed over HTTPS, open it in a Web Bluetooth-capable browser/device to test direct P31S printing.
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {!p31sConnected && (
                        <button
                          type="button"
                          onClick={() =>
                            void connectP31S()
                          }
                          disabled={
                            p31sBusy ||
                            !p31sSupported
                          }
                          className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {p31sBusy
                            ? "Connecting..."
                            : "Connect P31S"}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          void printQrLabelP31S()
                        }
                        disabled={
                          p31sBusy ||
                          !p31sSupported
                        }
                        className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {p31sBusy
                          ? "Working..."
                          : p31sConnected
                            ? "Print to P31S"
                            : "Connect & Print"}
                      </button>
                    </div>

                    {p31sStatus && (
                      <p className="mt-3 text-xs font-bold leading-5 text-zinc-500">
                        {p31sStatus}
                      </p>
                    )}
                  </div>

                  <div className="mt-5 rounded-2xl border border-zinc-800 bg-black p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                          Direct Bluetooth
                        </p>

                        <p className="mt-1 text-sm font-black text-white">
                          Niimbot D11_H • 12 × 40 mm
                        </p>

                        <p className="mt-1 text-xs leading-5 text-zinc-600">
                          Uses the full D11_H printable area with a large QR code for easier scanning.
                        </p>
                      </div>

                      <span
                        className={`w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
                          niimbotConnected
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                            : "border-zinc-800 bg-zinc-950 text-zinc-600"
                        }`}
                      >
                        {niimbotConnected
                          ? "Connected"
                          : "Not Connected"}
                      </span>
                    </div>

                    {!niimbotSupported && (
                      <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs font-bold leading-5 text-amber-200">
                        This browser/device does not expose Web Bluetooth. Open MintRadar over HTTPS in a supported Bluetooth browser/device to test the D11_H.
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {!niimbotConnected && (
                        <button
                          type="button"
                          onClick={() => void connectD11H()}
                          disabled={niimbotBusy || !niimbotSupported}
                          className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {niimbotBusy
                            ? "Connecting..."
                            : "Connect D11_H"}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => void printQrLabelD11H()}
                        disabled={niimbotBusy || !niimbotSupported}
                        className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {niimbotBusy
                          ? "Working..."
                          : niimbotConnected
                            ? "Print to D11_H"
                            : "Connect & Print"}
                      </button>
                    </div>

                    {niimbotStatus && (
                      <p className="mt-3 text-xs font-bold leading-5 text-zinc-500">
                        {niimbotStatus}
                      </p>
                    )}
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