"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type VendorProfile = {
  id: string;
  business_name?: string | null;
  instagram?: string | null;
  bio?: string | null;
};

export default function VendorAccountPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [bio, setBio] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadVendorAccount() {
      try {
        setLoading(true);
        setError("");

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        const user = session?.user ?? null;

        if (!user) {
          window.location.assign("/vendor/login");
          return;
        }

        const {
          data: membership,
          error: membershipError,
        } = await supabase
          .from("vendor_members")
          .select("vendor_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (membershipError) throw membershipError;

        if (!membership?.vendor_id) {
          throw new Error(
            "Your account is not connected to a MintRadar vendor."
          );
        }

        const {
          data: vendor,
          error: vendorError,
        } = await supabase
          .from("vendors")
          .select("id, business_name, instagram, bio")
          .eq("id", membership.vendor_id)
          .single();

        if (vendorError) throw vendorError;

        const profile = vendor as VendorProfile;

        if (!cancelled) {
          setVendorId(profile.id);
          setEmail(user.email || "");
          setBusinessName(profile.business_name || "");
          setInstagram(profile.instagram || "");
          setBio(profile.bio || "");
        }
      } catch (err: any) {
        console.error("Vendor account load error:", err);

        if (!cancelled) {
          setError(
            err?.message ||
              "MintRadar could not load your vendor profile."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadVendorAccount();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!vendorId || saving) return;

    const cleanBusinessName = businessName.trim();

    if (!cleanBusinessName) {
      setError("Business name is required.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const { error: updateError } = await supabase
        .from("vendors")
        .update({
          business_name: cleanBusinessName,
          instagram: instagram.trim() || null,
          bio: bio.trim() || null,
        })
        .eq("id", vendorId);

      if (updateError) throw updateError;

      setBusinessName(cleanBusinessName);
      setMessage("Vendor profile updated.");
    } catch (err: any) {
      console.error("Vendor account update error:", err);

      setError(
        err?.message ||
          "MintRadar could not update your vendor profile."
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
            Mint<span className="text-emerald-400">Radar</span>
          </Link>

          <p className="mt-3 text-sm text-zinc-500">
            Manage your MintRadar vendor profile
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="border-b border-zinc-800 px-6 py-5 sm:px-8">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Vendor Account
            </p>

            <h1 className="mt-2 text-3xl font-black sm:text-4xl">
              Profile / Account
            </h1>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Keep your public business information current across
              MintRadar.
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-zinc-500">
              Loading vendor account...
            </div>
          ) : error && !vendorId ? (
            <div className="p-6 sm:p-8">
              <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleSave}
              className="space-y-6 p-6 sm:p-8"
            >
              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                  Business Name
                </label>

                <input
                  type="text"
                  value={businessName}
                  onChange={(event) =>
                    setBusinessName(event.target.value)
                  }
                  autoComplete="organization"
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                  placeholder="Your business name"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                  Account Email
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
                  Instagram
                </label>

                <input
                  type="text"
                  value={instagram}
                  onChange={(event) =>
                    setInstagram(event.target.value)
                  }
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                  placeholder="@yourbusiness"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                  Bio
                </label>

                <textarea
                  value={bio}
                  onChange={(event) =>
                    setBio(event.target.value)
                  }
                  rows={5}
                  className="w-full resize-none rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                  placeholder="Tell collectors about your business..."
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
                  {saving ? "Saving..." : "Save Vendor Profile"}
                </button>

                <Link
                  href="/vendor"
                  className="rounded-xl border border-zinc-800 px-5 py-3 font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  Vendor Dashboard
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
