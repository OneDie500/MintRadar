
/**
 * MintRadar #5F-F3 — read-only TCG API discovery adapter.
 *
 * Install:
 * scripts/catalog/discovery/tcgapi-adapter.ts
 *
 * Offline test:
 * npx tsx scripts/catalog/discovery/tcgapi-adapter.ts --self-test
 *
 * Live (ONLY after provider endpoint is verified and quota resets):
 * npx tsx scripts/catalog/discovery/tcgapi-adapter.ts --live --max-sets=2
 *
 * No Supabase, no catalog writes, no image/identity/rights approvals.
 * Provider listing and pagination schemas are provisional until verified live.
 */

import { loadEnvConfig } from "@next/env";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DiscoveryClient,
  type DiscoveryResult,
} from "./client";

const BASE = "https://api.tcgapi.dev/v1";

const obj = (
  x: unknown
): x is Record<string, unknown> =>
  x !== null &&
  typeof x === "object" &&
  !Array.isArray(x);

const str = (x: unknown): string | null =>
  typeof x === "string" && x.trim()
    ? x.trim()
    : null;

const id = (x: unknown): string | null =>
  typeof x === "number" &&
  Number.isSafeInteger(x) &&
  x > 0
    ? String(x)
    : str(x);

const fail = (message: string): never => {
  throw new Error(message);
};

const safeImage = (raw: unknown): string | null => {
  const value = str(raw);

  if (!value) return null;

  try {
    const url = new URL(value);

    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      [
        "product-images.tcgplayer.com",
        "tcgplayer-cdn.tcgplayer.com",
      ].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
};

export type DiscoveredCard = {
  providerId: string | null;
  name: string;
  collectorNumber: string;
  printing: string | null;
  imageCandidate: string | null;
  imageSource: "tcgapi" | null;
  identityApproved: false;
  artworkApproved: false;
  rightsCleared: false;
};

export type DiscoveredSet = {
  providerSetId: string;
  name: string;
  game: string | null;
  releaseDate: string | null;
  cards: DiscoveredCard[];
  complete: true;
};

export type ReviewItem = {
  scope: "listing" | "set" | "card";
  providerSetId?: string;
  reason: string;
  record?: unknown;
};

export type DiscoveryReport = {
  provider: "tcgapi";
  listingComplete: boolean;
  discoveredSetCount: number;
  acceptedSets: DiscoveredSet[];
  reviewQueue: ReviewItem[];
  note: string;
};

type AdapterOptions = {
  maxSets: number;
  game?: string;
};

function parseSet(
  raw: unknown
): {
  providerSetId: string;
  name: string;
  game: string | null;
  releaseDate: string | null;
} | null {
  if (!obj(raw)) return null;

  const providerSetId = id(raw.id);
  const name = str(raw.name);

  if (!providerSetId || !name) return null;

  return {
    providerSetId,
    name,
    game: str(raw.game_slug),
    releaseDate: str(raw.release_date),
  };
}

function parseCard(
  raw: unknown
): DiscoveredCard | null {
  if (!obj(raw)) return null;

  const name = str(raw.name);
  const collectorNumber = str(raw.number);

  if (!name || !collectorNumber) return null;

  const imageCandidate = safeImage(raw.image_url);

  return {
    providerId:
      id(raw.id) ??
      id(raw.tcgplayer_id),
    name,
    collectorNumber,
    printing: str(raw.printing),
    imageCandidate,
    imageSource: imageCandidate
      ? "tcgapi"
      : null,
    identityApproved: false,
    artworkApproved: false,
    rightsCleared: false,
  };
}

function normalized(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase();
}

export async function discoverTcgapi(
  client: DiscoveryClient,
  apiKey: string,
  options: AdapterOptions
): Promise<DiscoveryReport> {
  if (
    !Number.isSafeInteger(options.maxSets) ||
    options.maxSets < 1 ||
    options.maxSets > 100
  ) {
    fail("maxSets must be 1–100");
  }

  const reviewQueue: ReviewItem[] = [];
  const acceptedSets: DiscoveredSet[] = [];

  const listingUrl = `${BASE}/sets?per_page=100`;

  const listing = await client.collectPages(
    listingUrl,
    apiKey,
    50
  );

  if (!listing.complete) {
    return {
      provider: "tcgapi",
      listingComplete: false,
      discoveredSetCount: listing.records.length,
      acceptedSets,
      reviewQueue: [
        {
          scope: "listing",
          reason:
            listing.stoppedReason ??
            "Incomplete set listing",
        },
      ],
      note: "No catalog writes or approvals",
    };
  }

  const seenSetIds = new Set<string>();

  const sets: Array<
    NonNullable<ReturnType<typeof parseSet>>
  > = [];

  for (const raw of listing.records) {
    const set = parseSet(raw);

    if (!set) {
      reviewQueue.push({
        scope: "listing",
        reason:
          "Set missing provider ID or name",
        record: raw,
      });

      continue;
    }

    if (seenSetIds.has(set.providerSetId)) {
      reviewQueue.push({
        scope: "listing",
        reason:
          `Duplicate provider set ID ${set.providerSetId}`,
        record: raw,
      });

      continue;
    }

    seenSetIds.add(set.providerSetId);

    if (
      !options.game ||
      normalized(set.game ?? "") ===
        normalized(options.game)
    ) {
      sets.push(set);
    }
  }

  for (const set of sets.slice(0, options.maxSets)) {
    const url =
      `${BASE}/sets/` +
      `${encodeURIComponent(set.providerSetId)}` +
      `/cards?per_page=100`;

    const result: DiscoveryResult =
      await client.collectPages(
        url,
        apiKey,
        100
      );

    if (!result.complete) {
      reviewQueue.push({
        scope: "set",
        providerSetId: set.providerSetId,
        reason:
          "Incomplete card pagination: " +
          result.stoppedReason,
      });

      continue;
    }

    if (result.records.length === 0) {
      reviewQueue.push({
        scope: "set",
        providerSetId: set.providerSetId,
        reason: "Empty card inventory",
      });

      continue;
    }

    const cards: DiscoveredCard[] = [];
    const seenCardIds = new Set<string>();

    let invalid = false;

    for (const raw of result.records) {
      const card = parseCard(raw);

      if (!card || !card.providerId) {
        reviewQueue.push({
          scope: "card",
          providerSetId: set.providerSetId,
          reason:
            "Missing card identity or provider ID",
          record: raw,
        });

        invalid = true;
        continue;
      }

      if (seenCardIds.has(card.providerId)) {
        reviewQueue.push({
          scope: "card",
          providerSetId: set.providerSetId,
          reason:
            `Duplicate provider card ID ${card.providerId}`,
          record: raw,
        });

        invalid = true;
        continue;
      }

      seenCardIds.add(card.providerId);
      cards.push(card);
    }

    // Fail closed:
    // Never label a partially parsed set complete.
    if (
      invalid ||
      cards.length !== result.records.length
    ) {
      reviewQueue.push({
        scope: "set",
        providerSetId: set.providerSetId,
        reason:
          "Card identity validation failed; set withheld",
      });

      continue;
    }

    acceptedSets.push({
      ...set,
      cards,
      complete: true,
    });
  }

  return {
    provider: "tcgapi",
    listingComplete: true,
    discoveredSetCount: listing.records.length,
    acceptedSets,
    reviewQueue,
    note:
      "Read-only provider evidence. " +
      "Image reachability, visual identity, " +
      "printing equivalence, and rights are NOT verified. " +
      "No catalog writes or approvals.",
  };
}

/**
 * Offline self-test.
 *
 * Uses mocked HTTP responses.
 * No live API requests.
 */
async function selfTest(): Promise<void> {
  const root = await mkdtemp(
    path.join(tmpdir(), "mintradar-f3-")
  );

  let calls = 0;

  const mockFetch = async (
    input: RequestInfo | URL
  ): Promise<Response> => {
    calls++;

    const url = new URL(String(input));
    const page = Number(
      url.searchParams.get("page")
    );

    let data: unknown[];

    let meta: {
      total: number;
      has_more: boolean;
      current_page: number;
    };

    if (url.pathname === "/v1/sets") {
      data = [
        {
          id: 42,
          name: "Fixture Set",
          game_slug: "pokemon",
          release_date: "2026-11-06",
        },
      ];

      meta = {
        total: 1,
        has_more: false,
        current_page: 1,
      };
    } else if (
      url.pathname === "/v1/sets/42/cards"
    ) {
      data =
        page === 1
          ? [
              {
                id: 101,
                name: "Example",
                number: "001/002",
                printing: "Holofoil",
                image_url:
                  "https://product-images.tcgplayer.com/fit-in/400x400/123.jpg",
              },
            ]
          : [
              {
                id: 102,
                name: "Example",
                number: "002/002",
                printing: "Reverse Holofoil",
              },
            ];

      meta = {
        total: 2,
        has_more: page === 1,
        current_page: page,
      };
    } else {
      return new Response("not found", {
        status: 404,
      });
    }

    return new Response(
      JSON.stringify({
        data,
        meta,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }
    );
  };

  try {
    const makeClient = () =>
      new DiscoveryClient({
        cacheDir: path.join(root, "cache"),
        minGapMs: 0,
        fetchImpl: mockFetch as typeof fetch,
      });

    const first = await discoverTcgapi(
      makeClient(),
      "offline-key",
      {
        maxSets: 1,
        game: "pokemon",
      }
    );

    if (
      !first.listingComplete ||
      first.acceptedSets.length !== 1 ||
      first.acceptedSets[0].cards.length !== 2 ||
      calls !== 3
    ) {
      fail("Discovery fixture failed");
    }

    if (
      first.acceptedSets[0].cards.some(
        (card) =>
          card.identityApproved ||
          card.artworkApproved ||
          card.rightsCleared
      )
    ) {
      fail("Approval safeguard failed");
    }

    const second = await discoverTcgapi(
      makeClient(),
      "offline-key",
      {
        maxSets: 1,
        game: "pokemon",
      }
    );

    if (
      second.acceptedSets.length !== 1 ||
      calls !== 3
    ) {
      fail("Persistent cache replay failed");
    }

    const rateClient = new DiscoveryClient({
      cacheDir: path.join(root, "limited"),
      minGapMs: 0,
      fetchImpl: (async () =>
        new Response("limited", {
          status: 429,
          headers: {
            "retry-after": "3600",
          },
        })) as typeof fetch,
    });

    const limited = await discoverTcgapi(
      rateClient,
      "offline-key",
      {
        maxSets: 1,
      }
    );

    if (
      limited.listingComplete ||
      limited.acceptedSets.length ||
      limited.reviewQueue.length !== 1
    ) {
      fail("Rate limit fail-closed test failed");
    }

    console.log(
      "PASS: set listing, multi-page card enumeration, " +
        "provider IDs, printing evidence, persistent replay, " +
        "rate-limit quarantine, zero approvals"
    );

    console.log(
      "Zero live API calls. " +
        "Zero Supabase calls. " +
        "Zero catalog writes."
    );
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
    });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (
    args.length === 1 &&
    args[0] === "--self-test"
  ) {
    return selfTest();
  }

  if (
    !args.includes("--live") ||
    args.some(
      (arg) =>
        arg !== "--live" &&
        !arg.startsWith("--max-sets=") &&
        !arg.startsWith("--game=")
    )
  ) {
    fail(
      "Usage: tsx scripts/catalog/discovery/tcgapi-adapter.ts " +
        "--self-test | --live --max-sets=2 [--game=pokemon]"
    );
  }

  loadEnvConfig(process.cwd());

  const key = process.env.TCG_API_KEY;

  if (!key) {
    fail("TCG_API_KEY missing");
  }

  const maxSets = Number(
    args
      .find((arg) =>
        arg.startsWith("--max-sets=")
      )
      ?.split("=")[1] ?? "2"
  );

  const game = args
    .find((arg) =>
      arg.startsWith("--game=")
    )
    ?.split("=")[1];

  // Explicitly narrow the API key to a string.
  const report = await discoverTcgapi(
    new DiscoveryClient(),
    key ?? fail("TCG_API_KEY missing"),
    {
      maxSets,
      game,
    }
  );

  const outDir = path.resolve(
    ".cache/catalog-discovery-audit"
  );

  await mkdir(outDir, {
    recursive: true,
  });

  const outFile = path.join(
    outDir,
    `tcgapi-f3-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`
  );

  await writeFile(
    outFile,
    JSON.stringify(report, null, 2) + "\n",
    {
      flag: "wx",
    }
  );

  console.log(
    JSON.stringify(
      {
        listingComplete:
          report.listingComplete,
        discoveredSetCount:
          report.discoveredSetCount,
        acceptedSets:
          report.acceptedSets.length,
        reviewItems:
          report.reviewQueue.length,
        report: outFile,
      },
      null,
      2
    )
  );

  console.log(
    "No Supabase calls or catalog writes. " +
      "Do not import this evidence report as a catalog manifest."
  );
}

void main().catch((error) => {
  console.error(
    "Discovery failed:",
    error instanceof Error
      ? error.message
      : String(error)
  );

  process.exitCode = 1;
});
