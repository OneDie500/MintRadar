"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type InboxUnreadRow = {
  unread_count: number | string | null;
};

export default function MessagesNav() {
  const [unreadCount, setUnreadCount] = useState(0);

  async function refreshUnreadCount() {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session) {
      setUnreadCount(0);
      return;
    }

    const { data, error } = await supabase.rpc("get_message_inbox");

    if (error) {
      console.error("Messages unread count error:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return;
    }

    const total = ((data || []) as InboxUnreadRow[]).reduce(
      (sum, row) => sum + Number(row.unread_count || 0),
      0
    );

    setUnreadCount(total);
  }

  useEffect(() => {
    let mounted = true;

    async function boot() {
      if (!mounted) return;
      await refreshUnreadCount();
    }

    boot();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      if (mounted) {
        refreshUnreadCount().catch(console.error);
      }
    });

    const channel = supabase
      .channel("mintradar-global-message-badge")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        () => {
          if (mounted) {
            refreshUnreadCount().catch(console.error);
          }
        }
      )
      .subscribe();

    const refreshOnFocus = () => {
      if (mounted) {
        refreshUnreadCount().catch(console.error);
      }
    };

    window.addEventListener("focus", refreshOnFocus);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      supabase.removeChannel(channel);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  return (
    <Link
      href="/messages"
      className="relative rounded-xl border border-zinc-700 bg-black/90 px-3 py-2.5 text-xs font-black text-zinc-200 shadow-lg backdrop-blur transition hover:border-emerald-400 hover:text-emerald-300 sm:px-4 sm:text-sm"
    >
      <span className="sm:hidden">💬</span>
      <span className="hidden sm:inline">💬 Messages</span>

      {unreadCount > 0 && (
        <span className="absolute -right-2 -top-2 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400 px-1.5 text-[10px] font-black leading-none text-black ring-2 ring-black">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
