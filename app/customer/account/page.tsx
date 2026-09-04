"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type ProfileMetadata = {
  full_name?: string | null;
  phone?: string | null;
  [key: string]: unknown;
};

export default function CustomerAccountPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
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
          (user.user_metadata || {}) as ProfileMetadata;

        if (!cancelled) {
          setEmail(user.email || "");
          setFullName(
            typeof metadata.full_name === "string"
              ? metadata.full_name
              : ""
          );
          setPhone(
            typeof metadata.phone === "string"
              ? metadata.phone
              : ""
          );
        }
      } catch (err: any) {
        console.error("Customer account load error:", err);

        if (!cancelled) {
          setError(
            err?.message ||
              "MintRadar could not load your account."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAccount();

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
        (user.user_metadata || {}) as ProfileMetadata;

      const { error: updateError } =
        await supabase.auth.updateUser({
          data: {
            ...existingMetadata,
            full_name: fullName.trim() || null,
            phone: phone.trim() || null,
          },
        });

      if (updateError) throw updateError;

      setMessage("Profile updated.");
    } catch (err: any) {
      console.error("Customer account update error:", err);

      setError(
        err?.message ||
          "MintRadar could not update your profile."
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
            Manage your MintRadar customer profile
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="border-b border-zinc-800 px-6 py-5 sm:px-8">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Customer Account
            </p>

            <h1 className="mt-2 text-3xl font-black sm:text-4xl">
              Profile / Account
            </h1>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Keep your contact details current for future
              marketplace purchases and order updates.
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-zinc-500">
              Loading account...
            </div>
          ) : (
            <form
              onSubmit={handleSave}
              className="space-y-6 p-6 sm:p-8"
            >
              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                  Full Name
                </label>

                <input
                  type="text"
                  value={fullName}
                  onChange={(event) =>
                    setFullName(event.target.value)
                  }
                  autoComplete="name"
                  placeholder="Your name"
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                  Email
                </label>

                <input
                  type="email"
                  value={email}
                  readOnly
                  className="w-full cursor-not-allowed rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-500"
                />

                <p className="mt-2 text-xs text-zinc-600">
                  Email changes are not enabled in Account V1.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                  Phone
                </label>

                <input
                  type="tel"
                  value={phone}
                  onChange={(event) =>
                    setPhone(event.target.value)
                  }
                  autoComplete="tel"
                  placeholder="Optional"
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                />
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
                    : "Save Profile"}
                </button>

                <Link
                  href="/wishlist"
                  className="rounded-xl border border-zinc-800 px-5 py-3 font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  ♡ View Wishlist
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
