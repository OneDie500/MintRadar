"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

type InboxRow = {
  conversation_id: string;
  conversation_type: "customer_vendor" | "vendor_vendor";
  counterpart_name: string | null;
  context_inventory_id: string | null;
  context_card_id: string | null;
  context_snapshot: {
    card_name?: string | null;
    set_name?: string | null;
    card_number?: string | null;
    image_url?: string | null;
    price?: number | string | null;
    vendor_name?: string | null;
    condition?: string | null;
    grading_company?: string | null;
    grade?: string | null;
  } | null;
  last_message_body: string | null;
  last_message_at: string;
  unread_count: number | string;
};

export default function MessagesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isVendor, setIsVendor] = useState(false);

  async function loadInbox() {
    const { data, error: inboxError } =
      await supabase.rpc("get_message_inbox");

    if (inboxError) {
      throw inboxError;
    }

    setRows((data || []) as InboxRow[]);
  }

  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        setLoading(true);
        setError("");

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session) {
          router.replace("/customer/login");
          return;
        }

        const { data: membership, error: membershipError } = await supabase
          .from("vendor_members")
          .select("vendor_id")
          .eq("user_id", session.user.id)
          .limit(1)
          .maybeSingle();

        if (membershipError) {
          console.error("Messages vendor membership check error:", membershipError);
        }

        if (mounted) {
          setIsVendor(Boolean(membership?.vendor_id));
          await loadInbox();
        }
      } catch (err: any) {
        console.error("Messages inbox error:", err);
        if (mounted) {
          setError(err?.message || "We couldn't load your messages.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    boot();

    const channel = supabase
      .channel("mintradar-inbox-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        () => {
          if (mounted) {
            loadInbox().catch(console.error);
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <main className="min-h-screen bg-black px-5 pb-16 pt-24 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/" className="w-fit">
              <Image
                src="/mintradar-logo.png"
                alt="MintRadar by OnlySlabs"
                width={600}
                height={300}
                priority
                className="h-auto w-[210px] sm:w-[260px]"
              />
            </Link>

            {isVendor && (
              <Link
                href="/vendor"
                className="w-fit rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-black text-zinc-200 transition hover:border-emerald-400 hover:text-emerald-300"
              >
                ← Back to Vendor Dashboard
              </Link>
            )}
          </div>

          <h1 className="mt-7 text-4xl font-black sm:text-5xl">Messages</h1>
          <p className="mt-3 text-zinc-500">
            Talk directly with collectors and independent vendors.
          </p>
        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-10 text-center text-zinc-500">
            Loading messages...
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-10 text-center">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Inbox
            </p>
            <h2 className="mt-3 text-3xl font-black">No messages yet.</h2>
            <p className="mx-auto mt-3 max-w-lg text-zinc-500">
              When you start a conversation with a MintRadar vendor or customer,
              it will show up here.
            </p>
            <Link
              href="/"
              className="mt-7 inline-block rounded-xl bg-emerald-400 px-6 py-4 font-black text-black transition hover:bg-emerald-300"
            >
              Browse Marketplace
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950">
            {rows.map((row) => {
              const snapshot = row.context_snapshot;
              const unread = Number(row.unread_count || 0);

              return (
                <Link
                  key={row.conversation_id}
                  href={`/messages/${row.conversation_id}`}
                  className="flex gap-4 border-b border-zinc-900 p-4 transition last:border-b-0 hover:bg-zinc-900/70 sm:p-5"
                >
                  <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-black">
                    {snapshot?.image_url ? (
                      <img
                        src={snapshot.image_url}
                        alt={snapshot.card_name || "Listing"}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xl text-zinc-700">
                        💬
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate font-black">
                          {row.counterpart_name || "MintRadar User"}
                        </h2>
                        <p className="mt-0.5 text-xs font-bold uppercase tracking-wider text-zinc-600">
                          {row.conversation_type === "vendor_vendor"
                            ? "Vendor ↔ Vendor"
                            : "Customer ↔ Vendor"}
                        </p>
                      </div>

                      {unread > 0 && (
                        <span className="flex min-w-6 items-center justify-center rounded-full bg-emerald-400 px-2 py-1 text-xs font-black text-black">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </div>

                    {snapshot?.card_name && (
                      <p className="mt-2 truncate text-sm font-bold text-emerald-300">
                        {snapshot.card_name}
                        {snapshot.set_name ? ` • ${snapshot.set_name}` : ""}
                      </p>
                    )}

                    <p className="mt-1 truncate text-sm text-zinc-500">
                      {row.last_message_body || "Conversation started"}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
