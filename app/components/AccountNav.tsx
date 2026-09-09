"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  getStoredActiveVendorId,
  getVendorMemberships,
  setStoredActiveVendorId,
  switchActiveVendor,
  type ActiveVendorMembership,
} from "../../lib/active-vendor";

type AccountType = "customer" | "vendor" | null;

export default function AccountNav() {
  const [loading, setLoading] = useState(true);
  const [accountType, setAccountType] =
    useState<AccountType>(null);
  const [open, setOpen] = useState(false);
  const [vendorMemberships, setVendorMemberships] =
    useState<ActiveVendorMembership[]>([]);
  const [activeVendorId, setActiveVendorId] =
    useState<string | null>(null);
  const [switchingVendorId, setSwitchingVendorId] =
    useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadAccount() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        const user = session?.user;

        if (!user) {
          setAccountType(null);
          setVendorMemberships([]);
          setActiveVendorId(null);
          setLoading(false);
          return;
        }

        const memberships =
          await getVendorMemberships(
            supabase,
            user.id
          );

        if (!mounted) return;

        if (memberships.length === 0) {
          setAccountType("customer");
          setVendorMemberships([]);
          setActiveVendorId(null);
          setLoading(false);
          return;
        }

        const storedVendorId =
          getStoredActiveVendorId();

        const activeMembership =
          memberships.find(
            (membership) =>
              membership.vendor_id ===
              storedVendorId
          ) ?? memberships[0];

        if (
          activeMembership &&
          activeMembership.vendor_id !==
            storedVendorId
        ) {
          setStoredActiveVendorId(
            activeMembership.vendor_id
          );
        }

        if (!mounted) return;

        setAccountType("vendor");
        setVendorMemberships(memberships);
        setActiveVendorId(
          activeMembership?.vendor_id ?? null
        );
        setLoading(false);
      } catch (error) {
        console.error(
          "MintRadar account navigation load error:",
          error
        );

        if (!mounted) return;

        setAccountType(null);
        setVendorMemberships([]);
        setActiveVendorId(null);
        setLoading(false);
      }
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

  async function handleVendorSwitch(
    vendorId: string
  ) {
    if (
      switchingVendorId ||
      vendorId === activeVendorId
    ) {
      return;
    }

    try {
      setSwitchingVendorId(vendorId);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const user = session?.user;

      if (!user) {
        window.location.assign(
          "/vendor/login"
        );
        return;
      }

      const membership =
        await switchActiveVendor(
          supabase,
          user.id,
          vendorId
        );

      setActiveVendorId(
        membership.vendor_id
      );
      setOpen(false);

      window.location.reload();
    } catch (error) {
      console.error(
        "MintRadar vendor switch error:",
        error
      );

      setSwitchingVendorId(null);
    }
  }

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

  const activeVendor =
    vendorMemberships.find(
      (membership) =>
        membership.vendor_id ===
        activeVendorId
    ) ??
    vendorMemberships[0] ??
    null;

  const activeVendorName =
    activeVendor?.vendor?.business_name?.trim() ||
    "Vendor Account";

  const showVendorSwitcher =
    accountType === "vendor" &&
    vendorMemberships.length > 1;

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
        className="max-w-[220px] rounded-xl border border-emerald-400/30 bg-black/90 px-3 py-2.5 text-xs font-black text-emerald-300 shadow-lg backdrop-blur transition hover:border-emerald-400 hover:bg-zinc-900 sm:px-4 sm:text-sm"
        aria-expanded={open}
        aria-haspopup="menu"
        title={
          accountType === "vendor"
            ? activeVendorName
            : "Account"
        }
      >
        <span className="inline-block max-w-[165px] truncate align-bottom">
          {accountType === "vendor"
            ? activeVendorName
            : "Account"}
        </span>{" "}
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
          className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        >
          <div className="border-b border-zinc-900 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
              {accountType === "vendor"
                ? "Vendor Account"
                : "Customer Account"}
            </p>

            {accountType === "vendor" && (
              <p className="mt-1 truncate text-sm font-black text-zinc-200">
                {activeVendorName}
              </p>
            )}
          </div>

          {showVendorSwitcher && (
            <div className="border-b border-zinc-900 p-2">
              <p className="px-2 pb-2 pt-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">
                Switch Vendor
              </p>

              <div className="space-y-1">
                {vendorMemberships.map(
                  (membership) => {
                    const isActive =
                      membership.vendor_id ===
                      activeVendorId;

                    const vendorName =
                      membership.vendor
                        ?.business_name?.trim() ||
                      "MintRadar Vendor";

                    const isSwitching =
                      switchingVendorId ===
                      membership.vendor_id;

                    return (
                      <button
                        key={
                          membership.vendor_id
                        }
                        type="button"
                        onClick={() =>
                          handleVendorSwitch(
                            membership.vendor_id
                          )
                        }
                        disabled={
                          isActive ||
                          Boolean(
                            switchingVendorId
                          )
                        }
                        className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${
                          isActive
                            ? "bg-emerald-400/10 text-emerald-300"
                            : "text-zinc-300 hover:bg-zinc-900 hover:text-white"
                        } disabled:cursor-default`}
                        role="menuitem"
                      >
                        <span className="min-w-0 truncate">
                          {vendorName}
                        </span>

                        <span className="shrink-0 text-xs">
                          {isSwitching
                            ? "..."
                            : isActive
                              ? "✓"
                              : ""}
                        </span>
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          )}

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
