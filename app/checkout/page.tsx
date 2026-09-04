"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";

export default function CheckoutPage() {
  const [signedIn, setSignedIn] =
    useState<boolean | null>(null);

  const [name, setName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [phone, setPhone] =
    useState("");

  const [message, setMessage] =
    useState("");

  useEffect(() => {
    async function loadSession() {
      const {
        data: { session },
      } =
        await supabase.auth.getSession();

      setSignedIn(
        Boolean(session)
      );

      if (
        session?.user?.email
      ) {
        setEmail(
          session.user.email
        );
      }
    }

    loadSession();
  }, []);

  function handleSubmit(
    event: FormEvent
  ) {
    event.preventDefault();

    setMessage(
      "Checkout details look good. Payments and inventory reservation are the next step."
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-5 py-8">

      <div className="max-w-2xl mx-auto">

        <Link
          href="/cart"
          className="text-sm text-zinc-500 hover:text-emerald-400 transition"
        >
          ← Back to Cart
        </Link>

        <p className="text-emerald-400 text-xs uppercase tracking-[0.22em] font-black mt-6">
          MintRadar Checkout
        </p>

        <h1 className="text-4xl sm:text-5xl font-black mt-2">
          Checkout
        </h1>

        <p className="text-zinc-500 mt-3">
          {signedIn
            ? "You're signed in. Confirm your contact details below."
            : "No account needed. Checkout as a guest."}
        </p>

        {!signedIn && (
          <div className="mt-6 bg-zinc-950 border border-zinc-900 rounded-2xl p-5">
            <p className="font-black">
              Already have a
              MintRadar account?
            </p>

            <p className="text-zinc-500 text-sm mt-1">
              You can sign in,
              or keep going as a
              guest.
            </p>

            <Link
              href="/customer/login?next=/cart"
              className="inline-flex mt-4 border border-zinc-800 hover:border-emerald-400 rounded-xl px-4 py-2.5 font-black transition"
            >
              Sign In
            </Link>
          </div>
        )}

        <form
          onSubmit={
            handleSubmit
          }
          className="mt-8 bg-zinc-950 border border-zinc-900 rounded-3xl p-6 sm:p-8 space-y-5"
        >

          <div>
            <label className="block text-sm font-black mb-2">
              Full Name
            </label>

            <input
              type="text"
              required
              value={name}
              onChange={(
                event
              ) =>
                setName(
                  event.target.value
                )
              }
              className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 outline-none focus:border-emerald-400"
            />
          </div>

          <div>
            <label className="block text-sm font-black mb-2">
              Email
            </label>

            <input
              type="email"
              required
              value={email}
              onChange={(
                event
              ) =>
                setEmail(
                  event.target.value
                )
              }
              className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 outline-none focus:border-emerald-400"
            />
          </div>

          <div>
            <label className="block text-sm font-black mb-2">
              Phone{" "}
              <span className="text-zinc-600 font-normal">
                Optional
              </span>
            </label>

            <input
              type="tel"
              value={phone}
              onChange={(
                event
              ) =>
                setPhone(
                  event.target.value
                )
              }
              className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 outline-none focus:border-emerald-400"
            />
          </div>

          <div className="bg-black border border-zinc-900 rounded-2xl p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-600 font-black">
              V1 Checkout
            </p>

            <p className="text-zinc-400 text-sm mt-2">
              Payment processing
              and inventory
              reservation are not
              enabled yet. This
              screen establishes the
              guest checkout flow
              first.
            </p>
          </div>

          {message && (
            <div className="bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 rounded-xl p-4 text-sm">
              {message}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-emerald-400 hover:bg-emerald-300 text-black rounded-xl px-5 py-4 font-black transition"
          >
            Continue
          </button>

        </form>

      </div>
    </main>
  );
}
