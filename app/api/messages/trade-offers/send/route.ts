import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OfferedItem = {
  inventory_id?: string | null;
  collection_item_id?: string | null;
  card_id?: string | null;
  snapshot?: Record<string, unknown> | null;
  quantity?: number;
  market_value?: number;
  trade_percentage?: number;
};

type SendTradeOfferBody = {
  conversationId?: string;
  senderVendorId?: string | null;

  targetInventoryId?: string | null;
  targetCardId?: string | null;
  targetSnapshot?: Record<string, unknown> | null;
  targetMarketValue?: number;

  offeredItems?: OfferedItem[];

  messageBody?: string;
};

function errorResponse(
  message: string,
  status = 400
) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    {
      status,
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error(
        "Trade offer API is missing Supabase environment variables."
      );

      return errorResponse(
        "MintRadar is missing required server configuration.",
        500
      );
    }

    const authorization =
      request.headers.get("authorization");

    if (
      !authorization ||
      !authorization.startsWith("Bearer ")
    ) {
      return errorResponse(
        "You must be signed in to send a trade offer.",
        401
      );
    }

    const accessToken =
      authorization.slice("Bearer ".length).trim();

    if (!accessToken) {
      return errorResponse(
        "You must be signed in to send a trade offer.",
        401
      );
    }

    const supabase = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      console.error(
        "Trade offer auth error:",
        userError
      );

      return errorResponse(
        "Your session is no longer valid. Sign in again and retry.",
        401
      );
    }

    let body: SendTradeOfferBody;

    try {
      body =
        (await request.json()) as SendTradeOfferBody;
    } catch {
      return errorResponse(
        "The trade offer request was invalid."
      );
    }

    const conversationId =
      body.conversationId?.trim();

    if (!conversationId) {
      return errorResponse(
        "Conversation is required."
      );
    }

    const offeredItems =
      Array.isArray(body.offeredItems)
        ? body.offeredItems
        : [];

    if (offeredItems.length === 0) {
      return errorResponse(
        "Add at least one card to your trade offer."
      );
    }

    const targetMarketValue =
      Number(body.targetMarketValue ?? 0);

    if (
      !Number.isFinite(targetMarketValue) ||
      targetMarketValue < 0
    ) {
      return errorResponse(
        "Enter a valid target market value."
      );
    }

    const normalizedItems: OfferedItem[] = [];

    for (const item of offeredItems) {
      const quantity =
        Number(item.quantity ?? 1);

      const marketValue =
        Number(item.market_value ?? 0);

      const tradePercentage =
        Number(item.trade_percentage ?? 100);

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return errorResponse(
          "Each offered card must have a valid quantity."
        );
      }

      if (
        !Number.isFinite(marketValue) ||
        marketValue < 0
      ) {
        return errorResponse(
          "Each offered card must have a valid market value."
        );
      }

      if (
        !Number.isFinite(tradePercentage) ||
        tradePercentage < 0
      ) {
        return errorResponse(
          "Each offered card must have a valid trade percentage."
        );
      }

      const inventoryId =
        item.inventory_id?.trim() || null;

      const collectionItemId =
        item.collection_item_id?.trim() || null;

      const cardId =
        item.card_id?.trim() || null;

      if (
        inventoryId &&
        collectionItemId
      ) {
        return errorResponse(
          "A trade item cannot come from both inventory and collection."
        );
      }

      // -------------------------------------
      // PERSONAL COLLECTION VALIDATION
      // -------------------------------------
      //
      // RLS already restricts collection_items
      // to auth.uid(), but we also explicitly
      // verify ownership and quantity here so
      // the API fails with a useful message.
      //
      if (collectionItemId) {
        const {
          data: collectionItem,
          error: collectionError,
        } = await supabase
          .from("collection_items")
          .select(
            "id, user_id, card_id, quantity"
          )
          .eq("id", collectionItemId)
          .maybeSingle();

        if (collectionError) {
          console.error(
            "Trade offer collection validation error:",
            collectionError
          );

          return errorResponse(
            "MintRadar could not verify one of your collection cards.",
            400
          );
        }

        if (!collectionItem) {
          return errorResponse(
            "One of the collection cards in this offer no longer exists or is not available to your account.",
            400
          );
        }

        if (
          collectionItem.user_id !==
          user.id
        ) {
          return errorResponse(
            "You cannot offer a collection card that does not belong to you.",
            403
          );
        }

        const availableQuantity =
          Number(
            collectionItem.quantity ?? 0
          );

        if (
          !Number.isFinite(
            availableQuantity
          ) ||
          availableQuantity <
            quantity
        ) {
          return errorResponse(
            "Trade quantity exceeds the quantity available in your collection.",
            400
          );
        }

        if (
          cardId &&
          collectionItem.card_id &&
          cardId !==
            collectionItem.card_id
        ) {
          return errorResponse(
            "The selected collection card does not match the supplied card.",
            400
          );
        }
      }

      normalizedItems.push({
        inventory_id:
          inventoryId,

        collection_item_id:
          collectionItemId,

        card_id:
          cardId,

        snapshot:
          item.snapshot &&
          typeof item.snapshot ===
            "object"
            ? item.snapshot
            : {},

        quantity,
        market_value:
          marketValue,
        trade_percentage:
          tradePercentage,
      });
    }

    const senderVendorId =
      body.senderVendorId?.trim() || null;

    const targetInventoryId =
      body.targetInventoryId?.trim() || null;

    const targetCardId =
      body.targetCardId?.trim() || null;

    const targetSnapshot =
      body.targetSnapshot &&
      typeof body.targetSnapshot === "object"
        ? body.targetSnapshot
        : {};

    const messageBody =
      body.messageBody?.trim() ||
      "Trade offer sent.";

    const { data, error } =
      await supabase.rpc(
        "send_trade_offer",
        {
          p_conversation_id:
            conversationId,

          p_sender_user_id:
            user.id,

          p_sender_vendor_id:
            senderVendorId,

          p_target_inventory_id:
            targetInventoryId,

          p_target_card_id:
            targetCardId,

          p_target_snapshot:
            targetSnapshot,

          p_target_market_value:
            targetMarketValue,

          p_offered_items:
            normalizedItems,

          p_message_body:
            messageBody,
        }
      );

    if (error) {
      console.error(
        "send_trade_offer RPC error:",
        error
      );

      const message =
        error.message ||
        "The trade offer could not be sent.";

      if (
        message
          .toLowerCase()
          .includes("access") ||
        message
          .toLowerCase()
          .includes("belong")
      ) {
        return errorResponse(
          message,
          403
        );
      }

      return errorResponse(
        message,
        400
      );
    }

    const result =
      Array.isArray(data) &&
      data.length > 0
        ? data[0]
        : null;

    if (!result?.trade_offer_id) {
      console.error(
        "Trade offer RPC returned no offer ID:",
        data
      );

      return errorResponse(
        "MintRadar created an unexpected trade offer response.",
        500
      );
    }

    return NextResponse.json({
      ok: true,

      tradeOffer: {
        id: result.trade_offer_id,
        messageId:
          result.message_id ?? null,
      },
    });
  } catch (error: any) {
    console.error(
      "Trade offer send API error:",
      error
    );

    return errorResponse(
      error?.message ||
        "Something went wrong while sending the trade offer.",
      500
    );
  }
}
