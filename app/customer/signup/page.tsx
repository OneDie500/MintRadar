"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function CustomerSignupPage() {
  const router = useRouter();

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");
    setMessage("");

    if (
      !email.trim() ||
      !password
    ) {
      setError(
        "Enter your email and password."
      );
      return;
    }

    if (password.length < 6) {
      setError(
        "Password must be at least 6 characters."
      );
      return;
    }

    if (
      password !== confirmPassword
    ) {
      setError(
        "Passwords do not match."
      );
      return;
    }

    setLoading(true);

    try {
      const {
        data,
        error: signUpError,
      } =
        await supabase.auth.signUp(
          {
            email:
              email.trim(),
            password,
          }
        );

      if (signUpError) {
        throw signUpError;
      }

      if (data.session) {
        router.push("/");
        router.refresh();
        return;
      }

      setMessage(
        "Account created! Check your email to confirm your account, then come back and log in."
      );

      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error(
        "Customer signup error:",
        err
      );

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white sm:px-6">
      <div className="mx-auto w-full max-w-md">

        <div className="mb-8 text-center">

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
            Create your MintRadar customer account
          </p>

        </div>

        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">

          <div className="border-b border-zinc-800 px-6 py-5">

            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Customer Account
            </p>

            <h1 className="mt-2 text-3xl font-black">
              Create Account
            </h1>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Save cards to your wishlist and keep track of what you&apos;re hunting for.
            </p>

          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-5 p-6"
          >

            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
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
                autoComplete="email"
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
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
                autoComplete="new-password"
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                placeholder="At least 6 characters"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                Confirm Password
              </label>

              <input
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(
                    event.target.value
                  )
                }
                autoComplete="new-password"
                className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none transition focus:border-emerald-400"
                placeholder="Enter it again"
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
              disabled={loading}
              className="w-full rounded-xl bg-emerald-400 px-4 py-3 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? "Creating Account..."
                : "Create Customer Account"}
            </button>

          </form>

          <div className="border-t border-zinc-800 px-6 py-5 text-center">

            <p className="text-sm text-zinc-500">
              Already have an account?
            </p>

            <Link
              href="/customer/login"
              className="mt-2 inline-block font-black text-emerald-400 transition hover:text-emerald-300"
            >
              Log In →
            </Link>

          </div>

        </div>

      </div>
    </main>
  );
}
