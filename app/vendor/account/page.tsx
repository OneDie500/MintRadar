"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

type VendorProfile = {
  id: string;
  business_name?: string | null;
  instagram?: string | null;
  bio?: string | null;
  logo_url?: string | null;
  location?: string | null;
  phone?: string | null;
};

const LOGO_BUCKET = "vendor-logos";
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

function getFileExtension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();

  if (fromName && /^[a-z0-9]+$/.test(fromName)) {
    return fromName;
  }

  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/webp") return "webp";

  return "png";
}

export default function VendorAccountPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
          .select(
            "id, business_name, instagram, bio, logo_url, location, phone"
          )
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
          setLocation(profile.location || "");
          setPhone(profile.phone || "");
          setLogoUrl(profile.logo_url || null);
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

  async function handleLogoUpload(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file || !vendorId || logoBusy) return;

    setMessage("");
    setError("");

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for your vendor logo.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      setError("Vendor logos must be 5 MB or smaller.");
      event.target.value = "";
      return;
    }

    setLogoBusy(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session?.user) {
        window.location.assign("/vendor/login");
        return;
      }

      const extension = getFileExtension(file);
      const objectPath = `${vendorId}/logo.${extension}`;

      console.log("LOGO UPLOAD DEBUG", {
        vendorId,
        objectPath,
        bucket: LOGO_BUCKET,
        userId: session.user.id,
      });

      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(objectPath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage
        .from(LOGO_BUCKET)
        .getPublicUrl(objectPath);

      const cacheBustedUrl = `${publicUrl}?v=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("vendors")
        .update({
          logo_url: cacheBustedUrl,
        })
        .eq("id", vendorId);

      if (updateError) throw updateError;

      setLogoUrl(cacheBustedUrl);
      setMessage(
        "Vendor logo uploaded. The Vendor Logo label-branding option is now available."
      );
    } catch (err: any) {
      console.error("Vendor logo upload error:", err);

      setError(
        err?.message ||
          "MintRadar could not upload your vendor logo."
      );
    } finally {
      setLogoBusy(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleRemoveLogo() {
    if (!vendorId || !logoUrl || logoBusy) return;

    const okay = window.confirm(
      "Remove this vendor logo? Label printing will fall back to the business name."
    );

    if (!okay) return;

    setLogoBusy(true);
    setMessage("");
    setError("");

    try {
      const { error: updateError } = await supabase
        .from("vendors")
        .update({
          logo_url: null,
          label_branding_mode: "business_name",
        })
        .eq("id", vendorId);

      if (updateError) throw updateError;

      const marker = `/${LOGO_BUCKET}/`;
      const cleanUrl = logoUrl.split("?")[0];
      const markerIndex = cleanUrl.indexOf(marker);

      if (markerIndex >= 0) {
        const encodedPath = cleanUrl.slice(
          markerIndex + marker.length
        );

        const objectPath = decodeURIComponent(encodedPath);

        const { error: removeError } = await supabase.storage
          .from(LOGO_BUCKET)
          .remove([objectPath]);

        if (removeError) {
          console.warn(
            "Vendor logo record was cleared, but the old storage object could not be removed:",
            removeError
          );
        }
      }

      setLogoUrl(null);
      setMessage(
        "Vendor logo removed. Label branding was returned to Business Name."
      );
    } catch (err: any) {
      console.error("Vendor logo removal error:", err);

      setError(
        err?.message ||
          "MintRadar could not remove your vendor logo."
      );
    } finally {
      setLogoBusy(false);
    }
  }

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
          location: location.trim() || null,
          phone: phone.trim() || null,
        })
        .eq("id", vendorId);

      if (updateError) throw updateError;

      setBusinessName(cleanBusinessName);
      setInstagram(instagram.trim());
      setBio(bio.trim());
      setLocation(location.trim());
      setPhone(phone.trim());
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
                  Vendor Logo
                </label>

                <div className="rounded-2xl border border-zinc-800 bg-black p-5">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="flex h-28 w-full items-center justify-center overflow-hidden rounded-2xl border border-zinc-800 bg-white p-4 sm:w-44">
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt={`${businessName || "Vendor"} logo`}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-center text-xs font-black uppercase tracking-[0.12em] text-zinc-400">
                          No Logo Uploaded
                        </span>
                      )}
                    </div>

                    <div className="flex-1">
                      <p className="font-black text-white">
                        Business Logo
                      </p>

                      <p className="mt-1 text-sm leading-6 text-zinc-500">
                        Upload the logo MintRadar can use on your
                        thermal labels and vendor profile.
                      </p>

                      <p className="mt-1 text-xs text-zinc-600">
                        PNG, JPG, or WebP recommended. Maximum 5 MB.
                        High-contrast artwork works best for thermal
                        printing.
                      </p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleLogoUpload}
                          disabled={logoBusy}
                          className="hidden"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            fileInputRef.current?.click()
                          }
                          disabled={logoBusy}
                          className="rounded-xl bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {logoBusy
                            ? "Working..."
                            : logoUrl
                              ? "Replace Logo"
                              : "Upload Logo"}
                        </button>

                        {logoUrl && (
                          <button
                            type="button"
                            onClick={handleRemoveLogo}
                            disabled={logoBusy}
                            className="rounded-xl border border-red-400/30 px-4 py-2 text-sm font-black text-red-300 transition hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Remove Logo
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

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

              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                    Location
                  </label>

                  <input
                    type="text"
                    value={location}
                    onChange={(event) =>
                      setLocation(event.target.value)
                    }
                    autoComplete="address-level2"
                    className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                    placeholder="Albuquerque, NM"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                    Phone Number
                  </label>

                  <input
                    type="tel"
                    value={phone}
                    onChange={(event) =>
                      setPhone(event.target.value)
                    }
                    autoComplete="tel"
                    className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                    placeholder="(505) 555-0123"
                  />
                </div>
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
                  disabled={saving || logoBusy}
                  className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save Vendor Profile"}
                </button>

                <Link
                  href="/vendor/settings"
                  className="rounded-xl border border-zinc-800 px-5 py-3 font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  Label Branding Settings
                </Link>

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