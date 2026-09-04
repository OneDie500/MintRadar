"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_user_id: string | null;
  sender_vendor_id: string | null;
  sender_display_name: string | null;
  sender_vendor_name: string | null;
  body: string;
  created_at: string;
  is_mine: boolean;
};

type InboxRow = {
  conversation_id: string;
  counterpart_name: string | null;
  context_snapshot: {
    card_name?: string | null;
    set_name?: string | null;
    card_number?: string | null;
    image_url?: string | null;
    price?: number | string | null;
    condition?: string | null;
    grading_company?: string | null;
    grade?: string | null;
    vendor_name?: string | null;
  } | null;
};

export default function ConversationPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = String(
    params.conversationId ||
      params.coversationId ||
      ""
  );
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [conversation, setConversation] = useState<InboxRow | null>(null);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [isVendor, setIsVendor] = useState(false);

  async function markRead() {
    const { error } = await supabase.rpc("mark_conversation_read", {
      p_conversation_id: conversationId,
    });
    if (error) console.error("Mark read error:", error);
  }

  async function loadMessages() {
    const { data, error } = await supabase.rpc(
      "get_conversation_messages",
      { p_conversation_id: conversationId }
    );

    if (error) throw error;
    setMessages((data || []) as MessageRow[]);
  }

  async function loadConversation() {
    const { data, error } = await supabase.rpc("get_message_inbox");
    if (error) throw error;

    const found = ((data || []) as InboxRow[]).find(
      (row) => row.conversation_id === conversationId
    );

    if (!found) {
      throw new Error("Conversation not found or you do not have access.");
    }

    setConversation(found);
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
          console.error(
            "Conversation vendor membership check error:",
            membershipError
          );
        }

        if (mounted) {
          setIsVendor(Boolean(membership?.vendor_id));
        }

        await Promise.all([loadConversation(), loadMessages(), markRead()]);
      } catch (err: any) {
        console.error("Conversation error:", err);
        if (mounted) {
          setError(err?.message || "We couldn't load this conversation.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    if (conversationId) boot();

    const channel = supabase
      .channel(`conversation-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        async () => {
          if (!mounted) return;
          try {
            await loadMessages();
            await markRead();
          } catch (err) {
            console.error("Realtime message refresh error:", err);
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();

    const cleanBody = body.trim();
    if (!cleanBody || sending) return;

    if (!conversationId) {
      setError(
        "MintRadar could not identify this conversation."
      );
      return;
    }

    try {
      setSending(true);
      setError("");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        router.replace("/customer/login");
        return;
      }

      const {
        error: sendError,
      } = await supabase.rpc("send_message", {
        p_conversation_id: conversationId,
        p_body: cleanBody,
      });

      if (sendError) {
        throw sendError;
      }

      setBody("");
      await loadMessages();
      await markRead();
    } catch (err: any) {
      const readableMessage =
        err?.message ||
        err?.details ||
        err?.hint ||
        (typeof err === "string"
          ? err
          : "Your message could not be sent.");

      console.error("Send message error:", {
        message: err?.message,
        details: err?.details,
        hint: err?.hint,
        code: err?.code,
        conversationId,
      });

      setError(readableMessage);
    } finally {
      setSending(false);
    }
  }

  const snapshot = conversation?.context_snapshot;

  return (
    <main className="min-h-screen bg-black px-4 pb-8 pt-20 text-white sm:px-5 sm:pt-24">
      <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-900 bg-zinc-950">
        <header className="border-b border-zinc-900 p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/" className="w-fit">
                <Image
                  src="/mintradar-logo.png"
                  alt="MintRadar by OnlySlabs"
                  width={600}
                  height={300}
                  priority
                  className="h-auto w-[180px] sm:w-[220px]"
                />
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                {isVendor && (
                  <Link
                    href="/vendor"
                    className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm font-black text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
                  >
                    ← Vendor Dashboard
                  </Link>
                )}

                <Link
                  href="/messages"
                  className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-sm font-black text-zinc-300 transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  ← Inbox
                </Link>
              </div>
            </div>

            <div className="min-w-0">
              <p className="truncate text-xl font-black">
                {conversation?.counterpart_name || "Conversation"}
              </p>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-400">
                MintRadar Messages
              </p>
            </div>
          </div>

          {snapshot?.card_name && (
            <div className="mt-4 flex gap-3 rounded-2xl border border-zinc-800 bg-black p-3">
              {snapshot.image_url && (
                <img
                  src={snapshot.image_url}
                  alt={snapshot.card_name}
                  className="h-20 w-14 shrink-0 rounded-lg object-contain"
                />
              )}
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wider text-zinc-600">
                  Listing Context
                </p>
                <p className="mt-1 truncate font-black text-emerald-300">
                  {snapshot.card_name}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  {[snapshot.set_name, snapshot.card_number ? `#${snapshot.card_number}` : null]
                    .filter(Boolean)
                    .join(" • ")}
                </p>
                {snapshot.price != null && (
                  <p className="mt-1 font-black">
                    ${Number(snapshot.price).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          )}
        </header>

        {error && (
          <div className="m-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="py-16 text-center text-zinc-500">
              Loading conversation...
            </div>
          ) : messages.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-2xl font-black">Start the conversation.</p>
              <p className="mt-2 text-zinc-500">
                Send the first MintRadar message below.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${
                    message.is_mine ? "justify-end" : "justify-start"
                  }`}
                >
                  <div className="max-w-[85%] sm:max-w-[70%]">
                    {!message.is_mine && (
                      <p className="mb-1 px-1 text-xs font-bold text-zinc-600">
                        {message.sender_vendor_name
                          ? `${message.sender_vendor_name}${
                              message.sender_display_name
                                ? ` • ${message.sender_display_name}`
                                : ""
                            }`
                          : message.sender_display_name || "MintRadar User"}
                      </p>
                    )}

                    <div
                      className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        message.is_mine
                          ? "rounded-br-md bg-emerald-400 font-medium text-black"
                          : "rounded-bl-md border border-zinc-800 bg-zinc-900 text-zinc-100"
                      }`}
                    >
                      {message.body}
                    </div>

                    <p
                      className={`mt-1 px-1 text-[10px] text-zinc-700 ${
                        message.is_mine ? "text-right" : "text-left"
                      }`}
                    >
                      {new Date(message.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={sendMessage}
          className="border-t border-zinc-900 bg-black/60 p-3 sm:p-4"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write a message..."
              maxLength={4000}
              rows={1}
              className="max-h-40 min-h-12 flex-1 resize-y rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400"
            />
            <button
              type="submit"
              disabled={!body.trim() || sending}
              className="h-12 rounded-2xl bg-emerald-400 px-5 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
