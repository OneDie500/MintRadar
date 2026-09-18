import { NextRequest, NextResponse } from "next/server";

const ISO_PRODUCTS_URL =
  "https://isothis.shop/public/products";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } =
      new URL(request.url);

    const query =
      searchParams.get("q")?.trim() ||
      "Bo Nix Yellow Surge Refractor";

    const url =
      new URL(ISO_PRODUCTS_URL);

    url.searchParams.set(
      "q",
      query
    );

    url.searchParams.set(
      "page",
      "1"
    );

    url.searchParams.set(
      "limit",
      "50"
    );

    const response =
      await fetch(
        url.toString(),
        {
          method: "GET",
          headers: {
            Accept:
              "application/json",
            "User-Agent":
              "MintRadar/0.1",
          },
          cache: "no-store",
        }
      );

    const rawText =
      await response.text();

    let payload: unknown;

    try {
      payload =
        JSON.parse(rawText);
    } catch {
      payload =
        rawText;
    }

    return NextResponse.json(
      {
        ok: response.ok,

        target: {
          name:
            "Bo Nix",

          year:
            "2024",

          manufacturer:
            "Topps",

          release:
            "Topps Resurgence",

          set:
            "Base Set",

          card_number:
            "125",

          parallel:
            "Yellow Surge Refractor",

          numbered_to:
            "225",

          cardsight_card_id:
            "187e4df7-2827-4977-b424-a0a1a9e2ff89",

          cardsight_parallel_id:
            "b6475f80-5fca-44a8-821f-e2950ebc54e3",
        },

        iso_request: {
          query,
          url:
            url.toString(),
          status:
            response.status,
        },

        iso:
          payload,
      },
      {
        status:
          response.ok
            ? 200
            : response.status,
      }
    );
  } catch (error: any) {
    console.error(
      "ISO sports image diagnostic error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error?.message ||
          "Unexpected ISO diagnostic error.",
      },
      {
        status: 500,
      }
    );
  }
}