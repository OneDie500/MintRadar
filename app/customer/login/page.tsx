"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Mode = "login" | "signup";

export default function CustomerLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [mode, setMode] =
    useState<Mode>("login");

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

  useEffect(() => {
    // Intentionally do not auto-redirect when a Supabase session exists.
    // Vendor and customer auth currently share the same Supabase Auth session,
    // so an existing vendor login should not block access to this page.

    const requestedMode =
      searchParams.get("mode");

    if (requestedMode === "signup") {
      setMode("signup");
    } else if (requestedMode === "login") {
      setMode("login");
    }
  }, [searchParams]);

  function switchMode(
    nextMode: Mode
  ) {
    setMode(nextMode);
    setError("");
    setMessage("");
    setPassword("");
    setConfirmPassword("");
  }

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

    if (
      mode === "signup" &&
      password.length < 6
    ) {
      setError(
        "Password must be at least 6 characters."
      );
      return;
    }

    if (
      mode === "signup" &&
      password !== confirmPassword
    ) {
      setError(
        "Passwords do not match."
      );
      return;
    }

    setLoading(true);

    try {
      if (mode === "login") {
        const {
          error:
            signInError,
        } =
          await supabase.auth.signInWithPassword(
            {
              email:
                email.trim(),
              password,
            }
          );

        if (signInError) {
          throw signInError;
        }

        router.push("/");
        router.refresh();
        return;
      }

      const {
        data,
        error:
          signUpError,
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

      setMode("login");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error(
        "Customer auth error:",
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

  const isLogin =
    mode === "login";

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
            Your collectible marketplace account
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="grid grid-cols-2 border-b border-zinc-800">
            <button
              type="button"
              onClick={() =>
                switchMode(
                  "login"
                )
              }
              className={`px-4 py-4 text-sm font-black transition ${
                isLogin
                  ? "bg-emerald-400 text-black"
                  : "bg-zinc-950 text-zinc-500 hover:text-white"
              }`}
            >
              Log In
            </button>

            <button
              type="button"
              onClick={() =>
                switchMode(
                  "signup"
                )
              }
              className={`px-4 py-4 text-sm font-black transition ${
                !isLogin
                  ? "bg-emerald-400 text-black"
                  : "bg-zinc-950 text-zinc-500 hover:text-white"
              }`}
            >
              Sign Up
            </button>
          </div>

          <div className="p-6 sm:p-8">
            <div className="mb-6">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                Customer Account
              </p>

              <h1 className="mt-2 text-2xl font-black">
                {isLogin
                  ? "Welcome back."
                  : "Join MintRadar."}
              </h1>

              <p className="mt-2 text-sm leading-6 text-zinc-500">
                {isLogin
                  ? "Log in to access your customer account."
                  : "Create an account for wishlists, inventory alerts, and future marketplace features."}
              </p>
            </div>

            <form
              onSubmit={
                handleSubmit
              }
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-bold text-zinc-400"
                >
                  Email
                </label>

                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(
                    event
                  ) =>
                    setEmail(
                      event.target
                        .value
                    )
                  }
                  placeholder="you@example.com"
                  className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3.5 text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400/60"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-bold text-zinc-400"
                >
                  Password
                </label>

                <input
                  id="password"
                  type="password"
                  autoComplete={
                    isLogin
                      ? "current-password"
                      : "new-password"
                  }
                  value={
                    password
                  }
                  onChange={(
                    event
                  ) =>
                    setPassword(
                      event.target
                        .value
                    )
                  }
                  placeholder="••••••••"
                  className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3.5 text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400/60"
                />
              </div>

              {!isLogin && (
                <div>
                  <label
                    htmlFor="confirm-password"
                    className="mb-2 block text-sm font-bold text-zinc-400"
                  >
                    Confirm Password
                  </label>

                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={
                      confirmPassword
                    }
                    onChange={(
                      event
                    ) =>
                      setConfirmPassword(
                        event.target
                          .value
                      )
                    }
                    placeholder="••••••••"
                    className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3.5 text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400/60"
                  />
                </div>
              )}

              {error && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-300">
                  {error}
                </div>
              )}

              {message && (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-bold leading-6 text-emerald-300">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={
                  loading
                }
                className="w-full rounded-2xl bg-emerald-400 px-5 py-4 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Working..."
                  : isLogin
                    ? "Log In"
                    : "Create Customer Account"}
              </button>
            </form>

            <div className="mt-6 border-t border-zinc-900 pt-6 text-center">
              <p className="text-xs text-zinc-600">
                Looking to sell on MintRadar?
              </p>

              <Link
                href="/vendor/login"
                className="mt-2 inline-block text-sm font-black text-emerald-400 transition hover:text-emerald-300"
              >
                Vendor Login / Sign Up →
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-sm font-bold text-zinc-600 transition hover:text-zinc-300"
          >
            ← Back to MintRadar
          </Link>
        </div>
      </div>
    </main>
  );
}
