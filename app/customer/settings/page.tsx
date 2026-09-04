"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type SettingsMetadata = {
  wishlist_updates?: boolean;
  order_updates?: boolean;
  [key: string]: unknown;
};

export default function CustomerSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wishlistUpdates, setWishlistUpdates] = useState(true);
  const [orderUpdates, setOrderUpdates] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        const user = session?.user ?? null;

        if (!user) {
          window.location.assign("/customer/login");
          return;
        }

        const metadata =
          (user.user_metadata || {}) as SettingsMetadata;

        if (!cancelled) {
          setWishlistUpdates(
            typeof metadata.wishlist_updates === "boolean"
              ? metadata.wishlist_updates
              : true
          );

          setOrderUpdates(
            typeof metadata.order_updates === "boolean"
              ? metadata.order_updates
              : true
          );
        }
      } catch (err: any) {
        console.error("Customer settings load error:", err);

        if (!cancelled) {
          setError(
            err?.message ||
              "MintRadar could not load your settings."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (saving) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = session?.user ?? null;

      if (!user) {
        window.location.assign("/customer/login");
        return;
      }

      const existingMetadata =
        (user.user_metadata || {}) as SettingsMetadata;

      const { error: updateError } =
        await supabase.auth.updateUser({
          data: {
            ...existingMetadata,
            wishlist_updates: wishlistUpdates,
            order_updates: orderUpdates,
          },
        });

      if (updateError) throw updateError;

      setMessage("Settings saved.");
    } catch (err: any) {
      console.error("Customer settings update error:", err);

      setError(
        err?.message ||
          "MintRadar could not update your settings."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-block text-3xl font-black tracking-tight"
          >
            Mint
            <span className="text-emerald-400">
              Radar
            </span>
          </Link>

          <p className="mt-3 text-sm text-zinc-500">
            Manage your MintRadar preferences
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="border-b border-zinc-800 px-6 py-5 sm:px-8">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Customer Settings
            </p>

            <h1 className="mt-2 text-3xl font-black sm:text-4xl">
              Settings
            </h1>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Save your communication preferences now.
              MintRadar&apos;s notification delivery system will
              use these preferences once notifications go live.
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-zinc-500">
              Loading settings...
            </div>
          ) : (
            <form
              onSubmit={handleSave}
              className="space-y-6 p-6 sm:p-8"
            >
              <label className="flex cursor-pointer items-start justify-between gap-5 rounded-2xl border border-zinc-800 bg-black p-5">
                <div>
                  <p className="font-black">
                    Wishlist updates
                  </p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">
                    Preference for future alerts when cards
                    you&apos;re hunting for have relevant
                    marketplace activity.
                  </p>
                </div>

                <input
                  type="checkbox"
                  checked={wishlistUpdates}
                  onChange={(event) =>
                    setWishlistUpdates(event.target.checked)
                  }
                  className="mt-1 h-5 w-5 accent-emerald-400"
                />
              </label>

              <label className="flex cursor-pointer items-start justify-between gap-5 rounded-2xl border border-zinc-800 bg-black p-5">
                <div>
                  <p className="font-black">
                    Order updates
                  </p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">
                    Preference for future order status and
                    pickup notifications.
                  </p>
                </div>

                <input
                  type="checkbox"
                  checked={orderUpdates}
                  onChange={(event) =>
                    setOrderUpdates(event.target.checked)
                  }
                  className="mt-1 h-5 w-5 accent-emerald-400"
                />
              </label>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                <p className="text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                  Account V1 Note
                </p>

                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  These settings are saved to your account today.
                  They do not send emails or push notifications yet.
                </p>
              </div>

              {error && (
                <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              {message && (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-400">
                  {message}
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving
                    ? "Saving..."
                    : "Save Settings"}
                </button>

                <Link
                  href="/customer/account"
                  className="rounded-xl border border-zinc-800 px-5 py-3 font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  Profile / Account
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
