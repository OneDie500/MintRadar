"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type SetCategory =
  | "Pokemon"
  | "Lorcana"
  | "One Piece"
  | "Magic: The Gathering";

type SetOption = {
  id: string;
  name: string;
  category: SetCategory;
  code?: string | null;
  cardCount?: number | null;
  releasedAt?: string | null;
  setType?: string | null;
};

type CategoryConfig = {
  value: SetCategory;
  label: string;
  shortLabel: string;
  route: string;
  placeholder: string;
  logo: string;
  logoAlt: string;
  logoClassName: string;
};

const CATEGORIES: CategoryConfig[] = [
  {
    value: "Pokemon",
    label: "Pokémon",
    shortLabel: "Pokémon",
    route: "/api/catalog/sets/pokemon",
    placeholder:
      "Search 151, Destined Rivals, Prismatic Evolutions...",
    logo: "/catalog-logos/pokemon.png",
    logoAlt: "Pokémon Trading Card Game",
    logoClassName: "h-20 sm:h-24 w-auto",
  },
  {
    value: "Lorcana",
    label: "Lorcana",
    shortLabel: "Lorcana",
    route: "/api/catalog/sets/lorcana",
    placeholder:
      "Search First Chapter, Floodborn, Inklands...",
    logo: "/catalog-logos/lorcana.png",
    logoAlt: "Disney Lorcana Trading Card Game",
    logoClassName: "h-16 sm:h-20 w-auto",
  },
  {
    value: "One Piece",
    label: "One Piece",
    shortLabel: "One Piece",
    route: "/api/catalog/sets/onepiece",
    placeholder:
      "Search Romance Dawn, Paramount War, OP-01...",
    logo: "/catalog-logos/onepiece.png",
    logoAlt: "One Piece Card Game",
    logoClassName: "h-14 sm:h-16 w-auto",
  },
  {
    value: "Magic: The Gathering",
    label: "Magic: The Gathering",
    shortLabel: "Magic",
    route: "/api/catalog/sets/mtg",
    placeholder:
      "Search Foundations, Tarkir, Modern Horizons...",
    logo: "/catalog-logos/mtg.png",
    logoAlt: "Magic: The Gathering",
    logoClassName: "h-14 sm:h-16 w-auto",
  },
];

function categorySlug(category: SetCategory) {
  if (category === "Pokemon") return "pokemon";
  if (category === "Lorcana") return "lorcana";
  if (category === "One Piece") return "onepiece";
  return "mtg";
}

function getCategoryLabel(category: SetCategory) {
  if (category === "Pokemon") return "Pokémon";
  if (category === "Magic: The Gathering") return "MTG";
  return category;
}

function BrowseSetsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const categoryFromUrl =
    searchParams.get("category");

  const initialCategory =
    CATEGORIES.find(
      (category) =>
        categorySlug(
          category.value
        ) === categoryFromUrl
    )?.value || "Pokemon";

  const [activeCategory, setActiveCategory] =
    useState<SetCategory>(
      initialCategory
    );

  const [sets, setSets] = useState<SetOption[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const activeConfig =
    CATEGORIES.find(
      (category) => category.value === activeCategory
    ) || CATEGORIES[0];

  useEffect(() => {
    const categoryValue =
      CATEGORIES.find(
        (category) =>
          categorySlug(
            category.value
          ) === categoryFromUrl
      )?.value;

    if (
      categoryValue &&
      categoryValue !==
        activeCategory
    ) {
      setActiveCategory(
        categoryValue
      );
    }
  }, [
    categoryFromUrl,
    activeCategory,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadSets() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(activeConfig.route, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(
            `Set catalog request failed (${response.status}).`
          );
        }

        const payload = await response.json();

        if (!cancelled) {
          setSets(
            Array.isArray(payload?.results)
              ? payload.results
              : []
          );
        }
      } catch (loadError) {
        console.error("Browse sets error:", loadError);

        if (!cancelled) {
          setSets([]);
          setError(
            "The set catalog is temporarily unavailable."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSets();

    return () => {
      cancelled = true;
    };
  }, [activeConfig.route]);

  const filteredSets = useMemo(() => {
    const search = searchTerm
      .trim()
      .toLowerCase();

    if (!search) {
      return sets;
    }

    return sets.filter((set) =>
      [
        set.name,
        set.code,
        set.setType,
        set.releasedAt,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [sets, searchTerm]);

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-5 py-5 flex items-center justify-between gap-4">
          <Link href="/" className="shrink-0">
            <Image
              src="/mintradar-logo.png"
              alt="MintRadar by OnlySlabs"
              width={600}
              height={300}
              priority
              className="w-[190px] sm:w-[260px] h-auto"
            />
          </Link>

          <Link
            href="/"
            className="text-sm font-bold text-zinc-400 hover:text-emerald-400 transition"
          >
            ← Back to Search
          </Link>
        </div>
      </header>

      <section className="border-b border-zinc-900">
        <div className="max-w-5xl mx-auto px-5 py-12 sm:py-16 text-center">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-400 font-black mb-3">
            MintRadar Set Explorer
          </p>

          <h1 className="text-4xl sm:text-6xl font-black tracking-tight">
            Browse by Set
          </h1>

          <p className="text-zinc-500 max-w-2xl mx-auto mt-4">
            Pick a game, search its set catalog, then open a
            set to browse the cards inside.
          </p>

          <div className="mt-8 max-w-2xl mx-auto">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(event.target.value)
              }
              placeholder={activeConfig.placeholder}
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-5 py-4 text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-400"
            />
          </div>
        </div>
      </section>

      <section className="border-b border-zinc-900 bg-zinc-950/40">
        <div className="max-w-7xl mx-auto px-5 py-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {CATEGORIES.map((category) => {
              const active =
                activeCategory === category.value;

              return (
                <button
                  key={category.value}
                  type="button"
                  onClick={() => {
                    setActiveCategory(
                      category.value
                    );
                    setSearchTerm("");

                    router.replace(
                      `/sets?category=${categorySlug(
                        category.value
                      )}`,
                      {
                        scroll: false,
                      }
                    );
                  }}
                  className={`group relative min-h-[150px] sm:min-h-[175px] rounded-2xl border bg-black px-4 py-5 transition duration-200 ${
                    active
                      ? "border-emerald-400 shadow-[0_0_28px_rgba(52,211,153,0.16)]"
                      : "border-zinc-800 hover:border-emerald-400/60"
                  }`}
                >
                  {active && (
                    <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Active
                    </span>
                  )}

                  <div className="h-[95px] sm:h-[115px] flex items-center justify-center px-2">
                    <img
                      src={category.logo}
                      alt={category.logoAlt}
                      className={`${category.logoClassName} max-w-full object-contain transition duration-200 ${
                        active
                          ? "opacity-100 scale-[1.03]"
                          : "opacity-75 group-hover:opacity-100 group-hover:scale-[1.02]"
                      }`}
                    />
                  </div>

                  <p
                    className={`mt-2 text-center text-sm font-black transition ${
                      active
                        ? "text-emerald-300"
                        : "text-zinc-500 group-hover:text-white"
                    }`}
                  >
                    {category.shortLabel}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-5 py-10">
        <div className="mb-7">
          <div className="flex items-center gap-4">
            <div className="h-12 min-w-[80px] max-w-[150px] flex items-center">
              <img
                src={activeConfig.logo}
                alt={activeConfig.logoAlt}
                className="max-h-12 max-w-full w-auto object-contain"
              />
            </div>

            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-black">
                {activeConfig.label}
              </p>

              <h2 className="text-2xl sm:text-3xl font-black mt-1">
                Sets
              </h2>
            </div>
          </div>

          {!loading && !error && (
            <p className="text-sm text-zinc-600 mt-4">
              {filteredSets.length} result
              {filteredSets.length === 1 ? "" : "s"}
            </p>
          )}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-10 text-center text-zinc-500">
            Loading sets...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-10 text-center text-zinc-500">
            {error}
          </div>
        ) : filteredSets.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-10 text-center">
            <h3 className="font-black text-xl">
              No sets found
            </h3>

            <p className="text-zinc-500 mt-2">
              Try another set name or code.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSets.map((set) => (
              <Link
                key={`${set.category}:${set.id}`}
                href={`/sets/${categorySlug(
                  set.category
                )}/${encodeURIComponent(
                  set.id
                )}?name=${encodeURIComponent(set.name)}`}
                className="group rounded-2xl border border-zinc-900 bg-zinc-950 p-5 transition hover:-translate-y-1 hover:border-emerald-400/60"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300">
                      {getCategoryLabel(set.category)}
                    </span>

                    <h3 className="mt-4 text-lg font-black leading-tight group-hover:text-emerald-300">
                      {set.name}
                    </h3>

                    {(set.code || set.releasedAt) && (
                      <p className="mt-1 text-sm text-zinc-600">
                        {[set.code, set.releasedAt]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    )}

                    {set.setType && (
                      <p className="mt-2 text-xs text-zinc-700 capitalize">
                        {set.setType.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>

                  <span className="text-emerald-400 text-xl">
                    →
                  </span>
                </div>

                {typeof set.cardCount === "number" && (
                  <p className="mt-5 border-t border-zinc-900 pt-4 text-xs text-zinc-500">
                    {set.cardCount} card
                    {set.cardCount === 1 ? "" : "s"}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function SetsPageFallback() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-5">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-8 py-6 text-center">
          <p className="text-sm font-bold text-zinc-500">
            Loading MintRadar Set Explorer...
          </p>
        </div>
      </div>
    </main>
  );
}

export default function BrowseSetsPage() {
  return (
    <Suspense fallback={<SetsPageFallback />}>
      <BrowseSetsContent />
    </Suspense>
  );
}
