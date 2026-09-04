"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";

type AccountType = "customer" | "vendor" | null;

export default function AccountNav() {
  const [loading, setLoading] = useState(true);
  const [accountType, setAccountType] =
    useState<AccountType>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadAccount() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      const user = session?.user;

      if (!user) {
        setAccountType(null);
        setLoading(false);
        return;
      }

      const { data: vendorMembership } = await supabase
        .from("vendor_members")
        .select("vendor_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (!mounted) return;

      setAccountType(
        vendorMembership?.vendor_id
          ? "vendor"
          : "customer"
      );
      setLoading(false);
    }

    loadAccount();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadAccount();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    function handleOutsideClick(
      event: MouseEvent
    ) {
      if (
        menuRef.current &&
        !menuRef.current.contains(
          event.target as Node
        )
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleOutsideClick
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        handleOutsideClick
      );
  }, []);

  async function handleLogout() {
    setOpen(false);

    const { error } =
      await supabase.auth.signOut({
        scope: "local",
      });

    if (
      error &&
      error.name !==
        "AuthSessionMissingError"
    ) {
      console.error(
        "MintRadar logout error:",
        error
      );
      return;
    }

    window.location.assign("/");
  }

  if (loading) {
    return (
      <div className="h-10 w-24 rounded-xl border border-zinc-800 bg-black/80" />
    );
  }

  if (!accountType) {
    return (
      <>
        <Link
          href="/customer/login"
          className="rounded-xl border border-zinc-700 bg-black/90 px-3 py-2.5 text-xs font-black text-zinc-200 shadow-lg backdrop-blur transition hover:border-zinc-500 hover:bg-zinc-900 sm:px-4 sm:text-sm"
        >
          <span className="sm:hidden">
            Customer
          </span>
          <span className="hidden sm:inline">
            Customer Login / Sign Up
          </span>
        </Link>

        <Link
          href="/vendor/login"
          className="rounded-xl border border-emerald-400/30 bg-black/90 px-3 py-2.5 text-xs font-black text-emerald-300 shadow-lg backdrop-blur transition hover:border-emerald-400 hover:bg-emerald-400 hover:text-black sm:px-4 sm:text-sm"
        >
          <span className="sm:hidden">
            Vendor
          </span>
          <span className="hidden sm:inline">
            Vendor Login / Sign Up
          </span>
        </Link>
      </>
    );
  }

  const profileHref =
    accountType === "vendor"
      ? "/vendor/account"
      : "/customer/account";

  const settingsHref =
    accountType === "vendor"
      ? "/vendor/settings"
      : "/customer/settings";

  return (
    <div
      ref={menuRef}
      className="relative"
    >
      <button
        type="button"
        onClick={() =>
          setOpen((current) => !current)
        }
        className="rounded-xl border border-emerald-400/30 bg-black/90 px-3 py-2.5 text-xs font-black text-emerald-300 shadow-lg backdrop-blur transition hover:border-emerald-400 hover:bg-zinc-900 sm:px-4 sm:text-sm"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Account{" "}
        <span
          className={`inline-block transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        >
          <div className="border-b border-zinc-900 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
              {accountType === "vendor"
                ? "Vendor Account"
                : "Customer Account"}
            </p>
          </div>

          <Link
            href={profileHref}
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-sm font-bold text-zinc-200 transition hover:bg-zinc-900 hover:text-emerald-300"
            role="menuitem"
          >
            Profile / Account
          </Link>

          <Link
            href={settingsHref}
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-sm font-bold text-zinc-200 transition hover:bg-zinc-900 hover:text-emerald-300"
            role="menuitem"
          >
            Settings
          </Link>

          {accountType === "vendor" && (
            <Link
              href="/vendor"
              onClick={() => setOpen(false)}
              className="block px-4 py-3 text-sm font-bold text-zinc-200 transition hover:bg-zinc-900 hover:text-emerald-300"
              role="menuitem"
            >
              Vendor Dashboard
            </Link>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="block w-full border-t border-zinc-900 px-4 py-3 text-left text-sm font-black text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
            role="menuitem"
          >
            Log Out
          </button>
        </div>
      )}
    </div>
  );
}
