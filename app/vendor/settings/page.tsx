"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { getActiveVendorMembership } from "../../../lib/active-vendor";

type VendorSettingsMetadata = {
  vendor_sale_updates?: boolean;
  vendor_inventory_updates?: boolean;
  [key: string]: unknown;
};

type TeamMember = {
  user_id: string;
  email?: string | null;
  role?: string | null;
  joined_at?: string | null;
};

type VendorRole = "staff" | "manager" | "general_manager" | "owner";

type InviteRow = {
  id: string;
  email: string;
  expires_at?: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
  role?: VendorRole | null;
};

const ROLE_LABELS: Record<VendorRole, string> = {
  staff: "Staff",
  manager: "Manager",
  general_manager: "General Manager",
  owner: "Owner",
};

const INVITE_OPTIONS: Record<VendorRole, VendorRole[]> = {
  owner: ["owner", "general_manager", "manager", "staff"],
  general_manager: ["manager", "staff"],
  manager: ["staff"],
  staff: [],
};

function normalizeRole(value?: string | null): VendorRole {
  const normalized = (value || "staff")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (
    normalized === "owner" ||
    normalized === "general_manager" ||
    normalized === "manager" ||
    normalized === "staff"
  ) {
    return normalized;
  }

  return "staff";
}

function roleRank(role: VendorRole) {
  return {
    staff: 1,
    manager: 2,
    general_manager: 3,
    owner: 4,
  }[role];
}

function memberRoleCanBeManaged(
  actorRole: VendorRole,
  targetRole: VendorRole
) {
  if (actorRole === "owner") {
    return targetRole !== "owner";
  }

  return roleRank(actorRole) > roleRank(targetRole);
}

export default function VendorSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saleUpdates, setSaleUpdates] = useState(true);
  const [inventoryUpdates, setInventoryUpdates] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<VendorRole>("staff");
  const [inviteMessage, setInviteMessage] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [teamError, setTeamError] = useState("");

  const normalizedRole = normalizeRole(role);
  const isOwner = normalizedRole === "owner";
  const canManageTeam = normalizedRole !== "staff";
  const allowedInviteRoles = INVITE_OPTIONS[normalizedRole];

  const loadTeam = useCallback(async () => {
    if (!canManageTeam || !vendorId) return;

    setTeamLoading(true);
    setTeamError("");

    try {
      const { data: teamData, error: teamRpcError } =
        await supabase.rpc("get_vendor_team");

      if (teamRpcError) throw teamRpcError;

      setTeam((teamData || []) as TeamMember[]);

      const { data: inviteData, error: inviteError } =
        await supabase
          .from("vendor_invites")
          .select(
            "id, email, expires_at, status, created_at, role"
          )
          .eq("vendor_id", vendorId)
          .order("created_at", { ascending: false })
          .limit(20);

      if (inviteError) throw inviteError;

      setInvites((inviteData || []) as InviteRow[]);
    } catch (err: any) {
      console.error("Vendor team load error:", err);

      setTeamError(
        err?.message ||
          "MintRadar could not load team access."
      );
    } finally {
      setTeamLoading(false);
    }
  }, [canManageTeam, vendorId]);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        const user = session?.user ?? null;

        if (!user) {
          window.location.assign("/vendor/login");
          return;
        }

        const membership =
          await getActiveVendorMembership(
            supabase,
            user.id
          );

        if (!membership?.vendor_id) {
          throw new Error(
            "Your account is not connected to a MintRadar vendor."
          );
        }

        const metadata =
          (user.user_metadata || {}) as VendorSettingsMetadata;

        if (!cancelled) {
          setVendorId(membership.vendor_id);
          setRole(normalizeRole(membership.role));

          setSaleUpdates(
            typeof metadata.vendor_sale_updates === "boolean"
              ? metadata.vendor_sale_updates
              : true
          );

          setInventoryUpdates(
            typeof metadata.vendor_inventory_updates === "boolean"
              ? metadata.vendor_inventory_updates
              : true
          );
        }
      } catch (err: any) {
        console.error("Vendor settings load error:", err);

        if (!cancelled) {
          setError(
            err?.message ||
              "MintRadar could not load your vendor settings."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (canManageTeam && vendorId) {
      loadTeam();
    }
  }, [canManageTeam, vendorId, loadTeam]);

  async function handleSave(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (saving) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = session?.user ?? null;

      if (!user) {
        window.location.assign("/vendor/login");
        return;
      }

      const existingMetadata =
        (user.user_metadata || {}) as VendorSettingsMetadata;

      const { error: updateError } =
        await supabase.auth.updateUser({
          data: {
            ...existingMetadata,
            vendor_sale_updates: saleUpdates,
            vendor_inventory_updates: inventoryUpdates,
          },
        });

      if (updateError) throw updateError;

      setMessage("Vendor settings saved.");
    } catch (err: any) {
      console.error("Vendor settings update error:", err);

      setError(
        err?.message ||
          "MintRadar could not update your vendor settings."
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendInvite() {
    if (!canManageTeam || sendingInvite) return;

    const email = inviteEmail.trim().toLowerCase();

    if (!email) {
      setTeamError("Enter the email address you want to invite.");
      return;
    }

    setSendingInvite(true);
    setInviteMessage("");
    setTeamError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session?.access_token) {
        window.location.assign("/vendor/login");
        return;
      }

      const response = await fetch("/api/vendor/invites/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email,
          role: inviteRole,
          vendorId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error || "MintRadar could not send the invitation."
        );
      }

      setInviteMessage(
        `Invitation sent to ${email} as ${ROLE_LABELS[inviteRole]}.`
      );
      setInviteEmail("");
      await loadTeam();
    } catch (err: any) {
      console.error("Vendor invitation send error:", err);

      setTeamError(
        err?.message || "MintRadar could not send the invitation."
      );
    } finally {
      setSendingInvite(false);
    }
  }

  async function revokeInvite(inviteId: string) {
    setTeamError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      if (!session?.access_token) {
        window.location.assign("/vendor/login");
        return;
      }

      const response = await fetch(
        `/api/vendor/invites/${inviteId}/revoke`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error || "MintRadar could not revoke that invitation."
        );
      }

      await loadTeam();
    } catch (err: any) {
      console.error("Vendor invitation revoke error:", err);

      setTeamError(
        err?.message || "MintRadar could not revoke that invitation."
      );
    }
  }

  async function removeMember(member: TeamMember) {
    const memberRole = normalizeRole(member.role);

    if (
      normalizedRole === "staff" ||
      (normalizedRole === "manager" && memberRole !== "staff") ||
      (normalizedRole === "general_manager" &&
        !["manager", "staff"].includes(memberRole)) ||
      (normalizedRole === "owner" && member.user_id === undefined)
    ) {
      return;
    }

    const okay = window.confirm(
      `Remove ${member.email || "this team member"} from the vendor?`
    );

    if (!okay) return;

    setTeamError("");

    try {
      const { error: removeError } = await supabase.rpc(
        "remove_vendor_team_member",
        {
          p_user_id: member.user_id,
        }
      );

      if (removeError) throw removeError;

      await loadTeam();
    } catch (err: any) {
      console.error("Vendor team removal error:", err);

      setTeamError(
        err?.message ||
          "MintRadar could not remove that team member."
      );
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-24 text-white sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-block text-3xl font-black tracking-tight"
          >
            Mint<span className="text-emerald-400">Radar</span>
          </Link>

          <p className="mt-3 text-sm text-zinc-500">
            Manage your MintRadar vendor preferences
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="border-b border-zinc-800 px-6 py-5 sm:px-8">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              Vendor Settings
            </p>

            <h1 className="mt-2 text-3xl font-black sm:text-4xl">
              Settings
            </h1>

            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Manage vendor preferences and team access.
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-zinc-500">
              Loading vendor settings...
            </div>
          ) : (
            <>
              <form
                onSubmit={handleSave}
                className="space-y-6 p-6 sm:p-8"
              >
                <label className="flex cursor-pointer items-start justify-between gap-5 rounded-2xl border border-zinc-800 bg-black p-5">
                  <div>
                    <p className="font-black">
                      Sale & order updates
                    </p>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      Preference for future purchase and order alerts.
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={saleUpdates}
                    onChange={(event) =>
                      setSaleUpdates(event.target.checked)
                    }
                    className="mt-1 h-5 w-5 accent-emerald-400"
                  />
                </label>

                <label className="flex cursor-pointer items-start justify-between gap-5 rounded-2xl border border-zinc-800 bg-black p-5">
                  <div>
                    <p className="font-black">
                      Inventory alerts
                    </p>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      Preference for future low-stock, sold-out, and
                      inventory alerts.
                    </p>
                  </div>

                  <input
                    type="checkbox"
                    checked={inventoryUpdates}
                    onChange={(event) =>
                      setInventoryUpdates(event.target.checked)
                    }
                    className="mt-1 h-5 w-5 accent-emerald-400"
                  />
                </label>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                    Account V1 Note
                  </p>

                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    These preferences are saved today, but email and
                    push notifications are not active yet.
                  </p>
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
                  disabled={saving}
                  className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save Settings"}
                </button>
              </form>

              <section className="border-t border-zinc-800 p-6 sm:p-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
                      Team Access
                    </p>

                    <h2 className="mt-2 text-2xl font-black">
                      Shared Vendor Inventory
                    </h2>

                    <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
                      Every team member keeps their own MintRadar
                      login while working from the same vendor
                      inventory.
                    </p>
                  </div>

                  {canManageTeam && allowedInviteRoles.length > 0 && (
                    <div className="w-full sm:max-w-[430px]">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-zinc-500">
                        Invite Team Member
                      </p>

                      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_150px]">
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(event) =>
                            setInviteEmail(event.target.value)
                          }
                          placeholder="person@email.com"
                          disabled={sendingInvite}
                          className="min-w-0 rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400"
                        />

                        <select
                          value={inviteRole}
                          onChange={(event) =>
                            setInviteRole(
                              event.target.value as VendorRole
                            )
                          }
                          disabled={sendingInvite}
                          className="rounded-xl border border-zinc-700 bg-black px-4 py-3 font-black text-white outline-none transition focus:border-emerald-400"
                        >
                          {allowedInviteRoles.map((option) => (
                            <option key={option} value={option}>
                              {ROLE_LABELS[option]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={sendInvite}
                        disabled={sendingInvite || !inviteEmail.trim()}
                        className="mt-2 w-full rounded-xl bg-emerald-400 px-5 py-3 font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {sendingInvite
                          ? "Sending Invitation..."
                          : "Send Invitation"}
                      </button>
                    </div>
                  )}
                </div>

                {!canManageTeam ? (
                  <div className="mt-6 rounded-2xl border border-zinc-800 bg-black p-5">
                    <p className="font-black">
                      Staff Access
                    </p>

                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Your account is connected to this vendor as
                      <span className="font-bold text-zinc-300">
                        {" "}
                        {ROLE_LABELS[normalizedRole]}
                      </span>
                      . Team code generation and member management
                      require Manager access or higher.
                    </p>
                  </div>
                ) : (
                  <>
                    {inviteMessage && (
                      <div className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm font-bold text-emerald-400">
                        {inviteMessage}
                      </div>
                    )}

                    {teamError && (
                      <div className="mt-6 rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-400">
                        {teamError}
                      </div>
                    )}

                    <div className="mt-7">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-zinc-600">
                        Team Members
                      </p>

                      {teamLoading ? (
                        <p className="mt-3 text-sm text-zinc-500">
                          Loading team...
                        </p>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {team.map((member) => (
                            <div
                              key={member.user_id}
                              className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-black p-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div>
                                <p className="font-black text-zinc-200">
                                  {member.email ||
                                    "MintRadar account"}
                                </p>

                                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-zinc-600">
                                  {ROLE_LABELS[normalizeRole(member.role)]}
                                </p>
                              </div>

                              {member.user_id &&
                                memberRoleCanBeManaged(
                                  normalizedRole,
                                  normalizeRole(member.role)
                                ) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    removeMember(member)
                                  }
                                  className="rounded-xl border border-red-400/20 px-4 py-2 text-sm font-black text-red-300 transition hover:bg-red-400/10"
                                >
                                  Remove Access
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-7">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-zinc-600">
                        Invitations
                      </p>

                      <div className="mt-3 space-y-3">
                        {invites.length === 0 ? (
                          <p className="text-sm text-zinc-500">
                            No invitations sent yet.
                          </p>
                        ) : (
                          invites.map((invite) => (
                            <div
                              key={invite.id}
                              className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-black p-4 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div>
                                <p className="font-black text-zinc-200">
                                  {invite.email}
                                </p>

                                <p className="mt-1 text-xs uppercase tracking-[0.12em] text-zinc-600">
                                  {ROLE_LABELS[normalizeRole(invite.role)]}
                                  {" • "}
                                  {invite.status}
                                </p>

                                <p className="mt-1 text-xs text-zinc-600">
                                  {invite.expires_at
                                    ? `Expires ${new Date(
                                        invite.expires_at
                                      ).toLocaleDateString()}`
                                    : "No expiration"}
                                </p>
                              </div>

                              {invite.status === "pending" && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    revokeInvite(invite.id)
                                  }
                                  className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-black text-zinc-300 transition hover:border-red-400/40 hover:text-red-300"
                                >
                                  Revoke
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </section>

              <div className="flex flex-wrap gap-3 border-t border-zinc-800 p-6 sm:p-8">
                <Link
                  href="/vendor/account"
                  className="rounded-xl border border-zinc-800 px-5 py-3 font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  Profile / Account
                </Link>

                <Link
                  href="/vendor"
                  className="rounded-xl border border-zinc-800 px-5 py-3 font-black text-white transition hover:border-emerald-400 hover:text-emerald-300"
                >
                  Vendor Dashboard
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
