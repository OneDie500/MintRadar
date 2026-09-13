"use client";

import {
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

function getSafeReturnTo() {
  if (
    typeof window ===
    "undefined"
  ) {
    return "";
  }

  const searchParams =
    new URLSearchParams(
      window.location.search
    );

  const rawReturnTo =
    searchParams.get(
      "returnTo"
    ) || "";

  if (
    !rawReturnTo.startsWith("/") ||
    rawReturnTo.startsWith("//")
  ) {
    return "";
  }

  return rawReturnTo;
}

export default function VendorSignup() {
  const router = useRouter();

  const [
    returnTo,
    setReturnTo,
  ] = useState("");

  const [
    businessName,
    setBusinessName,
  ] = useState("");

  const [
    email,
    setEmail,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    instagram,
    setInstagram,
  ] = useState("");

  const [
    bio,
    setBio,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  // --------------------------------------------------
  // READ SAFE RETURN PATH
  // --------------------------------------------------

  useEffect(() => {
    setReturnTo(
      getSafeReturnTo()
    );
  }, []);

  const isVendorInvite =
    returnTo.startsWith(
      "/vendor/invite/"
    );

  // --------------------------------------------------
  // SIGNUP
  // --------------------------------------------------

  async function handleSignup(
    event: React.FormEvent
  ) {
    event.preventDefault();

    setMessage("");
    setErrorMessage("");

    // ----------------------------------------------
    // NORMAL INDEPENDENT VENDOR SIGNUP
    //
    // Invite-based accounts are joining an existing
    // vendor and therefore do NOT need a new business
    // profile.
    // ----------------------------------------------

    if (
      !isVendorInvite &&
      !businessName.trim()
    ) {
      setErrorMessage(
        "Please enter your business name."
      );

      return;
    }

    if (!email.trim()) {
      setErrorMessage(
        "Please enter your email."
      );

      return;
    }

    if (
      password.length < 6
    ) {
      setErrorMessage(
        "Password must be at least 6 characters."
      );

      return;
    }

    if (
      password !==
      confirmPassword
    ) {
      setErrorMessage(
        "Passwords do not match."
      );

      return;
    }

    setLoading(true);

    try {
      // ----------------------------------------------
      // EMAIL CONFIRMATION DESTINATION
      //
      // Invite signup:
      // confirmation should return directly to the
      // invitation.
      //
      // Normal vendor signup:
      // confirmation returns to vendor login.
      // ----------------------------------------------

      const emailRedirectTo =
        typeof window !==
        "undefined"
          ? `${window.location.origin}${
              isVendorInvite
                ? returnTo
                : "/vendor/login"
            }`
          : undefined;

      // ----------------------------------------------
      // USER METADATA
      //
      // IMPORTANT:
      //
      // Invitation accounts must NOT receive
      // business_name metadata.
      //
      // AccountNav and vendor login use that metadata
      // to identify independent vendor onboarding.
      //
      // Adding it during an invitation could cause a
      // personal vendor to be provisioned before the
      // shared-vendor invitation is accepted.
      // ----------------------------------------------

      const signupMetadata =
        isVendorInvite
          ? {
              signup_source:
                "vendor_invite",
            }
          : {
              business_name:
                businessName.trim(),

              instagram:
                instagram.trim() ||
                null,

              bio:
                bio.trim() ||
                null,

              signup_source:
                "independent_vendor",
            };

      const {
        data,
        error,
      } =
        await supabase.auth.signUp(
          {
            email:
              email.trim(),

            password,

            options: {
              data:
                signupMetadata,

              emailRedirectTo,
            },
          }
        );

      if (error) {
        console.error(
          "Supabase signup error:",
          {
            message:
              error.message,

            status:
              error.status,

            name:
              error.name,
          }
        );

        setErrorMessage(
          error.message
        );

        return;
      }

      if (!data.user) {
        setErrorMessage(
          "Account could not be created. Please try again."
        );

        return;
      }

      // ----------------------------------------------
      // SESSION EXISTS IMMEDIATELY
      //
      // This can happen when email confirmation is
      // disabled or Supabase returns an active session.
      //
      // Invite users go straight back to the invite.
      // ----------------------------------------------

      if (
        data.session &&
        isVendorInvite &&
        returnTo
      ) {
        router.replace(
          returnTo
        );

        router.refresh();

        return;
      }

      // ----------------------------------------------
      // CONFIRMATION REQUIRED
      // ----------------------------------------------

      if (isVendorInvite) {
        setMessage(
          "MintRadar account created! Check your email to confirm your account. After confirmation, you'll return to your vendor invitation to finish joining the team."
        );
      } else {
        setMessage(
          "Vendor account created! Check your email to confirm your account, then come back and log in."
        );
      }

      setBusinessName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setInstagram("");
      setBio("");
    } catch (
      error: any
    ) {
      console.error(
        "Unexpected signup error:",
        {
          message:
            error?.message,

          name:
            error?.name,

          stack:
            error?.stack,
        }
      );

      setErrorMessage(
        error?.message ||
          "Something went wrong while creating your account."
      );
    } finally {
      setLoading(false);
    }
  }

  // --------------------------------------------------
  // LOGIN LINK
  // --------------------------------------------------

  const loginHref =
    returnTo
      ? `/vendor/login?returnTo=${encodeURIComponent(
          returnTo
        )}`
      : "/vendor/login";

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-xl">

        <div className="mb-8 text-center">
          <p className="text-emerald-400 text-xs uppercase tracking-[0.25em] font-bold mb-3">
            MintRadar Vendor Portal
          </p>

          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
            {isVendorInvite
              ? "Create Your MintRadar Account"
              : "Create Vendor Account"}
          </h1>

          <p className="text-zinc-500 mt-3">
            {isVendorInvite
              ? "Create your MintRadar login, then return to the invitation to join the shared vendor."
              : "Create your account and start building your MintRadar inventory."}
          </p>
        </div>

        {isVendorInvite && (
          <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-400">
              Vendor Invitation
            </p>

            <p className="mt-2 text-sm leading-6 text-zinc-400">
              You&apos;re joining an
              existing MintRadar vendor.
              We&apos;ll create your
              personal login first.
              Your vendor access will be
              added when you return to
              the invitation and accept
              it.
            </p>

            <p className="mt-2 text-xs leading-5 text-zinc-600">
              This will not create a
              separate vendor business
              for your account.
            </p>
          </div>
        )}

        <form
          onSubmit={
            handleSignup
          }
          className="bg-zinc-950 border border-zinc-900 rounded-3xl p-6 sm:p-8"
        >
          <div className="space-y-5">

            {!isVendorInvite && (
              <div>
                <label className="block text-sm font-bold mb-2">
                  Business Name
                </label>

                <input
                  type="text"
                  value={
                    businessName
                  }
                  onChange={(
                    event
                  ) =>
                    setBusinessName(
                      event.target
                        .value
                    )
                  }
                  placeholder="OnlySlabs"
                  className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-bold mb-2">
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(
                  event
                ) =>
                  setEmail(
                    event.target
                      .value
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
                placeholder="Enter password again"
                className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
              />
            </div>

            {!isVendorInvite && (
              <>
                <div>
                  <label className="block text-sm font-bold mb-2">
                    Instagram{" "}
                    <span className="text-zinc-600 font-normal">
                      Optional
                    </span>
                  </label>

                  <input
                    type="text"
                    value={
                      instagram
                    }
                    onChange={(
                      event
                    ) =>
                      setInstagram(
                        event.target
                          .value
                      )
                    }
                    placeholder="@yourshop"
                    className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold mb-2">
                    Vendor Bio{" "}
                    <span className="text-zinc-600 font-normal">
                      Optional
                    </span>
                  </label>

                  <textarea
                    value={bio}
                    onChange={(
                      event
                    ) =>
                      setBio(
                        event.target
                          .value
                      )
                    }
                    placeholder="Tell customers a little about your shop..."
                    rows={4}
                    className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-400 transition resize-none"
                  />
                </div>
              </>
            )}

            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4 text-sm">
                {errorMessage}
              </div>
            )}

            {message && (
              <div className="bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 rounded-xl p-4 text-sm leading-6">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-400 hover:bg-emerald-300 disabled:bg-zinc-700 disabled:text-zinc-400 text-black font-black rounded-xl px-5 py-4 transition"
            >
              {loading
                ? "Creating Account..."
                : isVendorInvite
                  ? "Create Account & Continue"
                  : "Create Vendor Account"}
            </button>
          </div>
        </form>

        <div className="text-center mt-6">
          <p className="text-zinc-500 text-sm">
            Already have an
            account?
          </p>

          <Link
            href={loginHref}
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