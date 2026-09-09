import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VendorRole = "staff" | "manager" | "general_manager" | "owner";

const VALID_ROLES = new Set<VendorRole>([
  "staff",
  "manager",
  "general_manager",
  "owner",
]);

const ROLE_LABELS: Record<VendorRole, string> = {
  staff: "Staff",
  manager: "Manager",
  general_manager: "General Manager",
  owner: "Owner",
};

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeRole(value: unknown): VendorRole | null {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (VALID_ROLES.has(normalized as VendorRole)) {
    return normalized as VendorRole;
  }

  return null;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoApiKey = process.env.BREVO_API_KEY;

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    !serviceRoleKey ||
    !brevoApiKey
  ) {
    console.error("Vendor invite configuration is incomplete.");

    return NextResponse.json(
      {
        error:
          "MintRadar invitation service is not configured correctly.",
      },
      { status: 500 }
    );
  }

  try {
    const authorization = request.headers.get("authorization");

    if (!authorization?.toLowerCase().startsWith("bearer ")) {
      return NextResponse.json(
        { error: "You must be signed in to send an invitation." },
        { status: 401 }
      );
    }

    const accessToken = authorization.slice(7).trim();

    if (!accessToken) {
      return NextResponse.json(
        { error: "You must be signed in to send an invitation." },
        { status: 401 }
      );
    }

    const authClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json(
        { error: "Your MintRadar session is not valid." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const email = normalizeEmail(body?.email);
    const role = normalizeRole(body?.role);
    const vendorId = String(body?.vendorId || "").trim();

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 }
      );
    }

    if (!role) {
      return NextResponse.json(
        { error: "Choose a valid vendor role." },
        { status: 400 }
      );
    }

    if (!vendorId) {
      return NextResponse.json(
        { error: "Choose an active MintRadar vendor." },
        { status: 400 }
      );
    }

    if (
      user.email &&
      normalizeEmail(user.email) === email
    ) {
      return NextResponse.json(
        {
          error:
            "That email is already being used by your MintRadar account.",
        },
        { status: 400 }
      );
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const {
      data: membership,
      error: membershipError,
    } = await admin
      .from("vendor_members")
      .select("vendor_id, role")
      .eq("vendor_id", vendorId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership?.vendor_id) {
      return NextResponse.json(
        {
          error:
            "You do not have access to the selected MintRadar vendor.",
        },
        { status: 403 }
      );
    }

    const {
      data: canInvite,
      error: permissionError,
    } = await admin.rpc("can_invite_vendor_role", {
      p_vendor_id: vendorId,
      p_user_id: user.id,
      p_target_role: role,
    });

    if (permissionError) {
      throw permissionError;
    }

    if (!canInvite) {
      return NextResponse.json(
        {
          error:
            "Your vendor role does not have permission to send this invitation.",
        },
        { status: 403 }
      );
    }

    const {
      data: usersPage,
      error: usersError,
    } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (usersError) {
      throw usersError;
    }

    const existingUser = usersPage.users.find(
      (candidate) =>
        normalizeEmail(candidate.email) === email
    );

    if (existingUser) {
      const {
        data: existingMembership,
        error: existingMembershipError,
      } = await admin
        .from("vendor_members")
        .select("user_id")
        .eq("vendor_id", vendorId)
        .eq("user_id", existingUser.id)
        .maybeSingle();

      if (existingMembershipError) {
        throw existingMembershipError;
      }

      if (existingMembership) {
        return NextResponse.json(
          {
            error:
              "That person already has access to this vendor.",
          },
          { status: 409 }
        );
      }
    }

    const {
      data: pendingInvite,
      error: pendingError,
    } = await admin
      .from("vendor_invites")
      .select("id, expires_at")
      .eq("vendor_id", vendorId)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingError) {
      throw pendingError;
    }

    if (pendingInvite) {
      return NextResponse.json(
        {
          error:
            "A pending invitation has already been sent to that email address.",
        },
        { status: 409 }
      );
    }

    const {
      data: vendor,
      error: vendorError,
    } = await admin
      .from("vendors")
      .select("business_name")
      .eq("id", vendorId)
      .single();

    if (vendorError) {
      throw vendorError;
    }

    const vendorName =
      vendor?.business_name?.trim() || "a MintRadar vendor";

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);

    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const {
      data: invite,
      error: insertError,
    } = await admin
      .from("vendor_invites")
      .insert({
        vendor_id: vendorId,
        email,
        role,
        token_hash: tokenHash,
        status: "pending",
        invited_by: user.id,
        expires_at: expiresAt,
      })
      .select("id, email, role, expires_at")
      .single();

    if (insertError) {
      throw insertError;
    }

    const origin = request.nextUrl.origin;

    const inviteUrl =
      `${origin}/vendor/invite/${encodeURIComponent(rawToken)}`;

    const safeVendorName = escapeHtml(vendorName);
    const safeRoleLabel = escapeHtml(ROLE_LABELS[role]);
    const safeInviteUrl = escapeHtml(inviteUrl);

    const brevoResponse = await fetch(
      "https://api.brevo.com/v3/smtp/email",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": brevoApiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: "MintRadar",
            email: "support@themintradar.com",
          },
          to: [{ email }],
          subject: `${vendorName} invited you to MintRadar`,
          htmlContent: `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#09090b;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#09090b;padding:40px 16px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:#18181b;border:1px solid #27272a;border-radius:20px;">
            <tr>
              <td style="padding:36px;">
                <div style="font-size:26px;font-weight:900;letter-spacing:-1px;margin-bottom:28px;">
                  Mint<span style="color:#34d399;">Radar</span>
                </div>

                <div style="font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#34d399;margin-bottom:10px;">
                  Vendor Invitation
                </div>

                <h1 style="font-size:28px;line-height:1.2;margin:0 0 18px;font-weight:900;">
                  You've been invited.
                </h1>

                <p style="font-size:16px;line-height:1.7;color:#a1a1aa;margin:0 0 16px;">
                  <strong style="color:#ffffff;">${safeVendorName}</strong>
                  invited you to join their MintRadar team.
                </p>

                <p style="font-size:16px;line-height:1.7;color:#a1a1aa;margin:0 0 28px;">
                  Your team role will be
                  <strong style="color:#ffffff;">${safeRoleLabel}</strong>.
                </p>

                <table cellpadding="0" cellspacing="0" role="presentation">
                  <tr>
                    <td style="background:#34d399;border-radius:12px;">
                      <a
                        href="${safeInviteUrl}"
                        style="display:inline-block;padding:14px 22px;color:#000000;text-decoration:none;font-size:15px;font-weight:900;"
                      >
                        Accept Invitation
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="font-size:13px;line-height:1.6;color:#71717a;margin:28px 0 0;">
                  This invitation expires in 7 days. If you weren't expecting this invitation,
                  you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
          `.trim(),
          textContent: [
            "You've been invited to MintRadar.",
            "",
            `${vendorName} invited you to join their MintRadar team as ${ROLE_LABELS[role]}.`,
            "",
            `Accept your invitation: ${inviteUrl}`,
            "",
            "This invitation expires in 7 days.",
          ].join("\n"),
        }),
      }
    );

    if (!brevoResponse.ok) {
      const brevoError = await brevoResponse.text();

      console.error(
        "Brevo vendor invitation error:",
        brevoResponse.status,
        brevoError
      );

      await admin
        .from("vendor_invites")
        .delete()
        .eq("id", invite.id);

      return NextResponse.json(
        {
          error:
            "MintRadar created the invitation but could not send the email. Please try again.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expires_at: invite.expires_at,
      },
    });
  } catch (error: any) {
    console.error("Vendor invite send error:", error);

    return NextResponse.json(
      {
        error:
          error?.message ||
          "MintRadar could not send the invitation.",
      },
      { status: 500 }
    );
  }
}
