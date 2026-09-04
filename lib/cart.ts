import { supabase } from "./supabase";

export const GUEST_CART_STORAGE_KEY =
  "mintradar_guest_cart";

export type GuestCartItem = {
  inventory_id: string;
  quantity: number;
};

export function readGuestCart(): GuestCartItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(
      GUEST_CART_STORAGE_KEY
    );

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item: GuestCartItem) =>
        typeof item?.inventory_id === "string" &&
        item.inventory_id.length > 0 &&
        Number.isFinite(Number(item.quantity)) &&
        Number(item.quantity) > 0
    );
  } catch {
    return [];
  }
}

export function writeGuestCart(
  items: GuestCartItem[]
) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    GUEST_CART_STORAGE_KEY,
    JSON.stringify(items)
  );
}

export async function mergeGuestCartIntoAccount(
  userId: string
) {
  const guestItems = readGuestCart();

  if (guestItems.length === 0) {
    return {
      mergedCount: 0,
    };
  }

  const inventoryIds = guestItems.map(
    (item) => item.inventory_id
  );

  // Validate current inventory first so stale/deleted
  // guest-cart rows never get written into the account cart.
  const {
    data: inventoryRows,
    error: inventoryError,
  } = await supabase
    .from("inventory")
    .select("id, quantity")
    .in("id", inventoryIds);

  if (inventoryError) {
    throw inventoryError;
  }

  const availableById = new Map(
    (inventoryRows || []).map((row: any) => [
      row.id,
      Math.max(Number(row.quantity || 0), 0),
    ])
  );

  const validGuestItems = guestItems
    .map((item) => {
      const available =
        availableById.get(item.inventory_id) ?? 0;

      if (available <= 0) {
        return null;
      }

      return {
        inventory_id: item.inventory_id,
        quantity: Math.min(
          Math.max(Number(item.quantity || 1), 1),
          available
        ),
      };
    })
    .filter(
      (
        item
      ): item is GuestCartItem => Boolean(item)
    );

  if (validGuestItems.length === 0) {
    window.localStorage.removeItem(
      GUEST_CART_STORAGE_KEY
    );

    return {
      mergedCount: 0,
    };
  }

  const {
    data: existingRows,
    error: existingError,
  } = await supabase
    .from("cart_items")
    .select("inventory_id, quantity")
    .eq("user_id", userId)
    .in(
      "inventory_id",
      validGuestItems.map(
        (item) => item.inventory_id
      )
    );

  if (existingError) {
    throw existingError;
  }

  const existingById = new Map(
    (existingRows || []).map((row: any) => [
      row.inventory_id,
      Math.max(Number(row.quantity || 0), 0),
    ])
  );

  const rowsToUpsert = validGuestItems.map(
    (guestItem) => {
      const existingQuantity =
        existingById.get(
          guestItem.inventory_id
        ) ?? 0;

      const available =
        availableById.get(
          guestItem.inventory_id
        ) ?? guestItem.quantity;

      return {
        user_id: userId,
        inventory_id: guestItem.inventory_id,
        quantity: Math.min(
          existingQuantity + guestItem.quantity,
          available
        ),
        updated_at: new Date().toISOString(),
      };
    }
  );

  const {
    error: mergeError,
  } = await supabase
    .from("cart_items")
    .upsert(rowsToUpsert, {
      onConflict: "user_id,inventory_id",
    });

  if (mergeError) {
    throw mergeError;
  }

  // Clear only after the database merge succeeds.
  window.localStorage.removeItem(
    GUEST_CART_STORAGE_KEY
  );

  return {
    mergedCount: rowsToUpsert.length,
  };
}
