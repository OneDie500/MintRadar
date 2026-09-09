import type { SupabaseClient } from "@supabase/supabase-js";

export type VendorRole =
  | "staff"
  | "manager"
  | "general_manager"
  | "owner";

export type ActiveVendorMembership = {
  vendor_id: string;
  role: VendorRole;
  vendor: {
    id: string;
    business_name: string | null;
  } | null;
};

type VendorMembershipRow = {
  vendor_id: string;
  role: string;
};

const ACTIVE_VENDOR_STORAGE_KEY =
  "mintradar_active_vendor_id";

function isVendorRole(value: string): value is VendorRole {
  return (
    value === "staff" ||
    value === "manager" ||
    value === "general_manager" ||
    value === "owner"
  );
}

export function getStoredActiveVendorId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(
      ACTIVE_VENDOR_STORAGE_KEY
    );
  } catch {
    return null;
  }
}

export function setStoredActiveVendorId(
  vendorId: string
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      ACTIVE_VENDOR_STORAGE_KEY,
      vendorId
    );
  } catch {
    // Ignore localStorage failures.
  }
}

export function clearStoredActiveVendorId(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(
      ACTIVE_VENDOR_STORAGE_KEY
    );
  } catch {
    // Ignore localStorage failures.
  }
}

async function loadMemberships(
  supabase: SupabaseClient,
  userId: string
): Promise<ActiveVendorMembership[]> {
  const { data, error } = await supabase
    .from("vendor_members")
    .select("vendor_id, role")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as VendorMembershipRow[];

  const memberships: ActiveVendorMembership[] = [];

  for (const row of rows) {
    if (!isVendorRole(row.role)) {
      continue;
    }

    const { data: vendor, error: vendorError } =
      await supabase
        .from("vendors")
        .select("id, business_name")
        .eq("id", row.vendor_id)
        .maybeSingle();

    if (vendorError) {
      throw vendorError;
    }

    memberships.push({
      vendor_id: row.vendor_id,
      role: row.role,
      vendor: vendor
        ? {
            id: vendor.id,
            business_name: vendor.business_name ?? null,
          }
        : null,
    });
  }

  return memberships;
}

export async function getVendorMemberships(
  supabase: SupabaseClient,
  userId: string
): Promise<ActiveVendorMembership[]> {
  return loadMemberships(supabase, userId);
}

export async function getActiveVendorMembership(
  supabase: SupabaseClient,
  userId: string
): Promise<ActiveVendorMembership | null> {
  const memberships = await loadMemberships(
    supabase,
    userId
  );

  if (memberships.length === 0) {
    clearStoredActiveVendorId();
    return null;
  }

  const storedVendorId = getStoredActiveVendorId();

  if (storedVendorId) {
    const storedMembership = memberships.find(
      (membership) =>
        membership.vendor_id === storedVendorId
    );

    if (storedMembership) {
      return storedMembership;
    }
  }

  const fallbackMembership = memberships[0];

  setStoredActiveVendorId(
    fallbackMembership.vendor_id
  );

  return fallbackMembership;
}

export async function switchActiveVendor(
  supabase: SupabaseClient,
  userId: string,
  vendorId: string
): Promise<ActiveVendorMembership> {
  const memberships = await loadMemberships(
    supabase,
    userId
  );

  const membership = memberships.find(
    (item) => item.vendor_id === vendorId
  );

  if (!membership) {
    throw new Error(
      "You do not have access to that MintRadar vendor."
    );
  }

  setStoredActiveVendorId(vendorId);

  return membership;
}