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
      // LOG USER IN
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

      // CHECK FOR EXISTING VENDOR PROFILE
      const { data: existingVendor, error: vendorLookupError } =
        await supabase
          .from("vendors")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();

      if (vendorLookupError) {
        console.error("Vendor lookup error:", {
          message: vendorLookupError.message,
          details: vendorLookupError.details,
          hint: vendorLookupError.hint,
          code: vendorLookupError.code,
        });

        setErrorMessage(
          "You logged in, but MintRadar could not load your vendor profile."
        );

        return;
      }

      // CREATE PROFILE IF THIS USER DOES NOT HAVE ONE
      if (!existingVendor) {
        const metadata = user.user_metadata || {};

        const { error: createVendorError } = await supabase
          .from("vendors")
          .insert({
            user_id: user.id,
            business_name:
              metadata.business_name || "New MintRadar Vendor",
            instagram:
              metadata.instagram || null,
            bio:
              metadata.bio || null,
            status: "pending",
          });

        if (createVendorError) {
          console.error("Vendor profile creation error:", {
            message: createVendorError.message,
            details: createVendorError.details,
            hint: createVendorError.hint,
            code: createVendorError.code,
          });

          setErrorMessage(
            "You logged in, but MintRadar could not create your vendor profile."
          );

          return;
        }
      }

      // EVERYTHING GOOD
      router.push("/vendor");

    } catch (error: any) {
      console.error("Unexpected vendor login error:", {
        message: error?.message,
        name: error?.name,
        stack: error?.stack,
      });

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
              {loading ? "Logging In..." : "Log In"}
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