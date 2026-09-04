"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

export default function VendorJoinPage() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      setSignedIn(Boolean(session?.user));
      setEmail(session?.user?.email || "");
      setLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      setSignedIn(Boolean(session?.user));
      setEmail(session?.user?.email || "");
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleJoin(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!signedIn || joining) return;

    const code = accessCode.trim().toUpperCase();

    if (!code) {
      setError("Enter the vendor access code.");
      return;
    }

    setJoining(true);
    setError("");
    setMessage("");

    try {
      const { error: redeemError } = await supabase.rpc(
        "redeem_vendor_invite_code",
        {
          p_access_code: code,
        }
      );

      if (redeemError) throw redeemError;

      setMessage(
        "Access granted! Redirecting to the shared vendor dashboard..."
      );

      window.setTimeout(() => {
        window.location.assign("/vendor");
      }, 700);
    } catch (err: any) {
      console.error("Vendor invite redemption error:", err);

      setError(
        err?.message ||
          "MintRadar could not redeem this access code."
      );
    } finally {
      setJoining(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white sm:px-6">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8 text-center">
          <Link
            href="/"
            className="inline-block text-3xl font-black tracking-tight"
          >
            Mint<span className="text-emerald-400">Radar</span>
          </Link>

          <p className="mt-3 text-sm text-zinc-500">
            Join an existing vendor team
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="border-b border-zinc-800 px-6 py-6">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Team Access
            </p>

            <h1 className="mt-2 text-3xl font-black">
              Join Shared Inventory
            </h1>

            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Use your own MintRadar login and the access code
              provided by the vendor owner. Your account stays
              separate while the team shares one vendor inventory.
            </p>
          </div>

          <div className="p-6">
            {loading ? (
              <p className="text-zinc-500">
                Checking your account...
              </p>
            ) : !signedIn ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-zinc-800 bg-black p-5">
                  <p className="font-black">
                    Sign in first
                  </p>

                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Team access is attached to your personal
                    MintRadar account, so you need to be logged in
                    before redeeming the code.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Link
                    href="/customer/login"
                    className="rounded-xl bg-emerald-400 px-4 py-3 text-center font-black text-black transition hover:bg-emerald-300"
                  >
                    Log In
                  </Link>

                  <Link
                    href="/customer/signup"
                    className="rounded-xl border border-zinc-800 px-4 py-3 text-center font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
                  >
                    Create Account
                  </Link>
                </div>

                <p className="text-center text-xs text-zinc-600">
                  After signing in, return to /vendor/join and
                  enter the access code.
                </p>
              </div>
            ) : (
              <form
                onSubmit={handleJoin}
                className="space-y-5"
              >
                <div className="rounded-2xl border border-zinc-800 bg-black p-4">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-zinc-600">
                    Signed In As
                  </p>

                  <p className="mt-1 font-bold text-zinc-200">
                    {email || "MintRadar account"}
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                    Vendor Access Code
                  </label>

                  <input
                    type="text"
                    value={accessCode}
                    onChange={(event) =>
                      setAccessCode(
                        event.target.value.toUpperCase()
                      )
                    }
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="MR-XXXX-XXXX-XXXX"
                    className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-4 text-center font-mono text-lg font-black uppercase tracking-[0.12em] text-white outline-none transition focus:border-emerald-400"
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

                <button
                  type="submit"
                  disabled={joining}
                  className="w-full rounded-xl bg-emerald-400 px-4 py-3 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {joining
                    ? "Joining Vendor..."
                    : "Join Vendor Team"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
