import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function hashToken(token: string) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

export async function POST(
  request: NextRequest
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
      "Vendor invite acceptance configuration is incomplete."
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
            "You must be signed in to accept this invitation.",
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
            "You must be signed in to accept this invitation.",
        },
        {
          status: 401,
        }
      );
    }

    const body = await request.json();

    const rawToken =
      String(body?.token || "").trim();

    if (!rawToken) {
      return NextResponse.json(
        {
          error:
            "This MintRadar invitation link is invalid.",
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

    const userEmail =
      normalizeEmail(user.email);

    if (!userEmail) {
      return NextResponse.json(
        {
          error:
            "Your MintRadar account must have an email address.",
        },
        {
          status: 400,
        }
      );
    }

    const tokenHash =
      hashToken(rawToken);

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
      data,
      error: acceptError,
    } = await admin.rpc(
      "accept_vendor_invite",
      {
        p_token_hash: tokenHash,
        p_user_id: user.id,
        p_user_email: userEmail,
      }
    );

    if (acceptError) {
      const message =
        acceptError.message ||
        "MintRadar could not accept this invitation.";

      const lowerMessage =
        message.toLowerCase();

      let status = 400;

      if (
        lowerMessage.includes(
          "already has access"
        )
      ) {
        status = 409;
      } else if (
        lowerMessage.includes(
          "sign in with the email"
        )
      ) {
        status = 403;
      } else if (
        lowerMessage.includes(
          "no longer pending"
        )
      ) {
        status = 409;
      } else if (
        lowerMessage.includes(
          "expired"
        )
      ) {
        status = 410;
      } else if (
        lowerMessage.includes(
          "invalid"
        )
      ) {
        status = 404;
      }

      return NextResponse.json(
        {
          error: message,
        },
        {
          status,
        }
      );
    }

    const accepted =
      Array.isArray(data)
        ? data[0]
        : data;

    if (
      !accepted?.vendor_id
    ) {
      throw new Error(
        "MintRadar accepted the invitation but could not identify the vendor."
      );
    }

    return NextResponse.json({
      ok: true,
      membership: {
        vendor_id:
          accepted.vendor_id,
        role:
          accepted.role,
        business_name:
          accepted.business_name,
      },
    });
  } catch (error: any) {
    console.error(
      "Vendor invitation acceptance error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "MintRadar could not accept this invitation.",
      },
      {
        status: 500,
      }
    );
  }
}
