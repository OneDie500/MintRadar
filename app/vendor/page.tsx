"use client";

import { useEffect, useState } from "react";
import { registerPlugin } from "@capacitor/core";
import Link from "next/link";
import Image from "next/image";
import TradeAnalyzer from "../components/TradeAnalyzer";
import BuyingAnalyzer from "../components/BuyingAnalyzer";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { getActiveVendorMembership } from "../../lib/active-vendor";
import QRCode from "qrcode";
import {
  mintRadarPrintService,
} from "../../lib/printing/print-service";
import {
  getMintRadarPrinterProfiles,
  getMintRadarPrinterProfile,
} from "../../lib/printing/printer-registry";
import type {
  MintRadarDiscoveredPrinter,
  MintRadarPrinterProfileId,
} from "../../lib/printing/types";
import {
  disconnectD11H,
  identifyD11H,
  printD11HImage,
  supportsNiimbotWebBluetooth,
} from "../../lib/niimbot-web";
import { encodeListingId } from "../../lib/listing-short-code";

type MintRadarNativePrinterBridge = {
  findPrinters(): Promise<{
    printers: MintRadarDiscoveredPrinter[];
  }>;

  print(options: {
    printerModel: string;
    testPrint?: boolean;
    imageBase64?: string;
    width?: number;
    height?: number;
    copies?: number;
  }): Promise<{
    printed?: boolean;
    printerName?: string;
    modelId?: number;
    testWidth?: number;
    testHeight?: number;
    realLabel?: boolean;
  }>;
};

const MintRadarNativePrinter =
  registerPlugin<MintRadarNativePrinterBridge>(
    "MintRadarNativePrinter"
  );

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


function getPrinterProximityLabel(rssi?: number) {
  if (typeof rssi !== "number") {
    return {
      label: "Unknown",
      tone: "border-zinc-800 bg-zinc-950 text-zinc-600",
    };
  }

  if (rssi >= -50) {
    return {
      label: "Very Close",
      tone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    };
  }

  if (rssi >= -70) {
    return {
      label: "Nearby",
      tone: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    };
  }

  if (rssi >= -85) {
    return {
      label: "Far Away",
      tone: "border-yellow-400/30 bg-yellow-400/10 text-yellow-300",
    };
  }

  return {
    label: "Weak Signal",
    tone: "border-red-400/30 bg-red-400/10 text-red-300",
  };
}

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

const labelPrinterProfiles =
  getMintRadarPrinterProfiles();


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

  const [vendorLogoUrl, setVendorLogoUrl] =
    useState<string | null>(null);

  const [labelBrandingMode, setLabelBrandingMode] =
    useState<"business_name" | "logo">("business_name");

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

  const [selectedLabelPrinter, setSelectedLabelPrinter] =
    useState<MintRadarPrinterProfileId>("p31s");

  const selectedLabelPrinterProfile =
    getMintRadarPrinterProfile(
      selectedLabelPrinter
    );

  const [
    connectedLabelPrinter,
    setConnectedLabelPrinter,
  ] = useState<MintRadarPrinterProfileId | null>(
    null
  );

  const connectedLabelPrinterProfile =
    connectedLabelPrinter
      ? getMintRadarPrinterProfile(
          connectedLabelPrinter
        )
      : null;

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

  const [
    d110Connected,
    setD110Connected,
  ] = useState(false);

  const [
    d110Busy,
    setD110Busy,
  ] = useState(false);

  const [
    d110Status,
    setD110Status,
  ] = useState("");

  const [
    discoveredLabelPrinters,
    setDiscoveredLabelPrinters,
  ] = useState<MintRadarDiscoveredPrinter[]>([]);

  const [
    labelDiscoveryBusy,
    setLabelDiscoveryBusy,
  ] = useState(false);

  const [
    labelDiscoveryStatus,
    setLabelDiscoveryStatus,
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
    let active = true;

    async function detectP31SPrinting() {
      if (mintRadarPrintService.native) {
        const supported =
          await mintRadarPrintService.isNativePrintingSupported();

        if (active) {
          setP31sSupported(supported);
        }

        return;
      }

      if (active) {
        setP31sSupported(
          mintRadarPrintService.preferredTransport ===
            "web-bluetooth"
        );
      }
    }

    void detectP31SPrinting();

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

    return () => {
      active = false;
    };
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

        const { data: vendorProfile, error: vendorProfileError } =
          await supabase
            .from("vendors")
            .select("business_name, logo_url, label_branding_mode")
            .eq("id", membership.vendor_id)
            .single();

        if (vendorProfileError) {
          throw vendorProfileError;
        }

        setVendorName(
          vendorProfile?.business_name ||
            membership.vendor?.business_name ||
            "MintRadar Vendor"
        );

        setVendorLogoUrl(
          typeof vendorProfile?.logo_url === "string" &&
            vendorProfile.logo_url.trim()
            ? vendorProfile.logo_url.trim()
            : null
        );

        setLabelBrandingMode(
          vendorProfile?.label_branding_mode === "logo"
            ? "logo"
            : "business_name"
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
    setD110Status("");

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
    if (!qrItem) {
      throw new Error(
        "Open a MintRadar label first."
      );
    }

    // --------------------------------------------------
    // P31S 13 × 38 MM CALIBRATED LABEL
    // --------------------------------------------------
    //
    // IMPORTANT:
    // The known-good P31S transport expects a 320 × 112 source canvas.
    // The printer driver then rotates that source into the printer's
    // 112 × 320 physical raster.
    //
    // HORIZONTAL:
    //   Render directly into the 320 × 112 transport canvas.
    //
    // VERTICAL:
    //   First render the finished label exactly as we want it to appear
    //   physically at 112 × 320, then rotate that finished design
    //   COUNTER-CLOCKWISE into the required 320 × 112 transport canvas.
    //   The P31S driver's clockwise rotation restores it to the intended
    //   upright 112 × 320 physical label.
    //
    // This keeps lib/p31s-web.ts untouched and gives native/web printing
    // the same finished source canvas.
    // --------------------------------------------------

    const transportCanvas =
      document.createElement(
        "canvas"
      );

    transportCanvas.width = 320;
    transportCanvas.height = 112;

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

    const bottomText =
      showPriceOnLabel
        ? `$${price}`
        : "SCAN FOR PRICE";

    const shortCode =
      encodeListingId(
        qrItem.id
      );

    const listingUrl =
      `${window.location.origin}/l/${shortCode}`;

    const loadVendorLogo =
      async () => {
        if (
          labelBrandingMode !== "logo" ||
          !vendorLogoUrl
        ) {
          return null;
        }

        try {
          const response =
            await fetch(
              vendorLogoUrl,
              {
                mode: "cors",
                cache: "no-store",
              }
            );

          if (!response.ok) {
            throw new Error(
              `Vendor logo request failed with status ${response.status}.`
            );
          }

          const blob =
            await response.blob();

          const localDataUrl =
            await new Promise<string>(
              (
                resolve,
                reject
              ) => {
                const reader =
                  new FileReader();

                reader.onload =
                  () => {
                    if (
                      typeof reader.result ===
                      "string"
                    ) {
                      resolve(
                        reader.result
                      );
                    } else {
                      reject(
                        new Error(
                          "MintRadar could not convert the vendor logo into a local image."
                        )
                      );
                    }
                  };

                reader.onerror =
                  () =>
                    reject(
                      new Error(
                        "MintRadar could not read the vendor logo."
                      )
                    );

                reader.readAsDataURL(
                  blob
                );
              }
            );

          return await loadLabelImage(
            localDataUrl
          );
        } catch (
          logoError
        ) {
          console.warn(
            "Vendor label logo could not be loaded safely. Falling back to business name.",
            logoError
          );

          return null;
        }
      };

    // --------------------------------------------------
    // VERTICAL LABEL
    // --------------------------------------------------

    if (
      labelOrientation ===
      "vertical"
    ) {
      const finishedCanvas =
        document.createElement(
          "canvas"
        );

      finishedCanvas.width = 112;
      finishedCanvas.height = 320;

      const ctx =
        finishedCanvas.getContext(
          "2d"
        );

      if (!ctx) {
        throw new Error(
          "MintRadar could not create the vertical P31S label image."
        );
      }

      ctx.imageSmoothingEnabled =
        false;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(
        0,
        0,
        finishedCanvas.width,
        finishedCanvas.height
      );

      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      // P31S physical safe area.
      //
      // The native/web driver rotates this finished portrait label
      // onto the 112 px printhead axis. Real-world testing showed the
      // far-right physical edge clips slightly, so we intentionally
      // bias the entire portrait design 6 px left while keeping a
      // generous QR quiet zone.
      const safeLeft = 4;
      const safeRight = 16;
      const safeWidth =
        finishedCanvas.width -
        safeLeft -
        safeRight;
      const safeCenter =
        safeLeft +
        safeWidth / 2;

      // Text/branding should be visually centered on the physical
      // 112 px label even though the QR remains biased inside the
      // proven clipping-safe area.
      const textCenter =
        finishedCanvas.width / 2;

      // ------------------------------
      // VENDOR BRANDING
      // ------------------------------

      const logo =
        await loadVendorLogo();

      if (logo) {
        const maxLogoWidth =
          safeWidth;

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
          Math.round(
            textCenter -
              logoWidth / 2
          ),
          12,
          logoWidth,
          logoHeight
        );
      } else {
        const vendorText =
          vendorName.toUpperCase();

        const vendorSize =
          fitCanvasText(
            ctx,
            vendorText,
            safeWidth,
            16,
            9,
            900
          );

        ctx.font =
          `900 ${vendorSize}px Arial, Helvetica, sans-serif`;

        ctx.fillText(
          vendorText,
          textCenter,
          12
        );
      }

      // ------------------------------
      // CONDITION / GRADE
      // ------------------------------

      const conditionSize =
        fitCanvasText(
          ctx,
          condition,
          safeWidth,
          14,
          9,
          800
        );

      ctx.font =
        `800 ${conditionSize}px Arial, Helvetica, sans-serif`;

      ctx.fillText(
        condition,
        finishedCanvas.width /
          2,
        42
      );

      // ------------------------------
      // QR
      // ------------------------------
      //
      // Use nearly the full safe width for the QR. At 96 px,
      // the encoded modules are materially larger than the previous
      // 88 px version while the QR generator still provides a real
      // quiet zone around the code.
      // DIAGNOSTIC LARGE-QR TEST:
      // This is the FINAL physical draw size, not just source resolution.
      // 108 px nearly fills the 112-dot printhead width, so the printed
      // size difference should be unmistakable.
      const qrSize = 108;

      const qrRenderSize = 384;

      const p31sQrDataUrl =
        await QRCode.toDataURL(
          listingUrl,
          {
            width: qrRenderSize,
            margin: 4,
            errorCorrectionLevel:
              "L",
          }
        );

      const qr =
        await loadLabelImage(
          p31sQrDataUrl
        );

      const qrX = 0;

      const qrY = 66;

      ctx.drawImage(
        qr,
        qrX,
        qrY,
        qrSize,
        qrSize
      );

      // ------------------------------
      // PRICE / SCAN MESSAGE
      // ------------------------------

      const bottomSize =
        fitCanvasText(
          ctx,
          bottomText,
          safeWidth,
          showPriceOnLabel
            ? 27
            : 15,
          9,
          900
        );

      ctx.font =
        `900 ${bottomSize}px Arial, Helvetica, sans-serif`;

      ctx.fillText(
        bottomText,
        finishedCanvas.width /
          2,
        178
      );

      // A small MintRadar footer helps visually anchor the
      // long vertical stock without crowding the QR.
      const footerText =
        "MINTRADAR";

      const footerSize =
        fitCanvasText(
          ctx,
          footerText,
          safeWidth,
          11,
          8,
          800
        );

      ctx.font =
        `800 ${footerSize}px Arial, Helvetica, sans-serif`;

      ctx.fillText(
        footerText,
        finishedCanvas.width /
          2,
        224
      );

      // Rotate the finished portrait design COUNTER-CLOCKWISE
      // into the 320 × 112 transport canvas. The known-good
      // P31S driver rotates it clockwise for the physical raster.
      const transportCtx =
        transportCanvas.getContext(
          "2d"
        );

      if (!transportCtx) {
        throw new Error(
          "MintRadar could not create the P31S transport image."
        );
      }

      transportCtx.imageSmoothingEnabled =
        false;

      transportCtx.fillStyle =
        "#ffffff";

      transportCtx.fillRect(
        0,
        0,
        transportCanvas.width,
        transportCanvas.height
      );

      // First build the complete rotated transport raster exactly as before.
      const rotatedCanvas =
        document.createElement(
          "canvas"
        );

      rotatedCanvas.width =
        transportCanvas.width;
      rotatedCanvas.height =
        transportCanvas.height;

      const rotatedCtx =
        rotatedCanvas.getContext(
          "2d"
        );

      if (!rotatedCtx) {
        throw new Error(
          "MintRadar could not create the rotated P31S transport image."
        );
      }

      rotatedCtx.imageSmoothingEnabled =
        false;

      rotatedCtx.fillStyle =
        "#ffffff";

      rotatedCtx.fillRect(
        0,
        0,
        rotatedCanvas.width,
        rotatedCanvas.height
      );

      rotatedCtx.save();

      rotatedCtx.translate(
        0,
        rotatedCanvas.height
      );

      rotatedCtx.rotate(
        -Math.PI / 2
      );

      rotatedCtx.drawImage(
        finishedCanvas,
        0,
        0
      );

      rotatedCtx.restore();

      // PHYSICAL-ALIGNMENT DIAGNOSTIC:
      // Move the ENTIRE completed transport raster together across the
      // printer's physical 112-dot width. No QR/text coordinates or sizes
      // are changed here.
      const transportPhysicalOffset =
        5;

      transportCtx.drawImage(
        rotatedCanvas,
        0,
        transportPhysicalOffset
      );

      return transportCanvas;
    }

    // --------------------------------------------------
    // HORIZONTAL LABEL
    // --------------------------------------------------

    const ctx =
      transportCanvas.getContext(
        "2d"
      );

    if (!ctx) {
      throw new Error(
        "MintRadar could not create the horizontal P31S label image."
      );
    }

    ctx.imageSmoothingEnabled =
      false;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      0,
      0,
      transportCanvas.width,
      transportCanvas.height
    );

    ctx.fillStyle = "#000000";
    ctx.textBaseline = "top";

    // Use a larger QR on the 112 px short axis while retaining
    // 4 px of physical clearance on every side.
    // FINAL HORIZONTAL P31S CALIBRATION:
    // Keep the QR materially larger than the original unreadable 88 px
    // version, while reserving a protected top band so the printer cannot
    // eat into the QR quiet zone.
    const qrSize = 104;
    const qrX = 4;
    const qrY = 7;

    const qrRenderSize = 416;

    const p31sQrDataUrl =
      await QRCode.toDataURL(
        listingUrl,
        {
          width: qrRenderSize,
          margin: 4,
          errorCorrectionLevel:
            "L",
        }
      );

    const qr =
      await loadLabelImage(
        p31sQrDataUrl
      );

    ctx.drawImage(
      qr,
      qrX,
      qrY,
      qrSize,
      qrSize
    );

    const pad = 10;

    const textX =
      qrX +
      qrSize +
      10;

    const textWidth =
      transportCanvas.width -
      textX -
      pad;

    ctx.fillStyle = "#000000";
    ctx.textAlign = "left";

    // ------------------------------
    // VENDOR BRANDING
    // ------------------------------

    const logo =
      await loadVendorLogo();

    if (logo) {
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
        19,
        logoWidth,
        logoHeight
      );
    } else {
      const vendorText =
        vendorName.toUpperCase();

      const vendorSize =
        fitCanvasText(
          ctx,
          vendorText,
          textWidth,
          17,
          9,
          900
        );

      ctx.font =
        `900 ${vendorSize}px Arial, Helvetica, sans-serif`;

      ctx.fillText(
        vendorText,
        textX,
        20
      );
    }

    // ------------------------------
    // CONDITION / GRADE
    // ------------------------------

    const conditionSize =
      fitCanvasText(
        ctx,
        condition,
        textWidth,
        14,
        8,
        800
      );

    ctx.font =
      `800 ${conditionSize}px Arial, Helvetica, sans-serif`;

    ctx.fillText(
      condition,
      textX,
      47
    );

    // ------------------------------
    // PRICE / SCAN MESSAGE
    // ------------------------------

    const bottomSize =
      fitCanvasText(
        ctx,
        bottomText,
        textWidth,
        showPriceOnLabel
          ? 23
          : 15,
        10,
        900
      );

    ctx.font =
      `900 ${bottomSize}px Arial, Helvetica, sans-serif`;

    ctx.fillText(
      bottomText,
      textX,
      74
    );

    return transportCanvas;
  }

  async function findNearbyLabelPrinters() {
    if (!mintRadarPrintService.native) {
      setLabelDiscoveryStatus(
        "Find Labeler is available in the MintRadar iPhone app."
      );
      return;
    }

    if (connectedLabelPrinter) {
      setLabelDiscoveryStatus(
        "Disconnect the active labeler before scanning for another one."
      );
      return;
    }

    setLabelDiscoveryBusy(true);
    setLabelDiscoveryStatus("");
    setDiscoveredLabelPrinters([]);

    try {
      const result =
        await MintRadarNativePrinter.findPrinters();

      const printers =
        Array.isArray(result?.printers)
          ? result.printers
          : [];

      setDiscoveredLabelPrinters(
        printers
      );

      if (printers.length === 0) {
        setLabelDiscoveryStatus(
          "No supported MintRadar labelers were found. Make sure the printer is powered on and nearby."
        );
        return;
      }

      setLabelDiscoveryStatus(
        `Found ${printers.length} supported ${
          printers.length === 1
            ? "labeler"
            : "labelers"
        }.`
      );
    } catch (error: any) {
      console.error(
        "Labeler discovery error:",
        error
      );

      setDiscoveredLabelPrinters([]);

      setLabelDiscoveryStatus(
        error?.message ||
          "MintRadar could not scan for nearby labelers."
      );
    } finally {
      setLabelDiscoveryBusy(false);
    }
  }

  async function connectP31S() {
    if (!p31sSupported) {
      setP31sStatus(
        mintRadarPrintService.native
          ? "Native Bluetooth printing is not available in this MintRadar build."
          : "Web Bluetooth is not available in this browser/device."
      );
      return;
    }

    setP31sBusy(true);
    setP31sStatus("");

    try {
      const connection =
        await mintRadarPrintService.connect("p31s");

      setP31sConnected(
        connection.connected
      );

      if (connection.connected) {
        setConnectedLabelPrinter(
          "p31s"
        );
      }

      setP31sStatus(
        `Connected to ${
          connection.printerName || "P31S"
        }.`
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
        !mintRadarPrintService.isConnected(
          "p31s"
        )
      ) {
        const connection =
          await mintRadarPrintService.connect(
            "p31s"
          );

        setP31sConnected(
          connection.connected
        );

        setP31sStatus(
          `Connected to ${
            connection.printerName || "P31S"
          }. Sending label...`
        );
      }

      const canvas =
        await buildP31SLabelCanvas();

      await mintRadarPrintService.printCanvas(
        "p31s",
        canvas
      );

      setP31sConnected(true);
      setConnectedLabelPrinter(
        "p31s"
      );
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

  async function connectD110Native() {
    if (!mintRadarPrintService.native) {
      setD110Status(
        "NIIMBOT D110_M native testing is available in the MintRadar iPhone app."
      );
      return;
    }

    setD110Busy(true);
    setD110Status("");

    try {
      const connection =
        await (mintRadarPrintService as any).connect(
          "niimbot_d110"
        );

      const modelId =
        Number(
          connection?.modelId
        );

      setD110Connected(
        Boolean(
          connection?.connected
        )
      );

      if (connection?.connected) {
        setConnectedLabelPrinter(
          "d110"
        );
      }

      if (
        Number.isFinite(modelId)
      ) {
        setD110Status(
          `Connected to ${
            connection?.printerName ||
            "NIIMBOT D110"
          } • detected model ID ${modelId}${
            modelId === 2304 ||
            modelId === 2320
              ? " • D110 family confirmed."
              : " • connected, but this unit reported a different model ID."
          }`
        );
      } else {
        setD110Status(
          `Connected to ${
            connection?.printerName ||
            "NIIMBOT D110"
          }, but no model ID was returned.`
        );
      }
    } catch (error: any) {
      console.error(
        "D110_M native connect error:",
        error
      );

      setD110Connected(false);

      setD110Status(
        error?.message ||
          "MintRadar could not connect to the NIIMBOT D110_M."
      );
    } finally {
      setD110Busy(false);
    }
  }

  async function testPrintD110Native() {
    if (!mintRadarPrintService.native) {
      setD110Status(
        "D110_M native test printing is available in the MintRadar iPhone app."
      );
      return;
    }

    if (!d110Connected) {
      setD110Status(
        "Connect and identify the D110_M first."
      );
      return;
    }

    setD110Busy(true);
    setD110Status(
      "Sending tiny D110_M B1 test print..."
    );

    try {
      const result =
        await MintRadarNativePrinter.print({
          printerModel:
            "niimbot_d110",
          testPrint: true,
        });

      setD110Status(
        `Test-print sequence sent to ${
          result?.printerName ||
          "NIIMBOT D110_M"
        } • model ID ${
          result?.modelId ?? 2320
        }. Check the paper for the bordered MR test pattern.`
      );
    } catch (error: any) {
      console.error(
        "D110_M native test print error:",
        error
      );

      setD110Status(
        error?.message ||
          "MintRadar could not send the D110_M test print."
      );
    } finally {
      setD110Busy(false);
    }
  }

  async function buildD110LabelCanvas() {
    if (!qrItem) {
      throw new Error(
        "Open a MintRadar label first."
      );
    }

    // --------------------------------------------------
    // NIIMBOT D110_M • P31S-MATCHED + ORIENTATION-AWARE
    // --------------------------------------------------
    //
    // The physical D110_M transport remains 96 × 320.
    //
    // Vertical:
    //   Render directly into the 96 × 320 transport canvas.
    //
    // Horizontal:
    //   Render a logical 320 × 96 horizontal label, then rotate that
    //   finished label into the proven 96 × 320 transport raster.
    //
    // Native Swift / B1 transport does not need to know orientation.
    // --------------------------------------------------

    const transportCanvas =
      document.createElement(
        "canvas"
      );

    transportCanvas.width = 96;
    transportCanvas.height = 320;

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

    const bottomText =
      showPriceOnLabel
        ? `$${price}`
        : "SCAN FOR PRICE";

    const shortCode =
      encodeListingId(
        qrItem.id
      );

    const listingUrl =
      `${window.location.origin}/l/${shortCode}`;

    const loadD110VendorLogo =
      async () => {
        if (
          labelBrandingMode !==
            "logo" ||
          !vendorLogoUrl
        ) {
          return null;
        }

        try {
          const response =
            await fetch(
              vendorLogoUrl,
              {
                mode: "cors",
                cache: "no-store",
              }
            );

          if (!response.ok) {
            throw new Error(
              `Vendor logo request failed with status ${response.status}.`
            );
          }

          const blob =
            await response.blob();

          const localDataUrl =
            await new Promise<string>(
              (
                resolve,
                reject
              ) => {
                const reader =
                  new FileReader();

                reader.onload =
                  () => {
                    if (
                      typeof reader.result ===
                      "string"
                    ) {
                      resolve(
                        reader.result
                      );
                    } else {
                      reject(
                        new Error(
                          "MintRadar could not convert the vendor logo into a local image."
                        )
                      );
                    }
                  };

                reader.onerror =
                  () =>
                    reject(
                      new Error(
                        "MintRadar could not read the vendor logo."
                      )
                    );

                reader.readAsDataURL(
                  blob
                );
              }
            );

          return await loadLabelImage(
            localDataUrl
          );
        } catch (error) {
          console.warn(
            "D110_M vendor logo could not be loaded safely. Falling back to business name.",
            error
          );

          return null;
        }
      };

    const [
      vendorLogo,
      qrData,
    ] =
      await Promise.all([
        loadD110VendorLogo(),
        QRCode.toDataURL(
          listingUrl,
          {
            width: 416,
            margin: 4,
            errorCorrectionLevel:
              "L",
          }
        ),
      ]);

    const qr =
      await loadLabelImage(
        qrData
      );

    if (
      labelOrientation ===
      "horizontal"
    ) {
      // ----------------------------------------------
      // LOGICAL HORIZONTAL LABEL • 320 × 96
      // ----------------------------------------------

      const logicalCanvas =
        document.createElement(
          "canvas"
        );

      logicalCanvas.width = 320;
      logicalCanvas.height = 96;

      const ctx =
        logicalCanvas.getContext(
          "2d"
        );

      if (!ctx) {
        throw new Error(
          "MintRadar could not create the horizontal D110_M label image."
        );
      }

      ctx.imageSmoothingEnabled =
        false;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(
        0,
        0,
        logicalCanvas.width,
        logicalCanvas.height
      );

      ctx.fillStyle = "#000000";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      // QR stays large and isolated on the left, matching the
      // horizontal P31S information hierarchy.
      const qrSize = 86;

      ctx.drawImage(
        qr,
        5,
        5,
        qrSize,
        qrSize
      );

      const contentLeft = 104;
      const contentRight = 312;
      const contentWidth =
        contentRight -
        contentLeft;

      // Vendor branding.
      if (vendorLogo) {
        const maxLogoWidth =
          contentWidth;

        const maxLogoHeight =
          24;

        const scale =
          Math.min(
            maxLogoWidth /
              vendorLogo.naturalWidth,
            maxLogoHeight /
              vendorLogo.naturalHeight
          );

        const logoWidth =
          Math.max(
            1,
            Math.round(
              vendorLogo.naturalWidth *
                scale
            )
          );

        const logoHeight =
          Math.max(
            1,
            Math.round(
              vendorLogo.naturalHeight *
                scale
            )
          );

        ctx.drawImage(
          vendorLogo,
          contentLeft,
          8,
          logoWidth,
          logoHeight
        );
      } else {
        const vendorText =
          vendorName.toUpperCase();

        const vendorSize =
          fitCanvasText(
            ctx,
            vendorText,
            contentWidth,
            15,
            8,
            900
          );

        ctx.font =
          `900 ${vendorSize}px Arial, Helvetica, sans-serif`;

        ctx.fillText(
          vendorText,
          contentLeft,
          8
        );
      }

      // Condition / grade.
      const conditionSize =
        fitCanvasText(
          ctx,
          condition,
          contentWidth,
          14,
          8,
          800
        );

      ctx.font =
        `800 ${conditionSize}px Arial, Helvetica, sans-serif`;

      ctx.fillText(
        condition,
        contentLeft,
        39
      );

      // Price / scan CTA.
      const bottomSize =
        fitCanvasText(
          ctx,
          bottomText,
          contentWidth,
          20,
          10,
          900
        );

      ctx.font =
        `900 ${bottomSize}px Arial, Helvetica, sans-serif`;

      ctx.fillText(
        bottomText,
        contentLeft,
        65
      );

      // ----------------------------------------------
      // ROTATE LOGICAL 320 × 96 INTO PHYSICAL 96 × 320
      // ----------------------------------------------

      const transportCtx =
        transportCanvas.getContext(
          "2d"
        );

      if (!transportCtx) {
        throw new Error(
          "MintRadar could not create the D110_M transport image."
        );
      }

      transportCtx.imageSmoothingEnabled =
        false;

      transportCtx.fillStyle =
        "#ffffff";

      transportCtx.fillRect(
        0,
        0,
        transportCanvas.width,
        transportCanvas.height
      );

      transportCtx.save();

      // Clockwise 90° rotation:
      // logical 320×96 -> physical transport 96×320.
      transportCtx.translate(
        96,
        0
      );

      transportCtx.rotate(
        Math.PI / 2
      );

      transportCtx.drawImage(
        logicalCanvas,
        0,
        0
      );

      transportCtx.restore();

      return transportCanvas;
    }

    // ----------------------------------------------
    // VERTICAL LABEL • DIRECT 96 × 320
    // ----------------------------------------------

    const ctx =
      transportCanvas.getContext(
        "2d"
      );

    if (!ctx) {
      throw new Error(
        "MintRadar could not create the vertical D110_M label image."
      );
    }

    ctx.imageSmoothingEnabled =
      false;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      0,
      0,
      transportCanvas.width,
      transportCanvas.height
    );

    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const safeLeft = 5;
    const safeRight = 5;
    const safeWidth =
      transportCanvas.width -
      safeLeft -
      safeRight;

    const center =
      transportCanvas.width / 2;

    // Vendor branding.
    if (vendorLogo) {
      const maxLogoWidth =
        safeWidth;

      const maxLogoHeight =
        26;

      const scale =
        Math.min(
          maxLogoWidth /
            vendorLogo.naturalWidth,
          maxLogoHeight /
            vendorLogo.naturalHeight
        );

      const logoWidth =
        Math.max(
          1,
          Math.round(
            vendorLogo.naturalWidth *
              scale
          )
        );

      const logoHeight =
        Math.max(
          1,
          Math.round(
            vendorLogo.naturalHeight *
              scale
          )
        );

      ctx.drawImage(
        vendorLogo,
        Math.round(
          center -
            logoWidth / 2
        ),
        12,
        logoWidth,
        logoHeight
      );
    } else {
      const vendorText =
        vendorName.toUpperCase();

      const vendorSize =
        fitCanvasText(
          ctx,
          vendorText,
          safeWidth,
          15,
          8,
          900
        );

      ctx.font =
        `900 ${vendorSize}px Arial, Helvetica, sans-serif`;

      ctx.fillText(
        vendorText,
        center,
        12
      );
    }

    // Condition / grade.
    const conditionSize =
      fitCanvasText(
        ctx,
        condition,
        safeWidth,
        14,
        8,
        800
      );

    ctx.font =
      `800 ${conditionSize}px Arial, Helvetica, sans-serif`;

    ctx.fillText(
      condition,
      center,
      50
    );

    // Listing QR.
    const qrSize = 86;

    ctx.drawImage(
      qr,
      5,
      82,
      qrSize,
      qrSize
    );

    // Price / scan CTA.
    const bottomSize =
      fitCanvasText(
        ctx,
        bottomText,
        safeWidth,
        19,
        10,
        900
      );

    ctx.font =
      `900 ${bottomSize}px Arial, Helvetica, sans-serif`;

    ctx.fillText(
      bottomText,
      center,
      196
    );

    return transportCanvas;
  }

  async function printQrLabelD110Native() {
    if (!mintRadarPrintService.native) {
      setD110Status(
        "D110_M native label printing is available in the MintRadar iPhone app."
      );
      return;
    }

    setD110Busy(true);
    setD110Status("");

    try {
      if (!d110Connected) {
        const connection =
          await (mintRadarPrintService as any).connect(
            "niimbot_d110"
          );

        setD110Connected(
          Boolean(
            connection?.connected
          )
        );

        if (connection?.connected) {
          setConnectedLabelPrinter(
            "d110"
          );
        }

        if (!connection?.connected) {
          throw new Error(
            "MintRadar could not connect to the D110_M."
          );
        }
      }

      const canvas =
        await buildD110LabelCanvas();

      const imageBase64 =
        canvas.toDataURL(
          "image/png"
        );

      const result =
        await MintRadarNativePrinter.print({
          printerModel:
            "niimbot_d110",
          imageBase64,
          width:
            canvas.width,
          height:
            canvas.height,
          copies: 1,
        });

      setD110Connected(true);
      setConnectedLabelPrinter(
        "d110"
      );

      setD110Status(
        `Real MintRadar label sent to ${
          result?.printerName ||
          "NIIMBOT D110_M"
        } • model ID ${
          result?.modelId ?? 2320
        }. Check orientation, clipping, and QR scan.`
      );
    } catch (error: any) {
      console.error(
        "D110_M real label print error:",
        error
      );

      setD110Status(
        error?.message ||
          "MintRadar could not print the real label to the D110_M."
      );
    } finally {
      setD110Busy(false);
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

  async function disconnectActiveLabelPrinter() {
    if (!connectedLabelPrinter) {
      return;
    }

    if (connectedLabelPrinter === "p31s") {
      setP31sBusy(true);
      setP31sStatus("");

      try {
        await mintRadarPrintService.disconnect(
          "p31s"
        );

        setP31sConnected(false);
        setConnectedLabelPrinter(null);
        setP31sStatus(
          "P31S disconnected."
        );
      } catch (error: any) {
        console.error(
          "P31S disconnect error:",
          error
        );

        setP31sStatus(
          error?.message ||
            "MintRadar could not disconnect the P31S."
        );
      } finally {
        setP31sBusy(false);
      }

      return;
    }

    if (connectedLabelPrinter === "d110") {
      setD110Busy(true);
      setD110Status("");

      try {
        await (
          mintRadarPrintService as any
        ).disconnect(
          "niimbot_d110"
        );

        setD110Connected(false);
        setConnectedLabelPrinter(null);
        setD110Status(
          "NIIMBOT D110_M disconnected."
        );
      } catch (error: any) {
        console.error(
          "D110_M disconnect error:",
          error
        );

        setD110Status(
          error?.message ||
            "MintRadar could not disconnect the NIIMBOT D110_M."
        );
      } finally {
        setD110Busy(false);
      }

      return;
    }

    setNiimbotBusy(true);
    setNiimbotStatus("");

    try {
      await disconnectD11H();

      setNiimbotConnected(false);
      setConnectedLabelPrinter(null);
      setNiimbotStatus(
        "NIIMBOT D11_H disconnected."
      );
    } catch (error: any) {
      console.error(
        "D11_H disconnect error:",
        error
      );

      setNiimbotStatus(
        error?.message ||
          "MintRadar could not disconnect the NIIMBOT D11_H."
      );
    } finally {
      setNiimbotBusy(false);
    }
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
      setConnectedLabelPrinter(
        "d11h"
      );
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
        setConnectedLabelPrinter(
          "d11h"
        );
        setNiimbotStatus(
          `Connected to ${printer?.label || "Niimbot D11_H"}. Sending label...`
        );
      }

      const canvas = await buildD11HLabelCanvas();
      const imageDataUrl = canvas.toDataURL("image/png");

      await printD11HImage(imageDataUrl);

      setNiimbotConnected(true);
      setConnectedLabelPrinter(
        "d11h"
      );
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
                href="/vendor/orders"
                className="flex h-full w-full items-center justify-center whitespace-nowrap rounded-xl border border-sky-400/30 bg-sky-400/10 px-6 py-4 text-center font-black text-sky-300 transition hover:bg-sky-400 hover:text-black"
              >
                Orders
              </Link>

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
                className="flex h-full w-full items-center justify-center whitespace-nowrap rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-4 text-center text-sm font-black text-red-300 transition hover:bg-red-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deletingAllInventory ? (
                  "Deleting..."
                ) : (
                  <span className="leading-tight">
                    Delete All
                    <br />
                    Inventory
                  </span>
                )}
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
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
                      Direct Bluetooth
                    </p>

                    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600">
                            Nearby Labelers
                          </p>

                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            void findNearbyLabelPrinters();
                          }}
                          disabled={
                            labelDiscoveryBusy ||
                            Boolean(
                              connectedLabelPrinter
                            ) ||
                            !mintRadarPrintService.native
                          }
                          className="shrink-0 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {labelDiscoveryBusy
                            ? "Scanning..."
                            : "Find Labeler"}
                        </button>
                      </div>

                      {labelDiscoveryStatus && (
                        <p className="mt-3 text-xs font-bold leading-5 text-zinc-500">
                          {labelDiscoveryStatus}
                        </p>
                      )}

                      {discoveredLabelPrinters.length >
                        0 && (
                        <div className="mt-3 space-y-2">
                          {discoveredLabelPrinters.map(
                            (printer) => {
                              const profile =
                                printer.profileId
                                  ? getMintRadarPrinterProfile(
                                      printer.profileId
                                    )
                                  : null;

                              const canSelect =
                                printer.supported &&
                                Boolean(profile);

                              return (
                                <button
                                  key={
                                    printer.deviceId
                                  }
                                  type="button"
                                  disabled={
                                    !canSelect ||
                                    Boolean(
                                      connectedLabelPrinter
                                    )
                                  }
                                  onClick={() => {
                                    if (
                                      !printer.profileId
                                    ) {
                                      return;
                                    }

                                    setSelectedLabelPrinter(
                                      printer.profileId
                                    );

                                    setLabelDiscoveryStatus("");
                                  }}
                                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-black px-3 py-3 text-left transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-black text-white">
                                        {printer.deviceName ||
                                          profile?.displayName ||
                                          "Bluetooth Labeler"}
                                      </p>
                                    </div>

                                    <p className="mt-1 truncate text-[11px] font-bold text-zinc-600">
                                      {profile
                                        ? `${profile.manufacturer} • ${profile.displayName}`
                                        : "Unrecognized labeler"}
                                    </p>
                                  </div>

                                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                                    <span
                                      className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                                        printer.supported
                                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                                          : "border-zinc-800 bg-zinc-950 text-zinc-600"
                                      }`}
                                    >
                                      {printer.supported
                                        ? "Supported"
                                        : "Unknown"}
                                    </span>

                                    {(() => {
                                      const proximity =
                                        getPrinterProximityLabel(
                                          printer.rssi
                                        );

                                      return (
                                        <span
                                          className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${proximity.tone}`}
                                        >
                                          {proximity.label}
                                        </span>
                                      );
                                    })()}
                                  </div>
                                </button>
                              );
                            }
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-3">
                      <label className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-zinc-500">
                        Printer
                      </label>

                      <select
                        value={selectedLabelPrinter}
                        onChange={(event) =>
                          setSelectedLabelPrinter(
                            event.target
                              .value as MintRadarPrinterProfileId
                          )
                        }
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm font-black text-white outline-none transition focus:border-emerald-400"
                      >
                        {labelPrinterProfiles.map(
                          (printer) => (
                            <option
                              key={printer.id}
                              value={printer.id}
                            >
                              {printer.displayName}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-600">
                            Connected Printer
                          </p>

                          <p
                            className={`mt-1 truncate text-xs font-black ${
                              connectedLabelPrinterProfile
                                ? "text-white"
                                : "text-zinc-500"
                            }`}
                          >
                            {connectedLabelPrinterProfile
                              ? connectedLabelPrinterProfile.displayName
                              : "No printer connected"}
                          </p>
                        </div>

                        <span
                          className={`w-fit shrink-0 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${
                            connectedLabelPrinterProfile
                              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                              : "border-zinc-800 bg-black text-zinc-600"
                          }`}
                        >
                          {connectedLabelPrinterProfile
                            ? "Connected"
                            : "Offline"}
                        </span>
                      </div>

                      {connectedLabelPrinter &&
                        connectedLabelPrinter !==
                          selectedLabelPrinter && (
                          <p className="mt-2 text-[11px] font-bold leading-4 text-amber-300">
                            {connectedLabelPrinterProfile?.displayName} is still connected. Disconnect it before connecting {selectedLabelPrinterProfile.displayName}.
                          </p>
                        )}
                    </div>

                    {selectedLabelPrinter === "p31s" &&
                      !p31sSupported && (
                        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs font-bold leading-5 text-amber-200">
                          Bluetooth printing is not available for this printer on this browser/device.
                        </div>
                      )}

                    {selectedLabelPrinter === "d11h" &&
                      !niimbotSupported && (
                        <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs font-bold leading-5 text-amber-200">
                          Bluetooth printing is not available for this printer on this browser/device.
                        </div>
                      )}

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            selectedLabelPrinter ===
                            "p31s"
                          ) {
                            void connectP31S();
                            return;
                          }

                          if (
                            selectedLabelPrinter ===
                            "d110"
                          ) {
                            void connectD110Native();
                            return;
                          }

                          void connectD11H();
                        }}
                        disabled={
                          Boolean(
                            connectedLabelPrinter
                          ) ||
                          (selectedLabelPrinter === "p31s"
                            ? p31sBusy ||
                              !p31sSupported
                            : selectedLabelPrinter === "d110"
                              ? d110Busy ||
                                !mintRadarPrintService.native
                              : niimbotBusy ||
                                !niimbotSupported)
                        }
                        className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-3 text-sm font-black text-emerald-300 transition hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {(
                          selectedLabelPrinter === "p31s"
                            ? p31sBusy
                            : selectedLabelPrinter === "d110"
                              ? d110Busy
                              : niimbotBusy
                        )
                          ? "Connecting..."
                          : "Connect"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void disconnectActiveLabelPrinter();
                        }}
                        disabled={
                          !connectedLabelPrinter ||
                          p31sBusy ||
                          d110Busy ||
                          niimbotBusy
                        }
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-3 text-sm font-black text-zinc-300 transition hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {p31sBusy ||
                        d110Busy ||
                        niimbotBusy
                          ? "Working..."
                          : "Disconnect"}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (
                            selectedLabelPrinter ===
                            "p31s"
                          ) {
                            void printQrLabelP31S();
                            return;
                          }

                          if (
                            selectedLabelPrinter ===
                            "d110"
                          ) {
                            void printQrLabelD110Native();
                            return;
                          }

                          void printQrLabelD11H();
                        }}
                        disabled={
                          connectedLabelPrinter !==
                            selectedLabelPrinter ||
                          (selectedLabelPrinter === "p31s"
                            ? p31sBusy ||
                              !p31sSupported
                            : selectedLabelPrinter === "d110"
                              ? d110Busy ||
                                !d110Connected ||
                                !qrItem
                              : niimbotBusy ||
                                !niimbotSupported)
                        }
                        className="rounded-xl bg-emerald-400 px-3 py-3 text-sm font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {(
                          selectedLabelPrinter === "p31s"
                            ? p31sBusy
                            : selectedLabelPrinter === "d110"
                              ? d110Busy
                              : niimbotBusy
                        )
                          ? "Working..."
                          : "Print"}
                      </button>
                    </div>

                    {(selectedLabelPrinter === "p31s"
                      ? p31sStatus
                      : selectedLabelPrinter === "d110"
                        ? d110Status
                        : niimbotStatus) && (
                      <p className="mt-3 text-xs font-bold leading-5 text-zinc-500">
                        {selectedLabelPrinter === "p31s"
                          ? p31sStatus
                          : selectedLabelPrinter === "d110"
                            ? d110Status
                            : niimbotStatus}
                      </p>
                    )}
                  </div>

                  <div className="sticky bottom-0 z-10 -mx-5 mt-5 border-t border-zinc-900 bg-zinc-950/95 px-5 pb-1 pt-4 backdrop-blur">
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