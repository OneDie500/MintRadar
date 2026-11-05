
"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type RecoveryJob = {
  id: string;
  external_id: string;
  language: string;
  set_id: string | null;
  card_number: string | null;
  card_name: string | null;
  status: string;
  attempts: number;
  discovered_image_url: string | null;
  discovered_source: string | null;
  identity_verified: boolean;
  rights_cleared: boolean;
  last_error: string | null;
  updated_at: string;
};

type QueueStatus = {
  ok: boolean;
  counts: Record<string, number>;
  recent: RecoveryJob[];
};

type RecoveryResult = {
  external_id: string;
  status: string;
  error?: string;
};

type ApiResult = {
  ok?: boolean;
  error?: string;
  examined?: number;
  queued?: number;
  queuedOrAlreadyPresent?: number;
  nextCursor?: string | null;
  hasMorePotentially?: boolean;
  claimed?: number;
  results?: RecoveryResult[];
};

const ENDPOINT = "/api/admin/artwork-recovery";

async function adminRequest(
  method: "GET" | "POST",
  body?: Record<string, unknown>
): Promise<unknown> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (!session?.access_token) {
    throw new Error("Please log into MintRadar first.");
  }

  const response = await fetch(ENDPOINT, {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });

  const result: unknown = await response.json();

  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : `Request failed with HTTP ${response.status}`;

    throw new Error(message);
  }

  return result;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}

export default function ArtworkRecoveryTestPage() {
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [language, setLanguage] = useState("JP");
  const [setId, setSetId] = useState("");
  const [cursor, setCursor] = useState("");
  const [message, setMessage] = useState("");
  const [lastResult, setLastResult] = useState<ApiResult | null>(null);

  const refresh = useCallback(async () => {
    const result = (await adminRequest("GET")) as QueueStatus;

    if (!result.ok) {
      throw new Error("Admin access could not be verified.");
    }

    setQueue(result);
    setAuthorized(true);
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const result = (await adminRequest("GET")) as QueueStatus;

        if (!active) return;

        if (!result.ok) {
          throw new Error("Admin access could not be verified.");
        }

        setQueue(result);
        setAuthorized(true);
        setMessage("Admin access verified. Recovery queue is ready.");
      } catch (error) {
        if (!active) return;

        setAuthorized(false);
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to verify admin access."
        );
      } finally {
        if (active) setChecking(false);
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  async function perform(
    action: "check" | "enqueue" | "run"
  ) {
    if (busy) return;

    setBusy(true);
    setLastResult(null);

    try {
      if (action === "check") {
        await refresh();
        setMessage("Admin access verified. Queue refreshed.");
        return;
      }

      if (!authorized) {
        throw new Error("Admin access must be verified first.");
      }

      let body: Record<string, unknown>;

      if (action === "enqueue") {
        body = {
          action: "enqueue",
          language,
          limit: 3,
          ...(setId.trim() ? { setId: setId.trim() } : {}),
          ...(cursor ? { after: cursor } : {}),
        };
      } else {
        body = {
          action: "run",
          limit: 2,
        };
      }

      const result = (await adminRequest(
        "POST",
        body
      )) as ApiResult;

      setLastResult(result);

      if (action === "enqueue") {
        if (result.nextCursor) {
          setCursor(result.nextCursor);
        }

        setMessage(
          `Examined ${result.examined ?? 0} cards. ` +
          `${result.queuedOrAlreadyPresent ?? 0} queued or already present.`
        );
      } else {
        const summary = (result.results ?? [])
          .map((item) => `${item.external_id}: ${item.status}`)
          .join(" | ");

        setMessage(
          `Claimed ${result.claimed ?? 0} recovery jobs.` +
          (summary ? ` ${summary}` : "")
        );
      }

      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred."
      );
    } finally {
      setBusy(false);
    }
  }

  const counts = queue?.counts ?? {};

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-10 text-white">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">
            MintRadar / Developer Tools
          </p>

          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Artwork Recovery
          </h1>

          <p className="max-w-3xl text-sm leading-6 text-zinc-400">
            Temporary admin test interface. Discover missing Pokémon
            artwork in controlled batches without modifying existing
            catalog images or vintage approvals.
          </p>
        </header>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">
                Admin authorization
              </h2>

              <p className="mt-1 text-sm text-zinc-400">
                {checking
                  ? "Checking your MintRadar session..."
                  : authorized
                  ? "Authenticated admin session verified."
                  : "Admin access has not been verified."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void perform("check")}
              disabled={busy || checking}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            >
              {busy ? "Working..." : "Check Admin Access"}
            </button>
          </div>
        </section>

        {authorized && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ["Pending", counts.pending ?? 0],
                ["Processing", counts.processing ?? 0],
                ["Resolved", counts.resolved ?? 0],
                ["Unresolved", counts.unresolved ?? 0],
                ["Failed", counts.failed ?? 0],
              ].map(([label, count]) => (
                <div
                  key={String(label)}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
                >
                  <p className="text-xs text-zinc-400">
                    {label}
                  </p>

                  <p className="mt-2 text-2xl font-bold">
                    {count}
                  </p>
                </div>
              ))}
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                <div>
                  <h2 className="text-lg font-semibold">
                    Queue missing artwork
                  </h2>

                  <p className="mt-1 text-sm text-zinc-400">
                    Add up to three missing-image cards.
                    Existing recovery jobs are preserved.
                  </p>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="recovery-language"
                    className="block text-sm text-zinc-300"
                  >
                    Language
                  </label>

                  <select
                    id="recovery-language"
                    value={language}
                    onChange={(event) => {
                      setLanguage(event.target.value);
                      setCursor("");
                    }}
                    disabled={busy}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                  >
                    <option value="JP">Japanese</option>
                    <option value="EN">English</option>
                    <option value="CN">Chinese</option>
                    <option value="CN-TW">Traditional Chinese</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="recovery-set"
                    className="block text-sm text-zinc-300"
                  >
                    Set ID (optional)
                  </label>

                  <input
                    id="recovery-set"
                    type="text"
                    value={setId}
                    onChange={(event) => {
                      setSetId(event.target.value);
                      setCursor("");
                    }}
                    disabled={busy}
                    placeholder="Example: S8b"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => void perform("enqueue")}
                  disabled={busy}
                  className="w-full rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
                >
                  {busy ? "Working..." : "Queue 3 Cards"}
                </button>

                <p className="text-xs text-zinc-500">
                  Cursor: {cursor || "Start of selection"}
                </p>

                {cursor && (
                  <button
                    type="button"
                    onClick={() => setCursor("")}
                    disabled={busy}
                    className="text-xs font-medium text-zinc-300 underline"
                  >
                    Reset queue cursor
                  </button>
                )}
              </div>

              <div className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
                <div>
                  <h2 className="text-lg font-semibold">
                    Run recovery
                  </h2>

                  <p className="mt-1 text-sm text-zinc-400">
                    Process up to two pending jobs using
                    the existing Pokémon image resolver.
                  </p>
                </div>

                <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-sm leading-6 text-amber-200">
                  This test does not publish recovered artwork
                  to the catalog. Identity verification and
                  commercial rights clearance remain separate.
                </div>

                <button
                  type="button"
                  onClick={() => void perform("run")}
                  disabled={busy || (counts.pending ?? 0) === 0}
                  className="w-full rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-40"
                >
                  {busy ? "Processing..." : "Run 2 Recoveries"}
                </button>

                <button
                  type="button"
                  onClick={() => void perform("check")}
                  disabled={busy}
                  className="w-full rounded-lg border border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-200 disabled:opacity-40"
                >
                  Refresh Queue
                </button>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <h2 className="text-lg font-semibold">
                Recent recovery jobs
              </h2>

              {!queue?.recent?.length ? (
                <p className="text-sm text-zinc-400">
                  No recovery jobs have been queued yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-700 text-zinc-400">
                        <th className="py-3 pr-4">Card</th>
                        <th className="py-3 pr-4">Set</th>
                        <th className="py-3 pr-4">Status</th>
                        <th className="py-3 pr-4">Attempts</th>
                        <th className="py-3 pr-4">Discovery</th>
                        <th className="py-3">Updated</th>
                      </tr>
                    </thead>

                    <tbody>
                      {queue.recent.map((job) => (
                        <tr
                          key={job.id}
                          className="border-b border-zinc-800 align-top"
                        >
                          <td className="py-3 pr-4">
                            <div className="font-medium">
                              {job.card_name || job.external_id}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {job.external_id}
                            </div>
                          </td>

                          <td className="py-3 pr-4 text-zinc-300">
                            {job.set_id || "—"}
                            {job.card_number
                              ? ` / ${job.card_number}`
                              : ""}
                          </td>

                          <td className="py-3 pr-4">
                            {job.status}
                          </td>

                          <td className="py-3 pr-4">
                            {job.attempts}
                          </td>

                          <td className="py-3 pr-4">
                            {job.discovered_image_url ? (
                              <a
                                href={job.discovered_image_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-emerald-400 underline"
                              >
                                View candidate
                              </a>
                            ) : (
                              <span className="text-zinc-500">
                                {job.last_error || "—"}
                              </span>
                            )}

                            {job.discovered_source && (
                              <div className="mt-1 text-xs text-zinc-500">
                                {job.discovered_source}
                              </div>
                            )}
                          </td>

                          <td className="py-3 text-xs text-zinc-400">
                            {formatDate(job.updated_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        <section
          aria-live="polite"
          className="rounded-xl border border-zinc-800 bg-zinc-900 p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Latest result
          </p>

          <p className="mt-2 whitespace-pre-wrap text-sm">
            {message || "Waiting for the first test."}
          </p>

          {lastResult && (
            <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          )}
        </section>
      </div>
    </main>
  );
}
