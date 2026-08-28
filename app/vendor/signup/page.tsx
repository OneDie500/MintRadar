"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function VendorSignup() {
  const router = useRouter();

  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [instagram, setInstagram] = useState("");
  const [bio, setBio] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSignup(event: React.FormEvent) {
    event.preventDefault();

    setMessage("");
    setErrorMessage("");

    if (!businessName.trim()) {
      setErrorMessage("Please enter your business name.");
      return;
    }

    if (!email.trim()) {
      setErrorMessage("Please enter your email.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (signupError) {
        throw signupError;
      }

      const user = data.user;

      if (!user) {
        setMessage(
          "Account created. Please check your email to confirm your account before logging in."
        );
        setLoading(false);
        return;
      }

      const { error: vendorError } = await supabase
        .from("vendors")
        .insert({
          user_id: user.id,
          business_name: businessName.trim(),
          instagram: instagram.trim() || null,
          bio: bio.trim() || null,
          status: "pending",
        });

      if (vendorError) {
        throw vendorError;
      }

      if (data.session) {
        router.push("/vendor");
        return;
      }

      setMessage(
        "Vendor account created! Please check your email to confirm your account, then log in."
      );

      setBusinessName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setInstagram("");
      setBio("");
    } catch (error: any) {
      console.error("Vendor signup error:", error);

      setErrorMessage(
        error?.message || "Something went wrong while creating your account."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <p className="text-emerald-400 text-xs uppercase tracking-[0.25em] font-bold mb-3">
            MintRadar Vendor Portal
          </p>

          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
            Create Vendor Account
          </h1>

          <p className="text-zinc-500 mt-3">
            Set up your vendor profile and start building your MintRadar inventory.
          </p>
        </div>

        <form
          onSubmit={handleSignup}
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
                onChange={(event) => setBusinessName(event.target.value)}
                placeholder="OnlySlabs"
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-bold mb-2">
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-bold mb-2">
                Confirm Password
              </label>

              <input
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                placeholder="Enter password again"
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-bold mb-2">
                Instagram
                <span className="text-zinc-600 font-normal">
                  {" "}Optional
                </span>
              </label>

              <input
                type="text"
                value={instagram}
                onChange={(event) => setInstagram(event.target.value)}
                placeholder="@yourshop"
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-bold mb-2">
                Vendor Bio
                <span className="text-zinc-600 font-normal">
                  {" "}Optional
                </span>
              </label>

              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                placeholder="Tell customers a little about your shop..."
                rows={4}
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition resize-none"
              />
            </div>

            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4 text-sm">
                {errorMessage}
              </div>
            )}

            {message && (
              <div className="bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 rounded-xl p-4 text-sm">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-400 hover:bg-emerald-300 disabled:bg-zinc-700 disabled:text-zinc-400 text-black font-black rounded-xl px-5 py-4 transition"
            >
              {loading ? "Creating Account..." : "Create Vendor Account"}
            </button>
          </div>
        </form>

        <div className="text-center mt-6">
          <p className="text-zinc-500 text-sm">
            Already have a vendor account?
          </p>

          <Link
            href="/vendor/login"
            className="inline-block text-emerald-400 font-bold mt-1 hover:text-emerald-300 transition"
          >
            Log In
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