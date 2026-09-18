"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { getActiveVendorMembership } from "../../../lib/active-vendor";

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
  role?: string | null;
};

type ListingPhotoType =
  | "front"
  | "back"
  | "detail";

type PendingListingPhoto = {
  id: string;
  file: File;
  imageType: ListingPhotoType;
};

const MAX_DETAIL_PHOTOS = 4;
const MAX_LISTING_PHOTO_BYTES = 10 * 1024 * 1024;

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

type PokemonImageFallbackResponse = {
  ok?: boolean;
  imageUrl?: string | null;
};

const pokemonImageFallbackCache = new Map<string, string | null>();
const pokemonImageFallbackRequests = new Map<string, Promise<string | null>>();

function normalizeFallbackKeyPart(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function buildPokemonFallbackKey({
  name,
  setName,
  cardNumber,
}: {
  name?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
}) {
  return [
    normalizeFallbackKeyPart(name),
    normalizeFallbackKeyPart(setName),
    normalizeFallbackKeyPart(cardNumber),
  ].join("|");
}

async function requestPokemonFallbackImage({
  name,
  setName,
  cardNumber,
}: {
  name?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
}) {
  const key = buildPokemonFallbackKey({
    name,
    setName,
    cardNumber,
  });

  if (!name?.trim()) {
    return null;
  }

  if (pokemonImageFallbackCache.has(key)) {
    return pokemonImageFallbackCache.get(key) ?? null;
  }

  const existingRequest = pokemonImageFallbackRequests.get(key);

  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const params = new URLSearchParams({
        name: name.trim(),
      });

      if (setName?.trim()) {
        params.set("setName", setName.trim());
      }

      if (cardNumber?.trim()) {
        params.set("cardNumber", cardNumber.trim());
      }

      const response = await fetch(
        `/api/catalog/pokemon-image-fallback?${params.toString()}`,
        {
          method: "GET",
          cache: "no-store",
        }
      );

      if (!response.ok) {
        return null;
      }

      const payload =
        (await response.json()) as PokemonImageFallbackResponse;

      const imageUrl =
        payload.ok && payload.imageUrl
          ? payload.imageUrl
          : null;

      if (imageUrl) {
        pokemonImageFallbackCache.set(key, imageUrl);
      }

      return imageUrl;
    } catch (error) {
      console.error("Pokémon image fallback lookup failed:", error);
      return null;
    } finally {
      pokemonImageFallbackRequests.delete(key);
    }
  })();

  pokemonImageFallbackRequests.set(key, request);

  return request;
}

function CatalogCardImage({
  card,
  className,
}: {
  card: CatalogCard;
  className?: string;
}) {
  const [currentSrc, setCurrentSrc] =
    useState<string | null>(card.image_url || null);

  const [pokemonFallbackAttempted, setPokemonFallbackAttempted] =
    useState(false);

  const [sportsFallbackAttempted, setSportsFallbackAttempted] =
    useState(false);

  const [imageFailed, setImageFailed] =
    useState(false);

  const normalizedCategory =
    normalizeFallbackKeyPart(card.category);

  const isPokemon =
    normalizedCategory === "pokemon";

  const isSports =
    normalizedCategory === "sports";

  useEffect(() => {
    setCurrentSrc(card.image_url || null);
    setPokemonFallbackAttempted(false);
    setSportsFallbackAttempted(false);
    setImageFailed(false);
  }, [
    card.external_id,
    card.image_url,
    card.name,
    card.category,
    card.set_name,
    card.card_number,
  ]);

  async function tryPokemonFallback() {
    if (
      !isPokemon ||
      pokemonFallbackAttempted ||
      !card.name?.trim()
    ) {
      return false;
    }

    setPokemonFallbackAttempted(true);

    const fallbackImage =
      await requestPokemonFallbackImage({
        name: card.name,
        setName: card.set_name,
        cardNumber: card.card_number,
      });

    if (!fallbackImage) {
      return false;
    }

    setCurrentSrc(fallbackImage);
    setImageFailed(false);

    return true;
  }

  function trySportsFallback() {
    if (
      !isSports ||
      sportsFallbackAttempted ||
      !card.external_id?.trim()
    ) {
      return false;
    }

    setSportsFallbackAttempted(true);

    setCurrentSrc(
      `/api/catalog/sports-image?id=${encodeURIComponent(
        card.external_id.trim()
      )}`
    );

    setImageFailed(false);

    return true;
  }

  async function tryNextFallback() {
    if (isPokemon) {
      const foundPokemonImage =
        await tryPokemonFallback();

      if (foundPokemonImage) {
        return;
      }

      setImageFailed(true);
      return;
    }

    if (isSports) {
      const startedSportsFallback =
        trySportsFallback();

      if (startedSportsFallback) {
        return;
      }

      setImageFailed(true);
      return;
    }

    setImageFailed(true);
  }

  useEffect(() => {
    if (!currentSrc && !imageFailed) {
      void tryNextFallback();
    }
  }, [
    currentSrc,
    imageFailed,
    isPokemon,
    isSports,
    pokemonFallbackAttempted,
    sportsFallbackAttempted,
  ]);

  if (imageFailed) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-center px-4">
        <p className="text-emerald-400 text-[10px] font-black uppercase tracking-[0.18em]">
          MintRadar
        </p>

        <p className="text-zinc-600 text-xs mt-2">
          Image unavailable
        </p>
      </div>
    );
  }

  if (!currentSrc) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-700 text-xs text-center px-4">
        Loading image...
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={card.name || "Card"}
      className={className || "w-full h-full object-contain"}
      onError={() => {
        const sportsFallbackUrl =
          isSports &&
          currentSrc.startsWith(
            "/api/catalog/sports-image?"
          );

        if (sportsFallbackUrl) {
          setImageFailed(true);
          return;
        }

        void tryNextFallback();
      }}
    />
  );
}

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
  // ACTUAL LISTING PHOTOS
  // -----------------------------------------

  const [frontPhoto, setFrontPhoto] =
    useState<File | null>(null);

  const [backPhoto, setBackPhoto] =
    useState<File | null>(null);

  const [detailPhotos, setDetailPhotos] =
    useState<File[]>([]);

  const [photoError, setPhotoError] =
    useState("");

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
  // LOAD CURRENT / ACTIVE VENDOR
  // -----------------------------------------

  useEffect(() => {
    async function loadVendor() {
      try {
        setCheckingAuth(true);

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session) {
          router.replace(
            "/vendor/login"
          );
          return;
        }

        const activeMembership =
          await getActiveVendorMembership(
            supabase,
            session.user.id
          );

        if (!activeMembership) {
          setMembership(null);
          setPublishError(
            "This account is not connected to a vendor."
          );
          return;
        }

        setMembership({
          vendor_id:
            activeMembership.vendor_id,
          role:
            activeMembership.role,
        });

        setPublishError("");
      } catch (error: any) {
        console.error(
          "Active vendor membership error:",
          error
        );

        setMembership(null);

        setPublishError(
          error?.message ||
            "Vendor account could not be verified."
        );
      } finally {
        setCheckingAuth(false);
      }
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

    setFrontPhoto(null);
    setBackPhoto(null);
    setDetailPhotos([]);
    setPhotoError("");

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
  // ACTUAL LISTING PHOTO HELPERS
  // -----------------------------------------

  function validatePhoto(file: File) {
    if (!file.type.startsWith("image/")) {
      return "Choose an image file.";
    }

    if (file.size > MAX_LISTING_PHOTO_BYTES) {
      return "Each listing photo must be 10 MB or smaller.";
    }

    return "";
  }

  function choosePrimaryPhoto(
    imageType: "front" | "back",
    file: File | null
  ) {
    if (!file) {
      return;
    }

    const validationError =
      validatePhoto(file);

    if (validationError) {
      setPhotoError(validationError);
      return;
    }

    setPhotoError("");

    if (imageType === "front") {
      setFrontPhoto(file);
      return;
    }

    setBackPhoto(file);
  }

  function addDetailPhotos(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    const incoming = Array.from(files);

    for (const file of incoming) {
      const validationError =
        validatePhoto(file);

      if (validationError) {
        setPhotoError(validationError);
        return;
      }
    }

    const availableSlots =
      MAX_DETAIL_PHOTOS - detailPhotos.length;

    if (availableSlots <= 0) {
      setPhotoError(
        `You can add up to ${MAX_DETAIL_PHOTOS} detail photos.`
      );
      return;
    }

    const accepted = incoming.slice(
      0,
      availableSlots
    );

    setDetailPhotos((current) => [
      ...current,
      ...accepted,
    ]);

    setPhotoError(
      incoming.length > availableSlots
        ? `Added ${accepted.length} photo${accepted.length === 1 ? "" : "s"}. Maximum ${MAX_DETAIL_PHOTOS} detail photos.`
        : ""
    );
  }

  function getPendingListingPhotos(): PendingListingPhoto[] {
    const photos: PendingListingPhoto[] = [];

    if (frontPhoto) {
      photos.push({
        id: "front",
        file: frontPhoto,
        imageType: "front",
      });
    }

    if (backPhoto) {
      photos.push({
        id: "back",
        file: backPhoto,
        imageType: "back",
      });
    }

    detailPhotos.forEach((file, index) => {
      photos.push({
        id: `detail-${index}`,
        file,
        imageType: "detail",
      });
    });

    return photos;
  }

  function safePhotoExtension(file: File) {
    const fromName = file.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    if (fromName && fromName.length <= 5) {
      return fromName;
    }

    if (file.type === "image/png") {
      return "png";
    }

    if (file.type === "image/webp") {
      return "webp";
    }

    if (file.type === "image/heic") {
      return "heic";
    }

    if (file.type === "image/heif") {
      return "heif";
    }

    return "jpg";
  }

  async function uploadListingPhotos(
    inventoryId: string
  ) {
    const photos = getPendingListingPhotos();

    if (photos.length === 0) {
      return;
    }

    const vendorId = membership!.vendor_id;
    const uploadedPaths: string[] = [];

    try {
      const imageRows: {
        inventory_id: string;
        storage_path: string;
        image_type: ListingPhotoType;
        position: number;
      }[] = [];

      for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index];
        const extension =
          safePhotoExtension(photo.file);
        const uniquePart =
          crypto.randomUUID();
        const storagePath =
          `${vendorId}/${inventoryId}/${photo.imageType}-${uniquePart}.${extension}`;

        const { error: uploadError } =
          await supabase.storage
            .from("inventory-images")
            .upload(
              storagePath,
              photo.file,
              {
                cacheControl: "3600",
                upsert: false,
                contentType:
                  photo.file.type || undefined,
              }
            );

        if (uploadError) {
          throw uploadError;
        }

        uploadedPaths.push(storagePath);

        imageRows.push({
          inventory_id: inventoryId,
          storage_path: storagePath,
          image_type: photo.imageType,
          position: index,
        });
      }

      const { error: imageRowsError } =
        await supabase
          .from("inventory_images")
          .insert(imageRows);

      if (imageRowsError) {
        throw imageRowsError;
      }
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await supabase.storage
          .from("inventory-images")
          .remove(uploadedPaths);
      }

      throw error;
    }
  }

  async function createInventoryListing({
    cardId,
    listingTypeValue,
    conditionValue,
    gradingCompanyValue,
    gradeValue,
    certNumberValue,
    numericPrice,
    numericQuantity,
  }: {
    cardId: string;
    listingTypeValue: "raw" | "graded";
    conditionValue: string | null;
    gradingCompanyValue: string | null;
    gradeValue: string | null;
    certNumberValue: string | null;
    numericPrice: number;
    numericQuantity: number;
  }) {
    const {
      data: inventoryRow,
      error: inventoryError,
    } = await supabase
      .from("inventory")
      .insert({
        vendor_id: membership!.vendor_id,
        card_id: cardId,
        listing_type: listingTypeValue,
        condition: conditionValue,
        grading_company: gradingCompanyValue,
        grade: gradeValue,
        cert_number: certNumberValue,
        price: numericPrice,
        quantity: numericQuantity,
        notes: notes.trim() || null,
      })
      .select("id")
      .single();

    if (inventoryError) {
      throw inventoryError;
    }

    if (!inventoryRow?.id) {
      throw new Error(
        "MintRadar created the listing but could not read its inventory ID."
      );
    }

    return inventoryRow.id as string;
  }

  async function removeIncompleteInventoryListing(
    inventoryId: string
  ) {
    const { error } = await supabase
      .from("inventory")
      .delete()
      .eq("id", inventoryId)
      .eq("vendor_id", membership!.vendor_id);

    if (error) {
      console.error(
        "Could not remove incomplete inventory listing:",
        error
      );
    }
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

    let inventoryId: string | null = null;

    try {
      const cardId =
        await getOrCreateCard();

      inventoryId =
        await createInventoryListing({
          cardId,
          listingTypeValue: "raw",
          conditionValue: condition,
          gradingCompanyValue: null,
          gradeValue: null,
          certNumberValue: null,
          numericPrice:
            validation.numericPrice,
          numericQuantity:
            validation.numericQuantity,
        });

      await uploadListingPhotos(
        inventoryId
      );

      setPublishSuccess(
        `${selectedCard?.name || "Collectible"} is now live in MintRadar${getPendingListingPhotos().length > 0 ? " with actual card photos." : "."}`
      );

      setPrice("");
      setQuantity("1");
      setNotes("");
      setFrontPhoto(null);
      setBackPhoto(null);
      setDetailPhotos([]);
      setPhotoError("");
    } catch (error: any) {
      if (inventoryId) {
        await removeIncompleteInventoryListing(
          inventoryId
        );
      }

      handlePublishError(error);
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

    let inventoryId: string | null = null;

    try {
      const cardId =
        await getOrCreateCard();

      inventoryId =
        await createInventoryListing({
          cardId,
          listingTypeValue: "graded",
          conditionValue: null,
          gradingCompanyValue:
            gradingCompany,
          gradeValue: grade,
          certNumberValue:
            certNumber.trim() || null,
          numericPrice:
            validation.numericPrice,
          numericQuantity:
            validation.numericQuantity,
        });

      await uploadListingPhotos(
        inventoryId
      );

      setPublishSuccess(
        `${gradingCompany} ${grade} ${selectedCard?.name || "collectible"} is now live in MintRadar${getPendingListingPhotos().length > 0 ? " with actual slab photos." : "."}`
      );

      setPrice("");
      setQuantity("1");
      setCertNumber("");
      setNotes("");
      setFrontPhoto(null);
      setBackPhoto(null);
      setDetailPhotos([]);
      setPhotoError("");
    } catch (error: any) {
      if (inventoryId) {
        await removeIncompleteInventoryListing(
          inventoryId
        );
      }

      handlePublishError(error);
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

                            <CatalogCardImage
                              card={card}
                              className="w-full h-full object-contain"
                            />

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

            <VendorCompButtons
              card={selectedCard}
              listingType={listingType}
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

            <ListingPhotoUploader
              frontPhoto={frontPhoto}
              backPhoto={backPhoto}
              detailPhotos={detailPhotos}
              photoError={photoError}
              condition={condition}
              listingType="raw"
              onFrontPhoto={(file) =>
                choosePrimaryPhoto("front", file)
              }
              onBackPhoto={(file) =>
                choosePrimaryPhoto("back", file)
              }
              onRemoveFront={() =>
                setFrontPhoto(null)
              }
              onRemoveBack={() =>
                setBackPhoto(null)
              }
              onAddDetails={addDetailPhotos}
              onRemoveDetail={(index) =>
                setDetailPhotos((current) =>
                  current.filter((_, itemIndex) =>
                    itemIndex !== index
                  )
                )
              }
            />

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

            <VendorCompButtons
              card={selectedCard}
              listingType={listingType}
              gradingCompany={gradingCompany}
              grade={grade}
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

            <ListingPhotoUploader
              frontPhoto={frontPhoto}
              backPhoto={backPhoto}
              detailPhotos={detailPhotos}
              photoError={photoError}
              condition={null}
              listingType="graded"
              onFrontPhoto={(file) =>
                choosePrimaryPhoto("front", file)
              }
              onBackPhoto={(file) =>
                choosePrimaryPhoto("back", file)
              }
              onRemoveFront={() =>
                setFrontPhoto(null)
              }
              onRemoveBack={() =>
                setBackPhoto(null)
              }
              onAddDetails={addDetailPhotos}
              onRemoveDetail={(index) =>
                setDetailPhotos((current) =>
                  current.filter((_, itemIndex) =>
                    itemIndex !== index
                  )
                )
              }
            />

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

        <CatalogCardImage
          card={card}
          className="w-full h-full object-contain"
        />

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


function VendorCompButtons({
  card,
  listingType,
  gradingCompany,
  grade,
}: {
  card: CatalogCard;
  listingType: ListingType;
  gradingCompany?: string;
  grade?: string;
}) {
  const normalizedCategory =
    normalizeFallbackKeyPart(card.category);

  const isSports =
    normalizedCategory === "sports" ||
    [
      "baseball",
      "basketball",
      "football",
      "soccer",
      "hockey",
      "wrestling",
      "racing",
      "golf",
    ].some((term) =>
      normalizedCategory.includes(term)
    );

  const baseQuery = [
    card.name,
    card.year,
    card.manufacturer,
    card.release_name || card.set_name,
    card.card_number
      ? `#${card.card_number}`
      : null,
    card.parallel_name || card.finish,
  ]
    .filter(Boolean)
    .join(" ");

  const gradedQuery =
    listingType === "graded"
      ? [
          baseQuery,
          gradingCompany,
          grade
            ? `Grade ${grade}`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
      : baseQuery;

  const encodedQuery =
    encodeURIComponent(
      gradedQuery.trim()
    );

  const links = isSports
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
    <div className="mt-6 overflow-hidden rounded-2xl border border-emerald-400/25 bg-black">
      <div className="border-b border-zinc-900 bg-emerald-400/[0.05] px-4 py-4 sm:px-5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">
          📡 Market Radar
        </p>

        <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="text-xl font-black">
            Check Comps Before You Price
          </h3>

          <p className="text-xs text-zinc-600">
            Opens in a new tab
          </p>
        </div>

        <p className="mt-2 text-sm leading-6 text-zinc-500">
          {isSports
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

      {gradedQuery.trim() && (
        <div className="border-t border-zinc-900 px-4 py-3 sm:px-5">
          <p className="truncate text-[11px] text-zinc-700">
            Search: {gradedQuery}
          </p>
        </div>
      )}
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

function ListingPhotoUploader({
  frontPhoto,
  backPhoto,
  detailPhotos,
  photoError,
  condition,
  listingType,
  onFrontPhoto,
  onBackPhoto,
  onRemoveFront,
  onRemoveBack,
  onAddDetails,
  onRemoveDetail,
}: {
  frontPhoto: File | null;
  backPhoto: File | null;
  detailPhotos: File[];
  photoError: string;
  condition: string | null;
  listingType: "raw" | "graded";
  onFrontPhoto: (file: File | null) => void;
  onBackPhoto: (file: File | null) => void;
  onRemoveFront: () => void;
  onRemoveBack: () => void;
  onAddDetails: (files: FileList | null) => void;
  onRemoveDetail: (index: number) => void;
}) {
  const conditionPhotosRecommended =
    listingType === "raw" &&
    condition !== null &&
    ["LP", "MP", "HP", "DMG"].includes(condition);

  return (
    <div className="mt-6 bg-black border border-zinc-900 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-bold">
            Actual Card Photos · Optional
          </p>

          <h3 className="text-xl font-black mt-2">
            Show buyers the real card
          </h3>

          <p className="text-zinc-500 text-sm mt-2 max-w-2xl leading-relaxed">
            {listingType === "graded"
              ? "Add photos of the actual slab so buyers can see the label, cert and slab condition. These photos belong only to this listing and never replace the catalog image."
              : "Add front and back photos so buyers can inspect the exact copy you are selling. These photos belong only to this listing and never replace the catalog image."}
          </p>
        </div>

        {conditionPhotosRecommended && (
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.15em] text-amber-300">
            Recommended for {condition}
          </span>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-5">
        <ListingPhotoSlot
          label="Front"
          photo={frontPhoto}
          onChoose={onFrontPhoto}
          onRemove={onRemoveFront}
        />

        <ListingPhotoSlot
          label="Back"
          photo={backPhoto}
          onChoose={onBackPhoto}
          onRemove={onRemoveBack}
        />
      </div>

      <div className="mt-5 rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black">
              Detail Photos
            </p>
            <p className="text-xs text-zinc-600 mt-1">
              Optional corners, surface, serial number or slab details · {detailPhotos.length}/{MAX_DETAIL_PHOTOS}
            </p>
          </div>

          <label className={`cursor-pointer rounded-xl border px-4 py-2 text-xs font-black transition ${
            detailPhotos.length >= MAX_DETAIL_PHOTOS
              ? "pointer-events-none border-zinc-900 text-zinc-700"
              : "border-zinc-700 text-white hover:border-emerald-400 hover:text-emerald-400"
          }`}>
            Add Details
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              className="hidden"
              disabled={detailPhotos.length >= MAX_DETAIL_PHOTOS}
              onChange={(event) => {
                onAddDetails(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        {detailPhotos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {detailPhotos.map((file, index) => (
              <ListingPhotoPreview
                key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                file={file}
                label={`Detail ${index + 1}`}
                onRemove={() => onRemoveDetail(index)}
              />
            ))}
          </div>
        )}
      </div>

      {photoError && (
        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">
          {photoError}
        </div>
      )}

      <p className="text-[11px] text-zinc-700 mt-4">
        JPG, PNG, WebP, HEIC or HEIF · 10 MB max per photo.
      </p>
    </div>
  );
}

function ListingPhotoSlot({
  label,
  photo,
  onChoose,
  onRemove,
}: {
  label: string;
  photo: File | null;
  onChoose: (file: File | null) => void;
  onRemove: () => void;
}) {
  if (photo) {
    return (
      <ListingPhotoPreview
        file={photo}
        label={label}
        onRemove={onRemove}
        replaceControl={
          <label className="cursor-pointer rounded-lg border border-white/20 bg-black/80 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur hover:border-emerald-400 hover:text-emerald-400 transition">
            Replace
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                onChoose(event.target.files?.[0] || null);
                event.currentTarget.value = "";
              }}
            />
          </label>
        }
      />
    );
  }

  return (
    <label className="cursor-pointer min-h-52 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 flex flex-col items-center justify-center p-6 text-center transition hover:border-emerald-400/60 hover:bg-emerald-400/[0.03]">
      <span className="text-3xl" aria-hidden="true">
        ＋
      </span>
      <span className="font-black mt-2">
        {label} Photo
      </span>
      <span className="text-xs text-zinc-600 mt-2">
        Take a photo or choose one from your device
      </span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          onChoose(event.target.files?.[0] || null);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

function ListingPhotoPreview({
  file,
  label,
  onRemove,
  replaceControl,
}: {
  file: File;
  label: string;
  onRemove: () => void;
  replaceControl?: ReactNode;
}) {
  const [previewUrl, setPreviewUrl] =
    useState("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 aspect-[3/4]">
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={`${label} listing preview`}
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-xs text-zinc-600">
          Preparing preview...
        </div>
      )}

      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-2 bg-gradient-to-b from-black/80 to-transparent">
        <span className="rounded-lg bg-black/80 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-white">
          {label}
        </span>

        <div className="flex gap-2">
          {replaceControl}
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg border border-red-400/30 bg-black/80 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-red-300 backdrop-blur hover:bg-red-400 hover:text-black transition"
          >
            Remove
          </button>
        </div>
      </div>
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