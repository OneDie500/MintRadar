import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  decodeListingId,
} from "../../../lib/listing-short-code";

export const dynamic =
  "force-dynamic";

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{
      code: string;
    }>;
  }
) {
  const {
    code,
  } = await context.params;

  const listingId =
    decodeListingId(
      code
    );

  if (
    !listingId
  ) {
    return NextResponse.redirect(
      new URL(
        "/",
        request.url
      )
    );
  }

  return NextResponse.redirect(
    new URL(
      `/listing/${listingId}`,
      request.url
    ),
    307
  );
}
