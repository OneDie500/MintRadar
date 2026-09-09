"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { setStoredActiveVendorId } from "../../../../lib/active-vendor";

type InviteState =
  | "loading"
  | "signed_out"
  | "ready"
  | "accepting"
  | "accepted"
  | "error";

type AcceptedMembership = {
  vendor_id: string;
  role?: string | null;
  business_name?: string | null;
};

function roleLabel(value?: string | null) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "owner") {
    return "Owner";
  }

  if (normalized === "general_manager") {
    return "General Manager";
  }

  if (normalized === "manager") {
    return "Manager";
  }

  if (normalized === "staff") {
    return "Staff";
  }

  return "Team Member";
}

export default function VendorInvitePage() {
  const params = useParams();

  const token = useMemo(() => {
    const value = params?.token;

    if (Array.isArray(value)) {
      return value[0] || "";
    }

    return typeof value === "string"
      ? value
      : "";
  }, [params]);

  const [state, setState] =
    useState<InviteState>("loading");

  const [accountEmail, setAccountEmail] =
    useState("");

  const [message, setMessage] =
    useState("");

  const [acceptedMembership, setAcceptedMembership] =
    useState<AcceptedMembership | null>(null);

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      if (!token) {
        if (!mounted) return;

        setMessage(
          "This MintRadar invitation link is invalid."
        );
        setState("error");
        return;
      }

      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (!mounted) return;

        if (!session?.user) {
          setAccountEmail("");
          setState("signed_out");
          return;
        }

        setAccountEmail(
          session.user.email || ""
        );
        setState("ready");
      } catch (error: any) {
        console.error(
          "MintRadar invitation session error:",
          error
        );

        if (!mounted) return;

        setMessage(
          error?.message ||
            "MintRadar could not verify your account."
        );
        setState("error");
      }
    }

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;

        if (!session?.user) {
          setAccountEmail("");
          setState("signed_out");
          return;
        }

        setAccountEmail(
          session.user.email || ""
        );

        setState((current) =>
          current === "accepted"
            ? current
            : "ready"
        );
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [token]);

  async function acceptInvitation() {
    if (
      state === "accepting" ||
      !token
    ) {
      return;
    }

    setMessage("");
    setState("accepting");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session?.access_token) {
        setState("signed_out");
        return;
      }

      const response = await fetch(
        "/api/vendor/invites/accept",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            token,
          }),
        }
      );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error ||
            "MintRadar could not accept this invitation."
        );
      }

      const membership =
        result?.membership as
          | AcceptedMembership
          | undefined;

      if (!membership?.vendor_id) {
        throw new Error(
          "MintRadar accepted the invitation but could not identify the vendor."
        );
      }

      setStoredActiveVendorId(
        membership.vendor_id
      );

      setAcceptedMembership(
        membership
      );

      setState("accepted");
    } catch (error: any) {
      console.error(
        "MintRadar invitation acceptance error:",
        error
      );

      setMessage(
        error?.message ||
          "MintRadar could not accept this invitation."
      );

      setState("error");
    }
  }

  const returnTo = token
    ? `/vendor/invite/${encodeURIComponent(token)}`
    : "/vendor";

  return (
    <main className="min-h-screen bg-black px-4 py-20 text-white sm:px-6">
      <div className="mx-auto w-full max-w-xl">
        <Link
          href="/"
          className="inline-block text-3xl font-black tracking-tight"
        >
          Mint
          <span className="text-emerald-400">
            Radar
          </span>
        </Link>

        <div className="mt-8 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="border-b border-zinc-800 px-6 py-6 sm:px-8">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Vendor Invitation
            </p>

            <h1 className="mt-2 text-3xl font-black sm:text-4xl">
              Join the team
            </h1>

            <p className="mt-3 text-sm leading-6 text-zinc-500">
              Accept your invitation to work
              from the vendor&apos;s shared
              MintRadar inventory.
            </p>
          </div>

          <div className="p-6 sm:p-8">
            {state === "loading" && (
              <div className="rounded-2xl border border-zinc-800 bg-black p-5">
                <p className="font-black text-zinc-200">
                  Checking invitation...
                </p>

                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  MintRadar is checking your
                  account session.
                </p>
              </div>
            )}

            {state === "signed_out" && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-zinc-800 bg-black p-5">
                  <p className="font-black text-zinc-200">
                    Sign in to continue
                  </p>

                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Use the email address that
                    received this invitation.
                    MintRadar will verify the
                    email before vendor access
                    can be granted.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Link
                    href={`/vendor/login?returnTo=${encodeURIComponent(
                      returnTo
                    )}`}
                    className="rounded-xl bg-emerald-400 px-5 py-3 text-center font-black text-black transition hover:bg-emerald-300"
                  >
                    Sign In
                  </Link>

                  <Link
                    href={`/vendor/signup?returnTo=${encodeURIComponent(
                      returnTo
                    )}`}
                    className="rounded-xl border border-zinc-700 px-5 py-3 text-center font-black text-zinc-200 transition hover:border-emerald-400 hover:text-emerald-300"
                  >
                    Create Account
                  </Link>
                </div>

                <p className="text-xs leading-5 text-zinc-600">
                  Your invitation is not
                  accepted until you return to
                  this page and confirm it.
                </p>
              </div>
            )}

            {state === "ready" && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-emerald-400">
                    Signed In
                  </p>

                  <p className="mt-2 break-all font-black text-zinc-100">
                    {accountEmail ||
                      "MintRadar account"}
                  </p>

                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    MintRadar will confirm this
                    email matches the invitation
                    before granting access.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={acceptInvitation}
                  className="w-full rounded-xl bg-emerald-400 px-5 py-3.5 font-black text-black transition hover:bg-emerald-300"
                >
                  Accept Invitation
                </button>

                <Link
                  href="/"
                  className="block text-center text-sm font-bold text-zinc-500 transition hover:text-zinc-300"
                >
                  Not ready yet
                </Link>
              </div>
            )}

            {state === "accepting" && (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5">
                <p className="font-black text-emerald-300">
                  Accepting invitation...
                </p>

                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  MintRadar is securely adding
                  this vendor to your account.
                </p>
              </div>
            )}

            {state === "accepted" &&
              acceptedMembership && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.15em] text-emerald-400">
                      Invitation Accepted
                    </p>

                    <h2 className="mt-2 text-2xl font-black text-white">
                      {acceptedMembership.business_name ||
                        "Vendor access added"}
                    </h2>

                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      You joined this vendor as{" "}
                      <span className="font-black text-zinc-200">
                        {roleLabel(
                          acceptedMembership.role
                        )}
                      </span>
                      .
                    </p>

                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      This vendor is now your
                      active MintRadar vendor.
                    </p>
                  </div>

                  <Link
                    href="/vendor"
                    className="block w-full rounded-xl bg-emerald-400 px-5 py-3.5 text-center font-black text-black transition hover:bg-emerald-300"
                  >
                    Open Vendor Dashboard
                  </Link>
                </div>
              )}

            {state === "error" && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-5">
                  <p className="font-black text-red-300">
                    Invitation could not be
                    accepted
                  </p>

                  <p className="mt-2 text-sm leading-6 text-red-200/70">
                    {message}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Link
                    href="/"
                    className="rounded-xl border border-zinc-700 px-5 py-3 text-center font-black text-zinc-300 transition hover:border-zinc-500"
                  >
                    Return Home
                  </Link>

                  <Link
                    href="/vendor/settings"
                    className="rounded-xl border border-emerald-400/30 px-5 py-3 text-center font-black text-emerald-300 transition hover:border-emerald-400"
                  >
                    Vendor Settings
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
