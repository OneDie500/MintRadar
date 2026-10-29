
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_URL =
  "https://api.tcgapi.dev/v1/identify?include=prices";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function errorResponse(
  message: string,
  status: number,
  code?: string
) {
  return NextResponse.json(
    {
      ok: false,
      ...(code ? { code } : {}),
      error: message,
    },
    { status }
  );
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.TCG_API_KEY;

  if (!apiKey) {
    return errorResponse(
      "TCG API key is not configured.",
      503,
      "MISSING_API_KEY"
    );
  }

  try {
    const contentType =
      request.headers.get("content-type") ?? "";

    if (
      !contentType
        .toLowerCase()
        .includes("multipart/form-data")
    ) {
      return errorResponse(
        "Please provide a card image.",
        400,
        "MISSING_IMAGE"
      );
    }

    let form: FormData;

    try {
      form = await request.formData();
    } catch {
      return errorResponse(
        "Invalid image upload.",
        400,
        "INVALID_FORM_DATA"
      );
    }

    const image = form.get("image");

    if (!(image instanceof File)) {
      return errorResponse(
        "Please provide a card image.",
        400,
        "MISSING_IMAGE"
      );
    }

    if (!ALLOWED_TYPES.has(image.type)) {
      return errorResponse(
        "Use a JPEG, PNG, or WebP image.",
        400,
        "INVALID_IMAGE_TYPE"
      );
    }

    if (
      image.size === 0 ||
      image.size > MAX_IMAGE_BYTES
    ) {
      return errorResponse(
        "Image must be between 1 byte and 8 MB.",
        400,
        "INVALID_IMAGE_SIZE"
      );
    }

    const upstreamForm = new FormData();

    upstreamForm.append(
      "image",
      image,
      image.name || "card.jpg"
    );

    let response: Response;

    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
        },
        body: upstreamForm,
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      console.error(
        "[MintRadar Scanner] Upstream connection failed:",
        error instanceof Error
          ? error.message
          : "Unknown connection error"
      );

      return errorResponse(
        "Unable to reach the card recognition service.",
        502,
        "UPSTREAM_CONNECTION_FAILED"
      );
    }

    const responseText = await response.text();

    let payload: unknown;

    try {
      payload = JSON.parse(responseText);
    } catch {
      console.error(
        "[MintRadar Scanner] Upstream returned non-JSON:",
        response.status
      );

      return errorResponse(
        "Card recognition returned an invalid response.",
        502,
        "INVALID_UPSTREAM_RESPONSE"
      );
    }

    if (!response.ok) {
      const errorPayload = payload as {
        error?: {
          code?: string;
          message?: string;
        } | string;
        message?: string;
      };

      const upstreamError =
        errorPayload?.error;

      const message =
        typeof upstreamError === "string"
          ? upstreamError
          : upstreamError?.message ||
            errorPayload?.message ||
            "Card recognition failed.";

      const code =
        typeof upstreamError === "object"
          ? upstreamError?.code
          : undefined;

      console.error(
        "[MintRadar Scanner] Recognition failed:",
        response.status,
        code ?? "UPSTREAM_ERROR"
      );

      return errorResponse(
        message,
        response.status >= 400 &&
          response.status <= 599
          ? response.status
          : 502,
        code ?? "UPSTREAM_ERROR"
      );
    }

    return NextResponse.json(
      {
        ...(payload &&
        typeof payload === "object" &&
        !Array.isArray(payload)
          ? payload
          : { data: payload }),
        ok: true,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error(
      "[MintRadar Scanner] Unexpected error:",
      error instanceof Error
        ? error.message
        : "Unknown error"
    );

    return errorResponse(
      "Unable to process the card image.",
      500,
      "INTERNAL_ERROR"
    );
  }
}
