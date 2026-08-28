"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

type ListingType =
  | "raw"
  | "graded"
  | "sealed";

type CatalogType =
  | "Pokemon"
  | "Sports"
  | "One Piece"
  | "Magic: The Gathering"
  | "Yu-Gi-Oh!"
  | "Lorcana"
  | "Other";

type CatalogCard = {
  external_id: string;
  data_source: string;

  name?: string | null;
  set_name?: string | null;
  set_id?: string | null;
  card_number?: string | null;

  image_url?: string | null;

  category?: string | null;
  rarity?: string | null;

  edition?: string | null;
  finish?: string | null;

  illustrator?: string | null;

  // Sports-specific catalog fields
  year?: string | null;
  manufacturer?: string | null;
  release_name?: string | null;
  parallel_name?: string | null;
  sport?: string | null;
  print_run?: number | null;
  rookie?: boolean | null;
};

type Membership = {
  vendor_id: string;
};

const SPORTS_PARALLELS = [
  "Silver",
  "Prizm",
  "Refractor",
  "Chrome Refractor",
  "Optic Holo",
  "X-Fractor",
  "Mojo",
  "Wave",
  "Shimmer",
  "Disco",
  "Pulsar",
  "Scope",
  "Hyper",
  "Ice",
  "Cracked Ice",
  "Sparkle",
  "Velocity",
  "Laser",
  "Choice",
  "Red",
  "Blue",
  "Green",
  "Purple",
  "Pink",
  "Orange",
  "Gold",
  "Black",
  "White",
  "Camo",
  "Zebra",
  "Tiger",
  "Snakeskin",
] as const;

const CATALOGS: {
  value: CatalogType;
  shortLabel: string;
  description: string;
}[] = [
  {
    value: "Pokemon",
    shortLabel: "Pokémon",
    description:
      "Search the connected Pokémon card catalog.",
  },
  {
    value: "Sports",
    shortLabel: "Sports",
    description:
      "Search the connected sports-card catalog by player, year, release and parallel.",
  },
  {
    value: "One Piece",
    shortLabel: "One Piece",
    description:
      "One Piece Card Game collectibles.",
  },
  {
    value: "Magic: The Gathering",
    shortLabel: "MTG",
    description:
      "Search the connected Magic: The Gathering catalog.",
  },
  {
    value: "Yu-Gi-Oh!",
    shortLabel: "Yu-Gi-Oh!",
    description:
      "Search the connected Yu-Gi-Oh! card catalog.",
  },
  {
    value: "Lorcana",
    shortLabel: "Lorcana",
    description:
      "Disney Lorcana collectibles.",
  },
  {
    value: "Other",
    shortLabel: "Other",
    description:
      "Other collectible cards and categories.",
  },
];

export default function AddInventoryPage() {
  const router = useRouter();

  const [listingType, setListingType] =
    useState<ListingType>("raw");

  const [catalogType, setCatalogType] =
    useState<CatalogType>("Pokemon");

  const [showBackToTop, setShowBackToTop] =
    useState(false);

  // -----------------------------------------
  // CATALOG SEARCH
  // -----------------------------------------

  const [searchTerm, setSearchTerm] =
    useState("");

  const [results, setResults] =
    useState<CatalogCard[]>([]);

  const [selectedCard, setSelectedCard] =
    useState<CatalogCard | null>(null);

  const [page, setPage] =
    useState(1);

  const [hasMore, setHasMore] =
    useState(false);

  const [searching, setSearching] =
    useState(false);

  const [loadingMore, setLoadingMore] =
    useState(false);

  const [searchError, setSearchError] =
    useState("");

  // -----------------------------------------
  // MANUAL CATALOG FIELDS
  // -----------------------------------------

  const [manualName, setManualName] =
    useState("");

  const [manualSetName, setManualSetName] =
    useState("");

  const [
    manualCardNumber,
    setManualCardNumber,
  ] = useState("");

  const [manualRarity, setManualRarity] =
    useState("");

  const [
    manualImageUrl,
    setManualImageUrl,
  ] = useState("");

  const [manualError, setManualError] =
    useState("");

  // -----------------------------------------
  // VENDOR
  // -----------------------------------------

  const [membership, setMembership] =
    useState<Membership | null>(null);

  const [checkingAuth, setCheckingAuth] =
    useState(true);

  // -----------------------------------------
  // RAW FIELDS
  // -----------------------------------------

  const [condition, setCondition] =
    useState("NM");

  const [edition, setEdition] =
    useState("");

  const [finish, setFinish] =
    useState("");

  // -----------------------------------------
  // GRADED FIELDS
  // -----------------------------------------

  const [
    gradingCompany,
    setGradingCompany,
  ] = useState("PSA");

  const [grade, setGrade] =
    useState("10");

  const [
    certNumber,
    setCertNumber,
  ] = useState("");

  // -----------------------------------------
  // SHARED LISTING FIELDS
  // -----------------------------------------

  const [price, setPrice] =
    useState("");

  const [quantity, setQuantity] =
    useState("1");

  const [notes, setNotes] =
    useState("");

  const [publishing, setPublishing] =
    useState(false);

  const [
    publishError,
    setPublishError,
  ] = useState("");

  const [
    publishSuccess,
    setPublishSuccess,
  ] = useState("");

  // -----------------------------------------
  // BACK TO TOP
  // -----------------------------------------

  useEffect(() => {
    function handleScroll() {
      setShowBackToTop(
        window.scrollY > 500
      );
    }

    handleScroll();

    window.addEventListener(
      "scroll",
      handleScroll,
      { passive: true }
    );

    return () => {
      window.removeEventListener(
        "scroll",
        handleScroll
      );
    };
  }, []);

  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  // -----------------------------------------
  // LOAD CURRENT VENDOR
  // -----------------------------------------

  useEffect(() => {
    async function loadVendor() {
      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      if (!session) {
        router.replace(
          "/vendor/login"
        );
        return;
      }

      const {
        data,
        error,
      } = await supabase
        .from("vendor_members")
        .select("vendor_id")
        .eq(
          "user_id",
          session.user.id
        )
        .maybeSingle();

      if (error) {
        console.error(
          "Vendor membership error:",
          error
        );
      }

      if (!data) {
        setPublishError(
          "This account is not connected to a vendor."
        );
      } else {
        setMembership(data);
      }

      setCheckingAuth(false);
    }

    loadVendor();
  }, [router]);

  // -----------------------------------------
  // LIVE CATALOG SEARCH
  // -----------------------------------------

  useEffect(() => {
    const query =
      searchTerm.trim();

    const liveCatalog =
      catalogType === "Pokemon" ||
      catalogType === "Magic: The Gathering" ||
      catalogType === "Yu-Gi-Oh!" ||
      catalogType === "Lorcana" ||
      catalogType === "One Piece" ||
      catalogType === "Sports";

    if (
      !liveCatalog ||
      listingType === "sealed" ||
      query.length < 2
    ) {
      setResults([]);
      setSelectedCard(null);
      setPage(1);
      setHasMore(false);
      setSearching(false);
      setSearchError("");
      return;
    }

    const controller =
      new AbortController();

    const timer = setTimeout(
      async () => {
        try {
          setSearching(true);
          setSearchError("");
          setPage(1);

          const endpoint =
            catalogType === "Magic: The Gathering"
              ? "/api/catalog/mtg"
              : catalogType === "Yu-Gi-Oh!"
              ? "/api/catalog/yugioh"
              : catalogType === "Lorcana"
              ? "/api/catalog/lorcana"
              : catalogType === "One Piece"
              ? "/api/catalog/onepiece"
              : catalogType === "Sports"
              ? "/api/catalog/sports"
              : "/api/catalog/search";

          const response =
            await fetch(
              `${endpoint}?q=${encodeURIComponent(
                query
              )}&page=1`,
              {
                signal:
                  controller.signal,
              }
            );

          const data =
            await response.json();

          if (!response.ok) {
            throw new Error(
              data?.error ||
                "Catalog search failed."
            );
          }

          setResults(
            data.results || []
          );

          setHasMore(
            Boolean(data.hasMore)
          );
        } catch (
          error: unknown
        ) {
          if (
            error instanceof Error &&
            error.name ===
              "AbortError"
          ) {
            return;
          }

          console.error(
            "Catalog search error:",
            error
          );

          setResults([]);

          setSearchError(
            error instanceof Error
              ? error.message
              : "Something went wrong while searching."
          );
        } finally {
          if (
            !controller.signal
              .aborted
          ) {
            setSearching(false);
          }
        }
      },
      450
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    searchTerm,
    listingType,
    catalogType,
  ]);

  // -----------------------------------------
  // LOAD MORE LIVE CATALOG RESULTS
  // -----------------------------------------

  async function loadMore() {
    const query =
      searchTerm.trim();

    const liveCatalog =
      catalogType === "Pokemon" ||
      catalogType === "Magic: The Gathering" ||
      catalogType === "Yu-Gi-Oh!" ||
      catalogType === "Lorcana" ||
      catalogType === "One Piece" ||
      catalogType === "Sports";

    if (
      !liveCatalog ||
      !query ||
      loadingMore ||
      !hasMore
    ) {
      return;
    }

    const nextPage =
      page + 1;

    try {
      setLoadingMore(true);

      const endpoint =
        catalogType === "Magic: The Gathering"
          ? "/api/catalog/mtg"
          : catalogType === "Yu-Gi-Oh!"
          ? "/api/catalog/yugioh"
          : catalogType === "Lorcana"
          ? "/api/catalog/lorcana"
          : catalogType === "One Piece"
          ? "/api/catalog/onepiece"
          : catalogType === "Sports"
          ? "/api/catalog/sports"
          : "/api/catalog/search";

      const response =
        await fetch(
          `${endpoint}?q=${encodeURIComponent(
            query
          )}&page=${nextPage}`
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Could not load more cards."
        );
      }

      setResults(
        (current) => {
          const existingIds =
            new Set(
              current.map(
                (card) =>
                  card.external_id
              )
            );

          const newCards =
            (
              data.results || []
            ).filter(
              (
                card: CatalogCard
              ) =>
                !existingIds.has(
                  card.external_id
                )
            );

          return [
            ...current,
            ...newCards,
          ];
        }
      );

      setPage(nextPage);

      setHasMore(
        Boolean(data.hasMore)
      );
    } catch (
      error: unknown
    ) {
      console.error(
        "Load more error:",
        error
      );
    } finally {
      setLoadingMore(false);
    }
  }

  // -----------------------------------------
  // LISTING TYPE
  // -----------------------------------------

  function chooseListingType(
    type: ListingType
  ) {
    setListingType(type);

    setCatalogType("Pokemon");

    resetSearch();
    resetManualForm();
    resetListingForm();
  }

  // -----------------------------------------
  // CATALOG TYPE
  // -----------------------------------------

  function chooseCatalog(
    catalog: CatalogType
  ) {
    setCatalogType(catalog);

    resetSearch();
    resetManualForm();
    resetListingForm();
  }

  // -----------------------------------------
  // RESET SEARCH
  // -----------------------------------------

  function resetSearch() {
    setSearchTerm("");
    setResults([]);
    setSelectedCard(null);

    setPage(1);
    setHasMore(false);

    setSearching(false);
    setSearchError("");
  }

  // -----------------------------------------
  // SELECT POKEMON CARD
  // -----------------------------------------

  function selectCard(
    card: CatalogCard
  ) {
    setSelectedCard(card);

    setEdition(
      card.edition || ""
    );

    setFinish(
      card.category === "Sports"
        ? card.parallel_name ||
            card.finish ||
            ""
        : card.finish || ""
    );

    setPublishError("");
    setPublishSuccess("");

    scrollToSelected();
  }

  // -----------------------------------------
  // CREATE MANUAL COLLECTIBLE
  // -----------------------------------------

  function prepareManualCollectible() {
    setManualError("");
    setPublishError("");
    setPublishSuccess("");

    const cleanName =
      manualName.trim();

    const cleanSet =
      manualSetName.trim();

    const cleanNumber =
      manualCardNumber.trim();

    if (!cleanName) {
      setManualError(
        "Enter the collectible name."
      );
      return;
    }

    const externalId =
      createManualExternalId(
        catalogType,
        cleanName,
        cleanSet,
        cleanNumber
      );

    const manualCard: CatalogCard = {
      external_id:
        externalId,

      data_source:
        "manual",

      name:
        cleanName,

      set_name:
        cleanSet || null,

      card_number:
        cleanNumber || null,

      image_url:
        manualImageUrl.trim() ||
        null,

      category:
        catalogType,

      rarity:
        manualRarity.trim() ||
        null,

      edition:
        null,

      finish:
        null,
    };

    setSelectedCard(
      manualCard
    );

    setEdition("");
    setFinish("");

    scrollToSelected();
  }

  // -----------------------------------------
  // MANUAL ID
  // -----------------------------------------

  function createManualExternalId(
    category: string,
    name: string,
    setName: string,
    cardNumber: string
  ) {
    const raw =
      `${category}-${setName}-${name}-${cardNumber}`;

    const slug =
      raw
        .toLowerCase()
        .trim()
        .replace(
          /[^a-z0-9]+/g,
          "-"
        )
        .replace(
          /^-+|-+$/g,
          ""
        );

    return `manual-${slug}`;
  }

  // -----------------------------------------
  // SCROLL
  // -----------------------------------------

  function scrollToSelected() {
    setTimeout(() => {
      document
        .getElementById(
          "selected-card"
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 50);
  }

  // -----------------------------------------
  // RESET MANUAL
  // -----------------------------------------

  function resetManualForm() {
    setManualName("");
    setManualSetName("");
    setManualCardNumber("");
    setManualRarity("");
    setManualImageUrl("");
    setManualError("");
  }

  // -----------------------------------------
  // RESET LISTING
  // -----------------------------------------

  function resetListingForm() {
    setCondition("NM");
    setEdition("");
    setFinish("");

    setGradingCompany("PSA");
    setGrade("10");
    setCertNumber("");

    setPrice("");
    setQuantity("1");
    setNotes("");

    setPublishError("");
    setPublishSuccess("");
  }

  // -----------------------------------------
  // GET / CREATE CATALOG ITEM
  // -----------------------------------------

  async function getOrCreateCard() {
    if (!selectedCard) {
      throw new Error(
        "No collectible selected."
      );
    }

    const {
      data: existingCard,
      error:
        existingCardError,
    } = await supabase
      .from("cards")
      .select("id")
      .eq(
        "external_id",
        selectedCard.external_id
      )
      .eq(
        "data_source",
        selectedCard.data_source
      )
      .maybeSingle();

    if (existingCardError) {
      throw existingCardError;
    }

    if (existingCard?.id) {
      return existingCard.id;
    }

    const {
      data: newCard,
      error: newCardError,
    } = await supabase
      .from("cards")
      .insert({
        name:
          selectedCard.name ||
          "Unknown Collectible",

        set_name:
          selectedCard.set_name ||
          null,

        card_number:
          selectedCard.card_number ||
          null,

        image_url:
          selectedCard.image_url ||
          null,

        category:
          selectedCard.category ||
          "Other",

        rarity:
          selectedCard.rarity ||
          null,

        edition:
          edition ||
          selectedCard.edition ||
          null,

        finish:
          finish ||
          selectedCard.finish ||
          null,

        year:
          selectedCard.year ||
          null,

        manufacturer:
          selectedCard.manufacturer ||
          null,

        release_name:
          selectedCard.release_name ||
          null,

        parallel_name:
          selectedCard.parallel_name ||
          null,

        sport:
          selectedCard.sport ||
          null,

        print_run:
          selectedCard.print_run ??
          null,

        rookie:
          selectedCard.rookie ??
          false,

        external_id:
          selectedCard.external_id,

        data_source:
          selectedCard.data_source,

        external_updated_at:
          new Date().toISOString(),
      })
      .select("id")
      .single();

    if (newCardError) {
      throw newCardError;
    }

    return newCard.id;
  }

  // -----------------------------------------
  // VALIDATE
  // -----------------------------------------

  function validateListing() {
    if (!selectedCard) {
      setPublishError(
        "Select or create a collectible first."
      );
      return null;
    }

    if (
      !membership?.vendor_id
    ) {
      setPublishError(
        "Vendor account could not be verified."
      );
      return null;
    }

    const numericPrice =
      Number(price);

    const numericQuantity =
      Number(quantity);

    if (
      !Number.isFinite(
        numericPrice
      ) ||
      numericPrice <= 0
    ) {
      setPublishError(
        "Enter a valid price."
      );
      return null;
    }

    if (
      !Number.isInteger(
        numericQuantity
      ) ||
      numericQuantity < 1
    ) {
      setPublishError(
        "Quantity must be at least 1."
      );
      return null;
    }

    return {
      numericPrice,
      numericQuantity,
    };
  }

  // -----------------------------------------
  // PUBLISH RAW
  // -----------------------------------------

  async function publishRawListing() {
    const validation =
      validateListing();

    if (!validation) {
      return;
    }

    setPublishing(true);
    setPublishError("");
    setPublishSuccess("");

    try {
      const cardId =
        await getOrCreateCard();

      const {
        error:
          inventoryError,
      } = await supabase
        .from("inventory")
        .insert({
          vendor_id:
            membership!.vendor_id,

          card_id:
            cardId,

          listing_type:
            "raw",

          condition,

          grading_company:
            null,

          grade:
            null,

          cert_number:
            null,

          price:
            validation.numericPrice,

          quantity:
            validation.numericQuantity,

          notes:
            notes.trim() ||
            null,
        });

      if (inventoryError) {
        throw inventoryError;
      }

      setPublishSuccess(
        `${selectedCard?.name || "Collectible"} is now live in MintRadar.`
      );

      setPrice("");
      setQuantity("1");
      setNotes("");
    } catch (error: any) {
      handlePublishError(
        error
      );
    } finally {
      setPublishing(false);
    }
  }

  // -----------------------------------------
  // PUBLISH GRADED
  // -----------------------------------------

  async function publishGradedListing() {
    const validation =
      validateListing();

    if (!validation) {
      return;
    }

    if (!gradingCompany) {
      setPublishError(
        "Choose a grading company."
      );
      return;
    }

    if (!grade) {
      setPublishError(
        "Choose a grade."
      );
      return;
    }

    setPublishing(true);
    setPublishError("");
    setPublishSuccess("");

    try {
      const cardId =
        await getOrCreateCard();

      const {
        error:
          inventoryError,
      } = await supabase
        .from("inventory")
        .insert({
          vendor_id:
            membership!.vendor_id,

          card_id:
            cardId,

          listing_type:
            "graded",

          condition:
            null,

          grading_company:
            gradingCompany,

          grade,

          cert_number:
            certNumber.trim() ||
            null,

          price:
            validation.numericPrice,

          quantity:
            validation.numericQuantity,

          notes:
            notes.trim() ||
            null,
        });

      if (inventoryError) {
        throw inventoryError;
      }

      setPublishSuccess(
        `${gradingCompany} ${grade} ${selectedCard?.name || "collectible"} is now live in MintRadar.`
      );

      setPrice("");
      setQuantity("1");
      setCertNumber("");
      setNotes("");
    } catch (error: any) {
      handlePublishError(
        error
      );
    } finally {
      setPublishing(false);
    }
  }

  // -----------------------------------------
  // ERROR HANDLER
  // -----------------------------------------

  function handlePublishError(
    error: any
  ) {
    console.error(
      "Publish listing error:",
      {
        message:
          error?.message,
        details:
          error?.details,
        hint:
          error?.hint,
        code:
          error?.code,
      }
    );

    setPublishError(
      error?.message ||
        "MintRadar could not publish this listing."
    );
  }

  // -----------------------------------------
  // AUTH LOADING
  // -----------------------------------------

  if (checkingAuth) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-zinc-500">
          Loading vendor account...
        </p>
      </main>
    );
  }

  const usesLiveCatalog =
    catalogType === "Pokemon" ||
    catalogType === "Magic: The Gathering" ||
    catalogType === "Yu-Gi-Oh!" ||
    catalogType === "Lorcana" ||
    catalogType === "One Piece" ||
    catalogType === "Sports";

  const liveCatalogName =
    catalogType === "Magic: The Gathering"
      ? "Magic: The Gathering"
      : catalogType === "Yu-Gi-Oh!"
      ? "Yu-Gi-Oh!"
      : catalogType === "Lorcana"
      ? "Lorcana"
      : catalogType === "One Piece"
      ? "One Piece"
      : catalogType === "Sports"
      ? "Sports"
      : "Pokémon";

  const liveCatalogPlaceholder =
    catalogType === "Magic: The Gathering"
      ? "Search Black Lotus, Sol Ring, Lightning Bolt..."
      : catalogType === "Yu-Gi-Oh!"
      ? "Search Blue-Eyes, Dark Magician, Exodia..."
      : catalogType === "Lorcana"
      ? "Search Elsa, Mickey Mouse, Stitch..."
      : catalogType === "One Piece"
      ? "Search Luffy, Zoro, Nami, OP15-098..."
      : catalogType === "Sports"
      ? "Search Wembanyama, 2023 Prizm #136 Silver..."
      : "Search Umbreon, Charizard, Pikachu...";

  return (
    <main className="min-h-screen bg-black text-white px-5 py-8">

      <div className="max-w-6xl mx-auto">

        {/* HEADER */}

        <header className="mb-8">

          <Link
            href="/vendor"
            className="text-sm text-zinc-500 hover:text-emerald-400 transition"
          >
            ← Back to Dashboard
          </Link>

          <p className="text-emerald-400 text-xs uppercase tracking-[0.25em] font-bold mt-6 mb-2">
            MintRadar Vendor Portal
          </p>

          <h1 className="text-4xl sm:text-5xl font-black">
            Add Inventory
          </h1>

          <p className="text-zinc-500 mt-3 max-w-2xl">
            Choose the type of listing,
            select its catalog and add
            the exact collectible to your
            MintRadar inventory.
          </p>

        </header>

        {/* LISTING TYPE */}

        <section className="mb-7">

          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold mb-3">
            What are you listing?
          </p>

          <div className="grid sm:grid-cols-3 gap-3">

            <ListingTypeButton
              active={
                listingType ===
                "raw"
              }
              eyebrow="Single"
              title="Raw Card"
              description="Ungraded individual card"
              onClick={() =>
                chooseListingType(
                  "raw"
                )
              }
            />

            <ListingTypeButton
              active={
                listingType ===
                "graded"
              }
              eyebrow="Slab"
              title="Graded Card"
              description="PSA, CGC, BGS and more"
              onClick={() =>
                chooseListingType(
                  "graded"
                )
              }
            />

            <ListingTypeButton
              active={
                listingType ===
                "sealed"
              }
              eyebrow="Product"
              title="Sealed Product"
              description="ETBs, boxes, tins and more"
              onClick={() =>
                chooseListingType(
                  "sealed"
                )
              }
            />

          </div>

        </section>

        {/* SEALED PLACEHOLDER */}

        {listingType ===
          "sealed" && (
          <section className="bg-zinc-950 border border-zinc-900 rounded-3xl p-8 text-center">

            <p className="text-emerald-400 text-xs uppercase tracking-[0.2em] font-bold">
              Sealed Catalog
            </p>

            <h2 className="text-3xl font-black mt-3">
              Coming Next
            </h2>

            <p className="text-zinc-500 mt-3 max-w-xl mx-auto">
              Sealed products will use
              their own product catalog
              so boxes, tins, ETBs and
              collection products remain
              separate from individual
              cards.
            </p>

          </section>
        )}

        {/* CATALOG SELECTOR */}

        {listingType !==
          "sealed" && (
          <section className="mb-7">

            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold mb-3">
              Choose a Catalog
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">

              {CATALOGS.map(
                (catalog) => (
                  <button
                    key={
                      catalog.value
                    }
                    type="button"
                    onClick={() =>
                      chooseCatalog(
                        catalog.value
                      )
                    }
                    className={`rounded-2xl border p-4 sm:p-5 text-left transition ${
                      catalogType ===
                      catalog.value
                        ? "border-emerald-400 bg-emerald-400/10"
                        : "bg-zinc-950 border-zinc-900 hover:border-zinc-700"
                    }`}
                  >

                    <p
                      className={`text-lg font-black ${
                        catalogType ===
                        catalog.value
                          ? "text-emerald-400"
                          : "text-white"
                      }`}
                    >
                      {
                        catalog.shortLabel
                      }
                    </p>

                    <p className="text-zinc-500 text-xs sm:text-sm mt-2 leading-relaxed">
                      {
                        catalog.description
                      }
                    </p>

                    {(catalog.value ===
                      "Pokemon" ||
                      catalog.value ===
                        "Magic: The Gathering" ||
                      catalog.value ===
                        "Yu-Gi-Oh!" ||
                      catalog.value ===
                        "Lorcana" ||
                      catalog.value ===
                        "One Piece" ||
                      catalog.value ===
                        "Sports") && (
                      <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-400 font-bold mt-3">
                        Live Catalog
                      </p>
                    )}

                    {catalog.value !==
                      "Pokemon" &&
                      catalog.value !==
                        "Magic: The Gathering" &&
                      catalog.value !==
                        "Yu-Gi-Oh!" &&
                      catalog.value !==
                        "Lorcana" &&
                      catalog.value !==
                        "One Piece" &&
                      catalog.value !==
                        "Sports" && (
                      <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600 font-bold mt-3">
                        Manual Prototype
                      </p>
                    )}

                  </button>
                )
              )}

            </div>

          </section>
        )}

        {/* ACTIVE CATALOG HEADER */}

        {listingType !==
          "sealed" && (
          <section className="mb-5">

            <div className="flex flex-wrap items-center gap-3">

              <span className="bg-emerald-400 text-black text-xs uppercase tracking-[0.15em] font-black px-3 py-2 rounded-lg">
                {getCatalogLabel(
                  catalogType
                )}
              </span>

              <span className="text-zinc-600 text-sm">
                {usesLiveCatalog
                  ? "Connected catalog search"
                  : "Manual catalog entry for prototype"}
              </span>

            </div>

          </section>
        )}

        {/* LIVE CATALOG SEARCH */}

        {listingType !==
          "sealed" &&
          usesLiveCatalog && (
          <section className="bg-zinc-950 border border-zinc-900 rounded-3xl p-5 sm:p-7">

            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold mb-2">
              Step 1
            </p>

            <h2 className="text-2xl font-black">
              Search {liveCatalogName}
            </h2>

            <p className="text-zinc-500 text-sm mt-2">
              Search the connected
              catalog and select the
              exact printing.
            </p>

            <input
              type="search"
              value={
                searchTerm
              }
              onChange={(
                event
              ) => {
                setSearchTerm(
                  event.target
                    .value
                );

                setSelectedCard(
                  null
                );
              }}
              placeholder={liveCatalogPlaceholder}
              className="w-full mt-6 bg-black border border-zinc-800 rounded-2xl px-5 py-4 text-lg outline-none focus:border-emerald-400 transition"
            />

            {searching && (
              <p className="text-emerald-400 mt-5">
                Searching...
              </p>
            )}

            {searchError && (
              <p className="text-red-400 mt-5">
                {searchError}
              </p>
            )}

            {!searching &&
              searchTerm.trim().length >=
                2 &&
              !searchError &&
              results.length ===
                0 && (
                <p className="text-zinc-600 mt-5">
                  No matching cards found.
                </p>
              )}

            {!searching &&
              results.length >
                0 && (
                <div className="mt-7">

                  <p className="text-zinc-500 mb-4">
                    Showing{" "}
                    {
                      results.length
                    }{" "}
                    results
                  </p>

                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">

                    {results.map(
                      (
                        card
                      ) => (
                        <button
                          key={
                            card.external_id
                          }
                          type="button"
                          onClick={() =>
                            selectCard(
                              card
                            )
                          }
                          className="text-left rounded-2xl border border-zinc-900 bg-black hover:border-emerald-400 p-4 transition"
                        >

                          <div className="aspect-[3/4] bg-zinc-950 rounded-xl overflow-hidden">

                            {card.image_url ? (
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
                              <div className="w-full h-full flex items-center justify-center text-zinc-700">
                                No Image
                              </div>
                            )}

                          </div>

                          <h3 className="text-lg font-black mt-4">
                            {
                              card.name
                            }
                          </h3>

                          <p className="text-zinc-500 text-sm mt-1">
                            {
                              card.set_name
                            }

                            {card.card_number
                              ? ` #${card.card_number}`
                              : ""}
                          </p>

                          <div className="flex flex-wrap gap-2 mt-3">

                            {card.rarity && (
                              <span className="text-xs bg-zinc-950 border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
                                {
                                  card.rarity
                                }
                              </span>
                            )}

                            {card.edition && (
                              <span className="text-xs bg-zinc-950 border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
                                {
                                  card.edition
                                }
                              </span>
                            )}

                            {card.finish && (
                              <span className="text-xs bg-zinc-950 border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
                                {
                                  card.finish
                                }
                              </span>
                            )}

                            {card.year && (
                              <span className="text-xs bg-zinc-950 border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
                                {card.year}
                              </span>
                            )}

                            {card.release_name && (
                              <span className="text-xs bg-zinc-950 border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
                                {card.release_name}
                              </span>
                            )}

                            {card.parallel_name && (
                              <span className="text-xs bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-2 py-1 text-emerald-400">
                                {card.parallel_name}
                              </span>
                            )}

                            {card.sport && (
                              <span className="text-xs bg-zinc-950 border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
                                {card.sport}
                              </span>
                            )}

                            {card.print_run && (
                              <span className="text-xs bg-zinc-950 border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
                                /{card.print_run}
                              </span>
                            )}

                          </div>

                        </button>
                      )
                    )}

                  </div>

                  {hasMore && (
                    <div className="text-center mt-6">

                      <button
                        type="button"
                        onClick={
                          loadMore
                        }
                        disabled={
                          loadingMore
                        }
                        className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-6 py-3 rounded-xl font-black transition disabled:opacity-50"
                      >
                        {loadingMore
                          ? "Loading..."
                          : "Load 20 More"}
                      </button>

                    </div>
                  )}

                </div>
              )}

          </section>
        )}

        {/* MANUAL CATALOG */}

        {listingType !==
          "sealed" &&
          !usesLiveCatalog && (
          <section className="bg-zinc-950 border border-zinc-900 rounded-3xl p-5 sm:p-7">

            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold">
              Step 1 · {getCatalogLabel(
                catalogType
              )}
            </p>

            <h2 className="text-2xl font-black mt-2">
              Add a{" "}
              {getCatalogLabel(
                catalogType
              )}{" "}
              Collectible
            </h2>

            <p className="text-zinc-500 text-sm mt-2 max-w-2xl">
              This catalog is using
              manual entry during the
              prototype. The collectible
              will still be saved to the
              MintRadar catalog and can
              appear in customer search.
            </p>

            <div className="grid sm:grid-cols-2 gap-5 mt-6">

              {/* NAME */}

              <div>

                <label className="block text-sm font-bold mb-2">
                  {getNameLabel(
                    catalogType
                  )}
                </label>

                <input
                  type="text"
                  value={
                    manualName
                  }
                  onChange={(
                    event
                  ) => {
                    setManualName(
                      event.target
                        .value
                    );

                    setSelectedCard(
                      null
                    );
                  }}
                  placeholder={getNamePlaceholder(
                    catalogType
                  )}
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
                />

              </div>

              {/* SET */}

              <div>

                <label className="block text-sm font-bold mb-2">
                  Set / Product Line
                </label>

                <input
                  type="text"
                  value={
                    manualSetName
                  }
                  onChange={(
                    event
                  ) => {
                    setManualSetName(
                      event.target
                        .value
                    );

                    setSelectedCard(
                      null
                    );
                  }}
                  placeholder={getSetPlaceholder(
                    catalogType
                  )}
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
                />

              </div>

              {/* NUMBER */}

              <div>

                <label className="block text-sm font-bold mb-2">
                  Card Number
                </label>

                <input
                  type="text"
                  value={
                    manualCardNumber
                  }
                  onChange={(
                    event
                  ) => {
                    setManualCardNumber(
                      event.target
                        .value
                    );

                    setSelectedCard(
                      null
                    );
                  }}
                  placeholder="136"
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
                />

              </div>

              {/* RARITY / VARIANT */}

              <div>

                <label className="block text-sm font-bold mb-2">
                  Rarity / Variant
                </label>

                <input
                  type="text"
                  value={
                    manualRarity
                  }
                  onChange={(
                    event
                  ) => {
                    setManualRarity(
                      event.target
                        .value
                    );

                    setSelectedCard(
                      null
                    );
                  }}
                  placeholder={getVariantPlaceholder(
                    catalogType
                  )}
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
                />

              </div>

              {/* IMAGE */}

              <div className="sm:col-span-2">

                <label className="block text-sm font-bold mb-2">
                  Image URL
                </label>

                <input
                  type="url"
                  value={
                    manualImageUrl
                  }
                  onChange={(
                    event
                  ) => {
                    setManualImageUrl(
                      event.target
                        .value
                    );

                    setSelectedCard(
                      null
                    );
                  }}
                  placeholder="https://..."
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
                />

                <p className="text-xs text-zinc-600 mt-2">
                  Optional for testing.
                  Paste a direct image URL
                  if you want artwork to
                  display in the
                  prototype.
                </p>

              </div>

            </div>

            {manualError && (
              <div className="mt-5 bg-red-400/10 border border-red-400/30 text-red-300 rounded-xl p-4">
                {manualError}
              </div>
            )}

            <button
              type="button"
              onClick={
                prepareManualCollectible
              }
              className="w-full mt-6 bg-white hover:bg-zinc-200 text-black font-black rounded-xl px-5 py-4 transition"
            >
              Continue With This{" "}
              {getCatalogLabel(
                catalogType
              )}{" "}
              Card
            </button>

          </section>
        )}

        {/* RAW FORM */}

        {selectedCard &&
          listingType ===
            "raw" && (
          <section
            id="selected-card"
            className="mt-6 bg-zinc-950 border border-emerald-400/30 rounded-3xl p-5 sm:p-7"
          >

            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold">
              Step 2 · Raw Listing
            </p>

            <SelectedCardHeader
              card={
                selectedCard
              }
            />

            <div className="grid sm:grid-cols-2 gap-5 mt-7">

              {/* CONDITION */}

              <div>

                <label className="block text-sm font-bold mb-2">
                  Condition
                </label>

                <select
                  value={
                    condition
                  }
                  onChange={(
                    event
                  ) =>
                    setCondition(
                      event.target
                        .value
                    )
                  }
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
                >
                  <option value="NM">
                    Near Mint
                  </option>

                  <option value="LP">
                    Lightly Played
                  </option>

                  <option value="MP">
                    Moderately Played
                  </option>

                  <option value="HP">
                    Heavily Played
                  </option>

                  <option value="DMG">
                    Damaged
                  </option>
                </select>

              </div>

              {/* EDITION */}

              {catalogType !== "Sports" &&
                catalogType !== "One Piece" &&
                catalogType !== "Lorcana" && (
                <div>

                  <label className="block text-sm font-bold mb-2">
                    Edition
                  </label>

                  <select
                    value={
                      edition
                    }
                    onChange={(
                      event
                    ) =>
                      setEdition(
                        event.target
                          .value
                      )
                    }
                    className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
                  >
                    <option value="">
                      Not Applicable
                    </option>

                    <option value="Unlimited">
                      Unlimited
                    </option>

                    <option value="1st Edition">
                      1st Edition
                    </option>

                    <option value="Shadowless">
                      Shadowless
                    </option>

                    <option value="1st Edition / Shadowless">
                      1st Edition /
                      Shadowless
                    </option>
                  </select>

                </div>
              )}

              {/* FINISH / PARALLEL */}

              <div>

                <label className="block text-sm font-bold mb-2">
                  {catalogType === "Sports"
                    ? "Parallel / Refractor"
                    : "Finish / Parallel"}
                </label>

                <select
                  value={finish}
                  onChange={(event) =>
                    setFinish(
                      event.target.value
                    )
                  }
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
                >
                  {catalogType === "Sports" ? (
                    <>
                      <option value="">
                        Base / Standard
                      </option>

                      {selectedCard?.parallel_name &&
                        !SPORTS_PARALLELS.some(
                          (parallel) =>
                            parallel ===
                            selectedCard.parallel_name
                        ) && (
                          <option
                            value={
                              selectedCard.parallel_name
                            }
                          >
                            {
                              selectedCard.parallel_name
                            }
                          </option>
                        )}

                      {SPORTS_PARALLELS.map(
                        (parallel) => (
                          <option
                            key={parallel}
                            value={parallel}
                          >
                            {parallel}
                          </option>
                        )
                      )}
                    </>
                  ) : (
                    <>
                      <option value="">
                        Standard / Unknown
                      </option>

                      <option value="Non-Holo">
                        Non-Holo
                      </option>

                      <option value="Holo">
                        Holo
                      </option>

                      <option value="Reverse Holo">
                        Reverse Holo
                      </option>

                      <option value="Foil">
                        Foil
                      </option>
                    </>
                  )}
                </select>

                {catalogType === "Sports" &&
                  selectedCard?.parallel_name && (
                    <p className="text-xs text-emerald-400 mt-2">
                      Catalog parallel:{" "}
                      {
                        selectedCard.parallel_name
                      }
                    </p>
                  )}

              </div>

              <PriceInput
                price={
                  price
                }
                setPrice={
                  setPrice
                }
              />

              <QuantityInput
                quantity={
                  quantity
                }
                setQuantity={
                  setQuantity
                }
              />

              <NotesInput
                notes={
                  notes
                }
                setNotes={
                  setNotes
                }
              />

            </div>

            <PublishMessages
              error={
                publishError
              }
              success={
                publishSuccess
              }
            />

            <button
              type="button"
              onClick={
                publishRawListing
              }
              disabled={
                publishing
              }
              className="w-full mt-6 bg-emerald-400 hover:bg-emerald-300 disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-black rounded-xl px-5 py-4 transition"
            >
              {publishing
                ? "Publishing..."
                : "Publish Raw Listing"}
            </button>

          </section>
        )}

        {/* GRADED FORM */}

        {selectedCard &&
          listingType ===
            "graded" && (
          <section
            id="selected-card"
            className="mt-6 bg-zinc-950 border border-emerald-400/30 rounded-3xl p-5 sm:p-7"
          >

            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold">
              Step 2 · Graded Listing
            </p>

            <SelectedCardHeader
              card={
                selectedCard
              }
            />

            <div className="mt-7 bg-black border border-zinc-900 rounded-2xl p-5">

              <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 font-bold">
                Slab Details
              </p>

              <div className="grid sm:grid-cols-2 gap-5 mt-5">

                {/* COMPANY */}

                <div>

                  <label className="block text-sm font-bold mb-2">
                    Grading Company
                  </label>

                  <select
                    value={
                      gradingCompany
                    }
                    onChange={(
                      event
                    ) =>
                      setGradingCompany(
                        event.target
                          .value
                      )
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3"
                  >
                    <option value="PSA">
                      PSA
                    </option>

                    <option value="CGC">
                      CGC
                    </option>

                    <option value="BGS">
                      Beckett / BGS
                    </option>

                    <option value="SGC">
                      SGC
                    </option>

                    <option value="TAG">
                      TAG
                    </option>

                    <option value="ACE">
                      ACE
                    </option>

                    <option value="Other">
                      Other
                    </option>
                  </select>

                </div>

                {/* GRADE */}

                <div>

                  <label className="block text-sm font-bold mb-2">
                    Grade
                  </label>

                  <select
                    value={
                      grade
                    }
                    onChange={(
                      event
                    ) =>
                      setGrade(
                        event.target
                          .value
                      )
                    }
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3"
                  >
                    {[
                      "10",
                      "9.5",
                      "9",
                      "8.5",
                      "8",
                      "7.5",
                      "7",
                      "6.5",
                      "6",
                      "5.5",
                      "5",
                      "4.5",
                      "4",
                      "3.5",
                      "3",
                      "2.5",
                      "2",
                      "1.5",
                      "1",
                    ].map(
                      (
                        gradeOption
                      ) => (
                        <option
                          key={
                            gradeOption
                          }
                          value={
                            gradeOption
                          }
                        >
                          {
                            gradeOption
                          }
                        </option>
                      )
                    )}
                  </select>

                </div>

                {/* CERT */}

                <div className="sm:col-span-2">

                  <label className="block text-sm font-bold mb-2">
                    Certification Number
                  </label>

                  <input
                    type="text"
                    value={
                      certNumber
                    }
                    onChange={(
                      event
                    ) =>
                      setCertNumber(
                        event.target
                          .value
                      )
                    }
                    placeholder="Optional cert number"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3"
                  />

                </div>

              </div>

            </div>

            <div className="grid sm:grid-cols-2 gap-5 mt-5">

              <PriceInput
                price={
                  price
                }
                setPrice={
                  setPrice
                }
              />

              <QuantityInput
                quantity={
                  quantity
                }
                setQuantity={
                  setQuantity
                }
              />

              <NotesInput
                notes={
                  notes
                }
                setNotes={
                  setNotes
                }
              />

            </div>

            {/* PREVIEW */}

            <div className="mt-6 bg-black border border-zinc-900 rounded-2xl p-5">

              <p className="text-xs uppercase tracking-[0.2em] text-zinc-600 font-bold">
                Listing Preview
              </p>

              <div className="flex flex-wrap items-center gap-2 mt-3">

                <span className="text-xs uppercase tracking-wider bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 rounded-lg px-2 py-1">
                  {
                    selectedCard.category
                  }
                </span>

                <span className="text-xs uppercase tracking-wider bg-zinc-900 text-zinc-500 rounded-lg px-2 py-1">
                  {
                    gradingCompany
                  }{" "}
                  {
                    grade
                  }
                </span>

              </div>

              <p className="text-2xl font-black mt-3">
                {
                  selectedCard.name
                }
              </p>

              <p className="text-zinc-500 mt-1">
                {
                  selectedCard.set_name
                }

                {selectedCard.card_number
                  ? ` #${selectedCard.card_number}`
                  : ""}
              </p>

              {price && (
                <p className="text-emerald-400 font-black text-2xl mt-4">
                  $
                  {Number(
                    price || 0
                  ).toFixed(2)}
                </p>
              )}

            </div>

            <PublishMessages
              error={
                publishError
              }
              success={
                publishSuccess
              }
            />

            <button
              type="button"
              onClick={
                publishGradedListing
              }
              disabled={
                publishing
              }
              className="w-full mt-6 bg-emerald-400 hover:bg-emerald-300 disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-black rounded-xl px-5 py-4 transition"
            >
              {publishing
                ? "Publishing..."
                : `Publish ${gradingCompany} ${grade} Listing`}
            </button>

          </section>
        )}

      </div>

      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-emerald-400/30 bg-zinc-950/95 px-4 py-3 text-sm font-black text-emerald-400 shadow-2xl backdrop-blur transition hover:border-emerald-400 hover:bg-emerald-400 hover:text-black sm:bottom-8 sm:right-8"
        >
          <span
            aria-hidden="true"
            className="text-lg leading-none"
          >
            ↑
          </span>
          <span className="hidden sm:inline">
            Back to Top
          </span>
        </button>
      )}

    </main>
  );
}

// =============================================
// HELPERS
// =============================================

function getCatalogLabel(
  catalog: CatalogType
) {
  if (
    catalog ===
    "Magic: The Gathering"
  ) {
    return "MTG";
  }

  return catalog;
}

function getNameLabel(
  catalog: CatalogType
) {
  if (
    catalog ===
    "Sports"
  ) {
    return "Player / Card Name";
  }

  if (
    catalog ===
    "Other"
  ) {
    return "Collectible Name";
  }

  return "Card Name";
}

function getNamePlaceholder(
  catalog: CatalogType
) {
  switch (catalog) {
    case "Sports":
      return "Victor Wembanyama";

    case "One Piece":
      return "Monkey D. Luffy";

    case "Magic: The Gathering":
      return "Black Lotus";

    case "Yu-Gi-Oh!":
      return "Blue-Eyes White Dragon";

    case "Lorcana":
      return "Elsa - Spirit of Winter";

    default:
      return "Collectible name";
  }
}

function getSetPlaceholder(
  catalog: CatalogType
) {
  switch (catalog) {
    case "Sports":
      return "2023-24 Panini Prizm";

    case "One Piece":
      return "Awakening of the New Era";

    case "Magic: The Gathering":
      return "Alpha";

    case "Yu-Gi-Oh!":
      return "Legend of Blue Eyes";

    case "Lorcana":
      return "The First Chapter";

    default:
      return "Set or product line";
  }
}

function getVariantPlaceholder(
  catalog: CatalogType
) {
  switch (catalog) {
    case "Sports":
      return "Rookie, Silver Prizm, Refractor...";

    case "One Piece":
      return "Alt Art, Manga Rare, Parallel...";

    case "Magic: The Gathering":
      return "Mythic, Foil, Showcase...";

    case "Yu-Gi-Oh!":
      return "Secret Rare, Ultimate Rare...";

    case "Lorcana":
      return "Enchanted, Legendary, Foil...";

    default:
      return "Variant, rarity or parallel";
  }
}

// =============================================
// UI COMPONENTS
// =============================================

function ListingTypeButton({
  active,
  eyebrow,
  title,
  description,
  onClick,
}: {
  active: boolean;
  eyebrow: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`rounded-2xl border p-5 text-left transition ${
        active
          ? "bg-emerald-400 text-black border-emerald-400"
          : "bg-zinc-950 border-zinc-900 hover:border-zinc-700"
      }`}
    >

      <p className="text-xs uppercase font-black opacity-60">
        {eyebrow}
      </p>

      <p className="text-xl font-black mt-1">
        {title}
      </p>

      <p className="text-sm mt-2 opacity-60">
        {description}
      </p>

    </button>
  );
}

function SelectedCardHeader({
  card,
}: {
  card: CatalogCard;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-5 mt-5">

      <div className="w-28 h-40 bg-black border border-zinc-900 rounded-xl overflow-hidden shrink-0">

        {card.image_url ? (
          <img
            src={
              card.image_url
            }
            alt={
              card.name ||
              "Collectible"
            }
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs text-center p-3">
            No Image
          </div>
        )}

      </div>

      <div>

        <div className="flex flex-wrap gap-2 mb-2">

          {card.category && (
            <span className="text-xs uppercase tracking-wider bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 rounded-lg px-2 py-1">
              {
                card.category
              }
            </span>
          )}

          {card.data_source ===
            "manual" && (
            <span className="text-xs uppercase tracking-wider bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-lg px-2 py-1">
              Manual Catalog
            </span>
          )}

        </div>

        <h2 className="text-3xl font-black">
          {card.name}
        </h2>

        <p className="text-zinc-500 mt-1">

          {card.set_name ||
            "No Set"}

          {card.card_number
            ? ` #${card.card_number}`
            : ""}

        </p>

        <div className="flex flex-wrap gap-2 mt-3">

          {card.rarity && (
            <span className="text-xs bg-black border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
              {
                card.rarity
              }
            </span>
          )}

          {card.edition && (
            <span className="text-xs bg-black border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
              {
                card.edition
              }
            </span>
          )}

          {card.finish && (
            <span className="text-xs bg-black border border-zinc-900 rounded-lg px-2 py-1 text-zinc-500">
              {
                card.finish
              }
            </span>
          )}

        </div>

      </div>

    </div>
  );
}

function PriceInput({
  price,
  setPrice,
}: {
  price: string;
  setPrice: (
    value: string
  ) => void;
}) {
  return (
    <div>

      <label className="block text-sm font-bold mb-2">
        Price
      </label>

      <input
        type="number"
        min="0"
        step="0.01"
        value={
          price
        }
        onChange={(
          event
        ) =>
          setPrice(
            event.target
              .value
          )
        }
        placeholder="149.99"
        className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
      />

    </div>
  );
}

function QuantityInput({
  quantity,
  setQuantity,
}: {
  quantity: string;
  setQuantity: (
    value: string
  ) => void;
}) {
  return (
    <div>

      <label className="block text-sm font-bold mb-2">
        Quantity
      </label>

      <input
        type="number"
        min="1"
        step="1"
        value={
          quantity
        }
        onChange={(
          event
        ) =>
          setQuantity(
            event.target
              .value
          )
        }
        className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3"
      />

    </div>
  );
}

function NotesInput({
  notes,
  setNotes,
}: {
  notes: string;
  setNotes: (
    value: string
  ) => void;
}) {
  return (
    <div className="sm:col-span-2">

      <label className="block text-sm font-bold mb-2">
        Notes
      </label>

      <textarea
        value={
          notes
        }
        onChange={(
          event
        ) =>
          setNotes(
            event.target
              .value
          )
        }
        placeholder="Optional seller notes..."
        rows={3}
        className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 resize-none"
      />

    </div>
  );
}

function PublishMessages({
  error,
  success,
}: {
  error: string;
  success: string;
}) {
  return (
    <>

      {error && (
        <div className="mt-5 bg-red-400/10 border border-red-400/30 text-red-300 rounded-xl p-4">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-5 bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 rounded-xl p-4">
          {success}
        </div>
      )}

    </>
  );
}