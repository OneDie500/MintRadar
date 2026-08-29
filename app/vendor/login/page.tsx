"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function VendorLogin() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();

    setErrorMessage("");

    if (!email.trim()) {
      setErrorMessage("Please enter your email.");
      return;
    }

    if (!password) {
      setErrorMessage("Please enter your password.");
      return;
    }

    setLoading(true);

    try {
      // 1) LOG USER IN
      const { data, error: loginError } =
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

        setErrorMessage(loginError.message);
        return;
      }

      const user = data.user;

      if (!user) {
        setErrorMessage(
          "Login succeeded, but no user account was returned."
        );
        return;
      }

      // 2) PROVISION OR REPAIR THIS USER'S VENDOR ACCOUNT
      //
      // create_vendor_account() is SECURITY DEFINER and uses auth.uid()
      // internally, so the browser never decides which user owns the vendor.
      const metadata = user.user_metadata || {};

      const businessName =
        typeof metadata.business_name === "string" &&
        metadata.business_name.trim()
          ? metadata.business_name.trim()
          : "New MintRadar Vendor";

      const instagram =
        typeof metadata.instagram === "string" &&
        metadata.instagram.trim()
          ? metadata.instagram.trim()
          : null;

      const bio =
        typeof metadata.bio === "string" &&
        metadata.bio.trim()
          ? metadata.bio.trim()
          : null;

      const {
        data: vendorId,
        error: provisionError,
      } = await supabase.rpc(
        "create_vendor_account",
        {
          p_business_name: businessName,
          p_instagram: instagram,
          p_bio: bio,
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

        setErrorMessage(
          "You logged in, but MintRadar could not finish setting up your vendor account."
        );

        return;
      }

      if (!vendorId) {
        setErrorMessage(
          "You logged in, but MintRadar could not verify your vendor account."
        );
        return;
      }

      // 3) VERIFY THE MEMBERSHIP EXISTS
      //
      // This makes onboarding failures obvious instead of sending a user
      // into the dashboard with a half-created vendor account.
      const {
        data: membership,
        error: membershipError,
      } = await supabase
        .from("vendor_members")
        .select("vendor_id, user_id, role")
        .eq("vendor_id", vendorId)
        .eq("user_id", user.id)
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

        setErrorMessage(
          "Your vendor account was created, but MintRadar could not verify your permissions."
        );

        return;
      }

      if (!membership) {
        setErrorMessage(
          "Your vendor account was created, but your vendor permissions are incomplete."
        );
        return;
      }

      // 4) EVERYTHING GOOD
      router.push("/vendor");
      router.refresh();
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
            Manage your inventory, profile, and listings.
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
                  setEmail(event.target.value)
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
                  setPassword(event.target.value)
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
