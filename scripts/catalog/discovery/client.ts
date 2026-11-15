
/**
 * MintRadar #5F-F2
 * Read-only, resumable discovery HTTP client.
 *
 * Features:
 * - Persistent page cache
 * - Rate-limit-aware request handling
 * - Retry-After and rate-limit reset support
 * - Sequential pagination
 * - Fail-closed completeness checks
 * - Offline self-tests
 *
 * No Supabase calls.
 * No catalog writes.
 *
 * Run tests:
 * npx tsx scripts/catalog/discovery/client.ts --self-test
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

type JsonObject = Record<string, unknown>;

export type DiscoveryPage = {
  data: unknown[];
  meta?: {
    total?: number;
    has_more?: boolean;
    current_page?: number;
    last_page?: number;
  };
};

type CachedPage = {
  url: string;
  checkedAt: string;
  payload: DiscoveryPage;
};

type QuotaState = {
  blockedUntil: number;
  reason: string;
};

type ClientOptions = {
  cacheDir?: string;
  minGapMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type DiscoveryResult = {
  complete: boolean;
  records: unknown[];
  pages: number;
  fromCache: number;
  stoppedReason: string | null;
};

const DEFAULT_CACHE = path.resolve(
  ".cache/catalog-discovery-http"
);

const DEFAULT_GAP_MS = 1800;

const sleepDefault = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function assert(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new Error(message);
}

function isObject(value: unknown): value is JsonObject {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function validatePage(value: unknown): DiscoveryPage {
  assert(isObject(value), "Provider response is not an object");
  assert(Array.isArray(value.data), "Provider data array missing");

  const meta = value.meta;

  if (meta !== undefined) {
    assert(isObject(meta), "Invalid pagination metadata");

    for (const field of [
      "total",
      "current_page",
      "last_page",
    ]) {
      const v = meta[field];

      if (v !== undefined) {
        assert(
          typeof v === "number" &&
            Number.isSafeInteger(v) &&
            v >= 0,
          `Invalid pagination field: ${field}`
        );
      }
    }

    if (meta.has_more !== undefined) {
      assert(
        typeof meta.has_more === "boolean",
        "Invalid has_more"
      );
    }
  }

  return value as DiscoveryPage;
}

function cacheKey(url: string): string {
  return createHash("sha256")
    .update(url)
    .digest("hex");
}

function parseRetryAfter(
  raw: string | null,
  now: number
): number | null {
  if (!raw) return null;

  const seconds = Number(raw);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return now + seconds * 1000;
  }

  const parsed = Date.parse(raw);

  return Number.isFinite(parsed)
    ? Math.max(now, parsed)
    : null;
}

function parseReset(
  raw: string | null,
  now: number
): number | null {
  if (!raw) return null;

  const iso = Date.parse(raw);
  if (Number.isFinite(iso)) return iso;

  const numeric = Number(raw);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  const milliseconds =
    numeric > 1e12 ? numeric : numeric * 1000;

  return milliseconds > now ? milliseconds : null;
}

export class DiscoveryRateLimitError extends Error {
  constructor(
    public readonly blockedUntil: number,
    message: string
  ) {
    super(message);
    this.name = "DiscoveryRateLimitError";
  }
}

export class DiscoveryClient {
  private readonly cacheDir: string;
  private readonly minGapMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private nextRequestAt = 0;

  constructor(options: ClientOptions = {}) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE;
    this.minGapMs = options.minGapMs ?? DEFAULT_GAP_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? sleepDefault;
  }

  private pagePath(url: string): string {
    return path.join(
      this.cacheDir,
      "pages",
      `${cacheKey(url)}.json`
    );
  }

  private quotaPath(): string {
    return path.join(this.cacheDir, "quota.json");
  }

  private async saveJson(
    destination: string,
    value: unknown
  ): Promise<void> {
    await mkdir(path.dirname(destination), {
      recursive: true,
    });

    const temporary = `${destination}.${process.pid}.tmp`;

    await writeFile(
      temporary,
      JSON.stringify(value, null, 2) + "\n",
      "utf8"
    );

    await rename(temporary, destination);
  }

  private async readJson(
    filename: string
  ): Promise<unknown | null> {
    try {
      return JSON.parse(
        await readFile(filename, "utf8")
      ) as unknown;
    } catch (error) {
      if (
        isObject(error) &&
        error.code === "ENOENT"
      ) {
        return null;
      }

      throw error;
    }
  }

  private async getQuota(): Promise<QuotaState> {
    const value = await this.readJson(this.quotaPath());

    if (!isObject(value)) {
      return {
        blockedUntil: 0,
        reason: "",
      };
    }

    return {
      blockedUntil:
        typeof value.blockedUntil === "number"
          ? value.blockedUntil
          : 0,
      reason:
        typeof value.reason === "string"
          ? value.reason
          : "",
    };
  }

  private async blockQuota(
    until: number,
    reason: string
  ): Promise<void> {
    const current = await this.getQuota();

    await this.saveJson(this.quotaPath(), {
      blockedUntil: Math.max(
        current.blockedUntil,
        until
      ),
      reason,
    });
  }

  private async readCachedPage(
    url: string
  ): Promise<DiscoveryPage | null> {
    const cached = await this.readJson(
      this.pagePath(url)
    );

    if (!isObject(cached)) return null;

    assert(
      cached.url === url,
      "Cache URL mismatch"
    );

    return validatePage(cached.payload);
  }

  private async saveCachedPage(
    url: string,
    payload: DiscoveryPage
  ): Promise<void> {
    const entry: CachedPage = {
      url,
      checkedAt: new Date(this.now()).toISOString(),
      payload,
    };

    await this.saveJson(this.pagePath(url), entry);
  }

  async getPage(
    url: string,
    apiKey: string
  ): Promise<{
    page: DiscoveryPage;
    fromCache: boolean;
  }> {
    const parsed = new URL(url);

    assert(
      parsed.protocol === "https:" &&
        parsed.hostname === "api.tcgapi.dev" &&
        !parsed.username &&
        !parsed.password,
      "Unsupported provider URL"
    );

    const cached = await this.readCachedPage(url);

    if (cached) {
      return {
        page: cached,
        fromCache: true,
      };
    }

    const quota = await this.getQuota();

    if (quota.blockedUntil > this.now()) {
      throw new DiscoveryRateLimitError(
        quota.blockedUntil,
        `Provider quota blocked: ${quota.reason}`
      );
    }

    assert(apiKey.trim(), "API key missing");

    const delay = Math.max(
      0,
      this.nextRequestAt - this.now()
    );

    if (delay > 0) await this.sleep(delay);

    this.nextRequestAt =
      this.now() + this.minGapMs;

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });

    const retryAfter = parseRetryAfter(
      response.headers.get("retry-after"),
      this.now()
    );

    const reset = parseReset(
      response.headers.get("x-ratelimit-reset"),
      this.now()
    );

    const remaining = response.headers.get(
      "x-ratelimit-remaining"
    );

    if (
      response.status === 429 ||
      remaining === "0"
    ) {
      const blockedUntil = Math.max(
        retryAfter ?? 0,
        reset ?? 0,
        this.now() + 60000
      );

      await this.blockQuota(
        blockedUntil,
        `HTTP ${response.status}; remaining=${remaining ?? "unknown"}`
      );

      await response.body?.cancel();

      throw new DiscoveryRateLimitError(
        blockedUntil,
        `Provider rate limit reached; blocked until ${new Date(
          blockedUntil
        ).toISOString()}`
      );
    }

    if (!response.ok) {
      await response.body?.cancel();

      throw new Error(
        `Provider returned HTTP ${response.status}`
      );
    }

    const payload = validatePage(
      await response.json()
    );

    await this.saveCachedPage(url, payload);

    return {
      page: payload,
      fromCache: false,
    };
  }

  async collectPages(
    baseUrl: string,
    apiKey: string,
    maxPages = 100
  ): Promise<DiscoveryResult> {
    assert(
      Number.isSafeInteger(maxPages) &&
        maxPages > 0,
      "Invalid maxPages"
    );

    const records: unknown[] = [];
    let fromCache = 0;
    let pages = 0;

    const result = (
      complete: boolean,
      stoppedReason: string | null
    ): DiscoveryResult => ({
      complete,
      records,
      pages,
      fromCache,
      stoppedReason,
    });

    for (
      let pageNumber = 1;
      pageNumber <= maxPages;
      pageNumber++
    ) {
      const url = new URL(baseUrl);
      url.searchParams.set(
        "page",
        String(pageNumber)
      );

      let fetched: {
        page: DiscoveryPage;
        fromCache: boolean;
      };

      try {
        fetched = await this.getPage(
          url.toString(),
          apiKey
        );
      } catch (error) {
        if (
          error instanceof DiscoveryRateLimitError
        ) {
          return result(
            false,
            error.message
          );
        }

        throw error;
      }

      pages++;

      if (fetched.fromCache) fromCache++;

      const payload = fetched.page;
      records.push(...payload.data);

      const meta = payload.meta;

      if (!meta) {
        return result(
          false,
          "Pagination metadata missing"
        );
      }

      if (
        meta.current_page !== undefined &&
        meta.current_page !== pageNumber
      ) {
        return result(
          false,
          "Provider page number mismatch"
        );
      }

      if (
        meta.total !== undefined &&
        records.length > meta.total
      ) {
        return result(
          false,
          "Received more records than reported total"
        );
      }

      const hasMore =
        typeof meta.has_more === "boolean"
          ? meta.has_more
          : typeof meta.last_page === "number"
            ? pageNumber < meta.last_page
            : typeof meta.total === "number"
              ? records.length < meta.total
              : null;

      if (hasMore === null) {
        return result(
          false,
          "Pagination completeness unknown"
        );
      }

      if (!hasMore) {
        if (
          meta.total !== undefined &&
          records.length !== meta.total
        ) {
          return result(
            false,
            "Final record count mismatch"
          );
        }

        return result(true, null);
      }

      if (payload.data.length === 0) {
        return result(
          false,
          "Empty page before pagination completed"
        );
      }
    }

    return result(
      false,
      "Maximum page limit reached"
    );
  }
}

/**
 * Offline tests.
 * Mocked HTTP only; no real API requests.
 */
async function selfTest(): Promise<void> {
  const { mkdtemp, rm } = await import(
    "node:fs/promises"
  );
  const { tmpdir } = await import("node:os");

  const root = await mkdtemp(
    path.join(tmpdir(), "mintradar-discovery-")
  );

  const url =
    "https://api.tcgapi.dev/v1/sets/123/cards?per_page=2";

  let requests = 0;
  let clock = 1000000;

  const mockFetch = async (
    input: RequestInfo | URL
  ): Promise<Response> => {
    requests++;

    const requested = new URL(String(input));
    const page = Number(
      requested.searchParams.get("page")
    );

    if (page === 1) {
      return new Response(
        JSON.stringify({
          data: [{ id: 1 }, { id: 2 }],
          meta: {
            total: 3,
            has_more: true,
            current_page: 1,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        data: [{ id: 3 }],
        meta: {
          total: 3,
          has_more: false,
          current_page: 2,
        },
      }),
      { status: 200 }
    );
  };

  try {
    const client = new DiscoveryClient({
      cacheDir: path.join(root, "normal"),
      minGapMs: 0,
      fetchImpl: mockFetch as typeof fetch,
      now: () => clock,
      sleep: async () => {},
    });

    const first = await client.collectPages(
      url,
      "test-key"
    );

    assert(first.complete, "Pagination test failed");
    assert(
      first.records.length === 3,
      "Expected three records"
    );
    assert(
      requests === 2,
      "Expected two mocked requests"
    );

    const secondClient = new DiscoveryClient({
      cacheDir: path.join(root, "normal"),
      minGapMs: 0,
      fetchImpl: mockFetch as typeof fetch,
      now: () => clock,
      sleep: async () => {},
    });

    const second = await secondClient.collectPages(
      url,
      "test-key"
    );

    assert(
      second.complete &&
        second.fromCache === 2,
      "Persistent cache replay failed"
    );
    assert(
      requests === 2,
      "Cache replay made unexpected requests"
    );

    let limitedRequests = 0;

    const limitedFetch = async (): Promise<Response> => {
      limitedRequests++;

      return new Response("Rate limited", {
        status: 429,
        headers: {
          "retry-after": "3600",
          "x-ratelimit-remaining": "0",
        },
      });
    };

    const limitedDir = path.join(
      root,
      "limited"
    );

    const limitedClient = new DiscoveryClient({
      cacheDir: limitedDir,
      minGapMs: 0,
      fetchImpl: limitedFetch as typeof fetch,
      now: () => clock,
      sleep: async () => {},
    });

    const limited = await limitedClient.collectPages(
      url,
      "test-key"
    );

    assert(
      !limited.complete,
      "429 must not produce complete inventory"
    );
    assert(
      limitedRequests === 1,
      "429 must stop immediately"
    );

    const restartedClient = new DiscoveryClient({
      cacheDir: limitedDir,
      minGapMs: 0,
      fetchImpl: limitedFetch as typeof fetch,
      now: () => clock,
      sleep: async () => {},
    });

    const restarted = await restartedClient.collectPages(
      url,
      "test-key"
    );

    assert(
      !restarted.complete,
      "Persisted quota should block discovery"
    );
    assert(
      limitedRequests === 1,
      "Persisted quota did not prevent requests"
    );

    const incompleteClient = new DiscoveryClient({
      cacheDir: path.join(root, "incomplete"),
      minGapMs: 0,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            data: [{ id: 1 }],
          }),
          { status: 200 }
        )) as typeof fetch,
      now: () => clock,
      sleep: async () => {},
    });

    const incomplete =
      await incompleteClient.collectPages(
        url,
        "test-key"
      );

    assert(
      !incomplete.complete,
      "Unknown pagination must fail closed"
    );

    console.log(
      "PASS: pagination, persistent cache replay, " +
        "429 stop, persisted quota block, " +
        "fail-closed completeness"
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

if (process.argv.includes("--self-test")) {
  void selfTest().catch((error) => {
    console.error("Self-test failed:", error);
    process.exitCode = 1;
  });
}
