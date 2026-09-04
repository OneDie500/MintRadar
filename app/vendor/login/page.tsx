"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

type SetupMode = "create" | "repair" | null;

export default function VendorLogin() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [setupMode, setSetupMode] =
    useState<SetupMode>(null);

  const [pendingUserId, setPendingUserId] =
    useState<string | null>(null);

  const [pendingVendorId, setPendingVendorId] =
    useState<string | null>(null);

  const [businessName, setBusinessName] =
    useState("");

  const [instagram, setInstagram] =
    useState("");

  const [bio, setBio] =
    useState("");

  async function verifyMembership(
    vendorId: string,
    userId: string
  ) {
    const {
      data: membership,
      error: membershipError,
    } = await supabase
      .from("vendor_members")
      .select("vendor_id, user_id, role")
      .eq("vendor_id", vendorId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      console.error(
        "Vendor membership verification error:",
        {
          message: membershipError.message,
          details: membershipError.details,
          hint: membershipError.hint,
          code: membershipError.code,
        }
      );

      throw new Error(
        "MintRadar could not verify your vendor permissions."
      );
    }

    if (!membership) {
      throw new Error(
        "Your vendor account exists, but your vendor permissions are incomplete."
      );
    }

    return membership;
  }

  async function provisionVendor(
    userId: string,
    submittedBusinessName: string,
    submittedInstagram: string | null,
    submittedBio: string | null
  ) {
    const {
      data: vendorId,
      error: provisionError,
    } = await supabase.rpc(
      "create_vendor_account",
      {
        p_business_name: submittedBusinessName,
        p_instagram: submittedInstagram,
        p_bio: submittedBio,
      }
    );

    if (provisionError) {
      console.error(
        "Vendor provisioning error:",
        {
          message: provisionError.message,
          details: provisionError.details,
          hint: provisionError.hint,
          code: provisionError.code,
        }
      );

      throw new Error(
        "MintRadar could not finish setting up your vendor account."
      );
    }

    if (!vendorId) {
      throw new Error(
        "MintRadar could not verify your vendor account."
      );
    }

    await verifyMembership(
      vendorId,
      userId
    );

    return vendorId;
  }

  async function handleLogin(
    event: FormEvent
  ) {
    event.preventDefault();

    setErrorMessage("");

    if (!email.trim()) {
      setErrorMessage(
        "Please enter your email."
      );
      return;
    }

    if (!password) {
      setErrorMessage(
        "Please enter your password."
      );
      return;
    }

    setLoading(true);

    try {
      // --------------------------------------------------
      // 1) LOG USER IN
      // --------------------------------------------------

      const {
        data,
        error: loginError,
      } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (loginError) {
        console.error("Login error:", {
          message: loginError.message,
          status: loginError.status,
          name: loginError.name,
        });

        setErrorMessage(
          loginError.message
        );

        return;
      }

      const user = data.user;

      if (!user) {
        setErrorMessage(
          "Login succeeded, but no user account was returned."
        );
        return;
      }

      setPendingUserId(user.id);

      // --------------------------------------------------
      // 2) CHECK FOR AN EXISTING VENDOR MEMBERSHIP FIRST
      //
      // This is important.
      //
      // Existing vendors should NOT depend on Auth metadata
      // every time they log in.
      // --------------------------------------------------

      const {
        data: existingMemberships,
        error: membershipLookupError,
      } = await supabase
        .from("vendor_members")
        .select(
          "vendor_id, user_id, role"
        )
        .eq("user_id", user.id)
        .limit(1);

      if (membershipLookupError) {
        console.error(
          "Vendor membership lookup error:",
          {
            message:
              membershipLookupError.message,
            details:
              membershipLookupError.details,
            hint:
              membershipLookupError.hint,
            code:
              membershipLookupError.code,
          }
        );

        setErrorMessage(
          "MintRadar could not check your vendor permissions."
        );

        return;
      }

      const existingMembership =
        existingMemberships?.[0] || null;

      if (existingMembership) {
        const {
          data: existingVendor,
          error: vendorLookupError,
        } = await supabase
          .from("vendors")
          .select(
            "id, user_id, business_name, instagram, bio"
          )
          .eq(
            "id",
            existingMembership.vendor_id
          )
          .maybeSingle();

        if (vendorLookupError) {
          console.error(
            "Vendor lookup error:",
            {
              message:
                vendorLookupError.message,
              details:
                vendorLookupError.details,
              hint:
                vendorLookupError.hint,
              code:
                vendorLookupError.code,
            }
          );

          setErrorMessage(
            "MintRadar found your vendor account but could not load the vendor profile."
          );

          return;
        }

        if (!existingVendor) {
          setErrorMessage(
            "MintRadar found your vendor membership, but the vendor profile is missing."
          );

          return;
        }

        // ------------------------------------------------
        // LEGACY GENERIC VENDOR REPAIR
        //
        // Earlier onboarding could create:
        // "New MintRadar Vendor"
        //
        // If this user owns that vendor record, give them
        // the opportunity to repair it now.
        // ------------------------------------------------

        const genericVendorName =
          !existingVendor.business_name ||
          existingVendor.business_name
            .trim()
            .toLowerCase() ===
            "new mintradar vendor";

        const userOwnsVendor =
          existingVendor.user_id ===
          user.id;

        if (
          genericVendorName &&
          userOwnsVendor
        ) {
          const metadata =
            user.user_metadata || {};

          const metadataBusinessName =
            typeof metadata.business_name ===
              "string" &&
            metadata.business_name.trim()
              ? metadata.business_name.trim()
              : "";

          const metadataInstagram =
            typeof metadata.instagram ===
              "string" &&
            metadata.instagram.trim()
              ? metadata.instagram.trim()
              : "";

          const metadataBio =
            typeof metadata.bio ===
              "string" &&
            metadata.bio.trim()
              ? metadata.bio.trim()
              : "";

          setPendingVendorId(
            existingVendor.id
          );

          setBusinessName(
            metadataBusinessName
          );

          setInstagram(
            existingVendor.instagram ||
              metadataInstagram ||
              ""
          );

          setBio(
            existingVendor.bio ||
              metadataBio ||
              ""
          );

          setSetupMode("repair");

          return;
        }

        // Existing valid vendor.
        router.push("/vendor");
        router.refresh();

        return;
      }

      // --------------------------------------------------
      // 3) NO EXISTING VENDOR
      //
      // Try the vendor signup metadata.
      // --------------------------------------------------

      const metadata =
        user.user_metadata || {};

      const metadataBusinessName =
        typeof metadata.business_name ===
          "string" &&
        metadata.business_name.trim()
          ? metadata.business_name.trim()
          : "";

      const metadataInstagram =
        typeof metadata.instagram ===
          "string" &&
        metadata.instagram.trim()
          ? metadata.instagram.trim()
          : null;

      const metadataBio =
        typeof metadata.bio ===
          "string" &&
        metadata.bio.trim()
          ? metadata.bio.trim()
          : null;

      // --------------------------------------------------
      // 4) NORMAL VENDOR SIGNUP FLOW
      //
      // Business name exists in metadata, so provision
      // automatically.
      // --------------------------------------------------

      if (metadataBusinessName) {
        await provisionVendor(
          user.id,
          metadataBusinessName,
          metadataInstagram,
          metadataBio
        );

        router.push("/vendor");
        router.refresh();

        return;
      }

      // --------------------------------------------------
      // 5) NO VENDOR + NO BUSINESS NAME
      //
      // Do NOT silently create:
      // "New MintRadar Vendor"
      //
      // Instead, ask the authenticated user to complete
      // their vendor setup.
      // --------------------------------------------------

      setBusinessName("");
      setInstagram("");
      setBio("");
      setPendingVendorId(null);
      setSetupMode("create");
    } catch (error: any) {
      console.error(
        "Unexpected vendor login error:",
        {
          message: error?.message,
          name: error?.name,
          stack: error?.stack,
        }
      );

      setErrorMessage(
        error?.message ||
          "Unable to log in. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleVendorSetup(
    event: FormEvent
  ) {
    event.preventDefault();

    setErrorMessage("");

    if (!pendingUserId) {
      setErrorMessage(
        "Your login session could not be verified. Please log in again."
      );
      return;
    }

    if (!businessName.trim()) {
      setErrorMessage(
        "Please enter your business name."
      );
      return;
    }

    setLoading(true);

    try {
      const cleanBusinessName =
        businessName.trim();

      const cleanInstagram =
        instagram.trim() || null;

      const cleanBio =
        bio.trim() || null;

      // --------------------------------------------------
      // CREATE NEW VENDOR
      // --------------------------------------------------

      if (setupMode === "create") {
        await provisionVendor(
          pendingUserId,
          cleanBusinessName,
          cleanInstagram,
          cleanBio
        );

        // Also repair Auth metadata so future flows have
        // the vendor information available.
        const {
          error: metadataUpdateError,
        } =
          await supabase.auth.updateUser({
            data: {
              business_name:
                cleanBusinessName,
              instagram:
                cleanInstagram,
              bio: cleanBio,
            },
          });

        if (metadataUpdateError) {
          console.warn(
            "Vendor created, but Auth metadata could not be updated:",
            metadataUpdateError.message
          );
        }

        router.push("/vendor");
        router.refresh();

        return;
      }

      // --------------------------------------------------
      // REPAIR LEGACY GENERIC VENDOR
      // --------------------------------------------------

      if (
        setupMode === "repair" &&
        pendingVendorId
      ) {
        const {
          data: updatedVendor,
          error: vendorUpdateError,
        } = await supabase
          .from("vendors")
          .update({
            business_name:
              cleanBusinessName,
            instagram:
              cleanInstagram,
            bio: cleanBio,
          })
          .eq(
            "id",
            pendingVendorId
          )
          .eq(
            "user_id",
            pendingUserId
          )
          .select("id")
          .maybeSingle();

        if (vendorUpdateError) {
          console.error(
            "Vendor repair error:",
            {
              message:
                vendorUpdateError.message,
              details:
                vendorUpdateError.details,
              hint:
                vendorUpdateError.hint,
              code:
                vendorUpdateError.code,
            }
          );

          setErrorMessage(
            "MintRadar could not update your vendor profile."
          );

          return;
        }

        if (!updatedVendor) {
          setErrorMessage(
            "MintRadar could not verify ownership of this vendor profile."
          );

          return;
        }

        const {
          error: metadataUpdateError,
        } =
          await supabase.auth.updateUser({
            data: {
              business_name:
                cleanBusinessName,
              instagram:
                cleanInstagram,
              bio: cleanBio,
            },
          });

        if (metadataUpdateError) {
          console.warn(
            "Vendor repaired, but Auth metadata could not be updated:",
            metadataUpdateError.message
          );
        }

        router.push("/vendor");
        router.refresh();

        return;
      }

      setErrorMessage(
        "MintRadar could not determine how to finish your vendor setup."
      );
    } catch (error: any) {
      console.error(
        "Unexpected vendor setup error:",
        {
          message: error?.message,
          name: error?.name,
          stack: error?.stack,
        }
      );

      setErrorMessage(
        error?.message ||
          "Unable to finish your vendor setup."
      );
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------------------------------
  // COMPLETE / REPAIR VENDOR SETUP SCREEN
  // ----------------------------------------------------

  if (setupMode) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-xl">
          <div className="text-center mb-8">
            <p className="text-emerald-400 text-xs uppercase tracking-[0.25em] font-bold mb-3">
              MintRadar Vendor Portal
            </p>

            <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
              {setupMode === "repair"
                ? "Finish Your Vendor Profile"
                : "Complete Vendor Setup"}
            </h1>

            <p className="text-zinc-500 mt-3">
              {setupMode === "repair"
                ? "We found your vendor account, but it still needs your real business information."
                : "You're logged in. We just need your vendor information before opening the dashboard."}
            </p>
          </div>

          <form
            onSubmit={handleVendorSetup}
            className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 sm:p-8"
          >
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold mb-2">
                  Business Name
                </label>

                <input
                  type="text"
                  value={businessName}
                  onChange={(event) =>
                    setBusinessName(
                      event.target.value
                    )
                  }
                  placeholder="OnlySlabs"
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-2">
                  Instagram
                  <span className="text-zinc-600 font-normal">
                    {" "}
                    (optional)
                  </span>
                </label>

                <input
                  type="text"
                  value={instagram}
                  onChange={(event) =>
                    setInstagram(
                      event.target.value
                    )
                  }
                  placeholder="@yourbusiness"
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
                />
              </div>

              <div>
                <label className="block text-sm font-bold mb-2">
                  Bio
                  <span className="text-zinc-600 font-normal">
                    {" "}
                    (optional)
                  </span>
                </label>

                <textarea
                  value={bio}
                  onChange={(event) =>
                    setBio(
                      event.target.value
                    )
                  }
                  placeholder="Tell customers a little about your business."
                  rows={4}
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition resize-none"
                />
              </div>

              {errorMessage && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4 text-sm">
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-400 hover:bg-emerald-300 disabled:bg-zinc-700 disabled:text-zinc-400 text-black font-black rounded-xl px-5 py-4 transition"
              >
                {loading
                  ? "Saving..."
                  : setupMode ===
                      "repair"
                    ? "Save Vendor Profile"
                    : "Create Vendor Profile"}
              </button>
            </div>
          </form>

          <div className="text-center mt-5">
            <Link
              href="/"
              className="text-zinc-600 text-sm hover:text-zinc-400 transition"
            >
              ← Back to MintRadar
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ----------------------------------------------------
  // NORMAL LOGIN SCREEN
  // ----------------------------------------------------

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <p className="text-emerald-400 text-xs uppercase tracking-[0.25em] font-bold mb-3">
            MintRadar Vendor Portal
          </p>

          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
            Vendor Login
          </h1>

          <p className="text-zinc-500 mt-3">
            Manage your inventory,
            profile, and listings.
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 sm:p-8"
        >
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-bold mb-2">
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value
                  )
                }
                placeholder="vendor@example.com"
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-bold mb-2">
                Password
              </label>

              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(
                    event.target.value
                  )
                }
                placeholder="Enter your password"
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
              />
            </div>

            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4 text-sm">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-400 hover:bg-emerald-300 disabled:bg-zinc-700 disabled:text-zinc-400 text-black font-black rounded-xl px-5 py-4 transition"
            >
              {loading
                ? "Logging In..."
                : "Log In"}
            </button>
          </div>
        </form>

        <div className="text-center mt-6">
          <p className="text-zinc-500 text-sm">
            Need a vendor account?
          </p>

          <Link
            href="/vendor/signup"
            className="inline-block text-emerald-400 font-bold mt-1 hover:text-emerald-300 transition"
          >
            Create Vendor Account
          </Link>
        </div>

        <div className="text-center mt-5">
          <Link
            href="/"
            className="text-zinc-600 text-sm hover:text-zinc-400 transition"
          >
            ← Back to MintRadar
          </Link>
        </div>
      </div>
    </main>
  );
}