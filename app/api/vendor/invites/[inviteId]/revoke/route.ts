import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VendorRole = "staff" | "manager" | "general_manager" | "owner";

const VALID_ROLES = new Set<VendorRole>([
  "staff",
  "manager",
  "general_manager",
  "owner",
]);

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

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      inviteId: string;
    }>;
  }
) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    !serviceRoleKey
  ) {
    console.error(
      "Vendor invite revoke configuration is incomplete."
    );

    return NextResponse.json(
      {
        error:
          "MintRadar invitation service is not configured correctly.",
      },
      {
        status: 500,
      }
    );
  }

  try {
    const authorization =
      request.headers.get("authorization");

    if (
      !authorization
        ?.toLowerCase()
        .startsWith("bearer ")
    ) {
      return NextResponse.json(
        {
          error:
            "You must be signed in to revoke an invitation.",
        },
        {
          status: 401,
        }
      );
    }

    const accessToken =
      authorization.slice(7).trim();

    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "You must be signed in to revoke an invitation.",
        },
        {
          status: 401,
        }
      );
    }

    const {
      inviteId,
    } = await context.params;

    const cleanInviteId =
      String(inviteId || "").trim();

    if (!cleanInviteId) {
      return NextResponse.json(
        {
          error:
            "That invitation could not be identified.",
        },
        {
          status: 400,
        }
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
      data: {
        user,
      },
      error: userError,
    } = await authClient.auth.getUser(
      accessToken
    );

    if (
      userError ||
      !user
    ) {
      return NextResponse.json(
        {
          error:
            "Your MintRadar session is not valid.",
        },
        {
          status: 401,
        }
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
      data: invite,
      error: inviteError,
    } = await admin
      .from("vendor_invites")
      .select(
        "id, vendor_id, email, role, status"
      )
      .eq(
        "id",
        cleanInviteId
      )
      .maybeSingle();

    if (inviteError) {
      throw inviteError;
    }

    if (!invite) {
      return NextResponse.json(
        {
          error:
            "That invitation could not be found.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      invite.status !== "pending"
    ) {
      return NextResponse.json(
        {
          error:
            "Only pending invitations can be revoked.",
        },
        {
          status: 409,
        }
      );
    }

    const targetRole =
      normalizeRole(
        invite.role
      );

    if (!targetRole) {
      return NextResponse.json(
        {
          error:
            "That invitation has an invalid vendor role.",
        },
        {
          status: 409,
        }
      );
    }

    const {
      data: membership,
      error: membershipError,
    } = await admin
      .from("vendor_members")
      .select(
        "vendor_id, role"
      )
      .eq(
        "vendor_id",
        invite.vendor_id
      )
      .eq(
        "user_id",
        user.id
      )
      .maybeSingle();

    if (membershipError) {
      throw membershipError;
    }

    if (!membership) {
      return NextResponse.json(
        {
          error:
            "You do not have access to the vendor that owns this invitation.",
        },
        {
          status: 403,
        }
      );
    }

    const {
      data: canManageInvite,
      error: permissionError,
    } = await admin.rpc(
      "can_invite_vendor_role",
      {
        p_vendor_id:
          invite.vendor_id,

        p_user_id:
          user.id,

        p_target_role:
          targetRole,
      }
    );

    if (permissionError) {
      throw permissionError;
    }

    if (!canManageInvite) {
      return NextResponse.json(
        {
          error:
            "Your vendor role does not have permission to revoke this invitation.",
        },
        {
          status: 403,
        }
      );
    }

    const {
      data: revokedInvite,
      error: revokeError,
    } = await admin
      .from("vendor_invites")
      .update({
        status: "revoked",
      })
      .eq(
        "id",
        invite.id
      )
      .eq(
        "status",
        "pending"
      )
      .select(
        "id, email, role, status"
      )
      .maybeSingle();

    if (revokeError) {
      throw revokeError;
    }

    if (!revokedInvite) {
      return NextResponse.json(
        {
          error:
            "That invitation is no longer pending.",
        },
        {
          status: 409,
        }
      );
    }

    return NextResponse.json({
      ok: true,
      invite: revokedInvite,
    });
  } catch (error: any) {
    console.error(
      "Vendor invitation revoke error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "MintRadar could not revoke that invitation.",
      },
      {
        status: 500,
      }
    );
  }
}
