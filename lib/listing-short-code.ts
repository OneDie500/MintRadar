const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const BASE =
  BigInt(
    BASE62.length
  );

function normalizeUuid(
  value: string
) {
  return value
    .trim()
    .toLowerCase()
    .replace(
      /-/g,
      ""
    );
}

export function encodeListingId(
  uuid: string
) {
  const hex =
    normalizeUuid(
      uuid
    );

  if (
    !/^[0-9a-f]{32}$/.test(
      hex
    )
  ) {
    throw new Error(
      "Invalid listing id."
    );
  }

  let value =
    BigInt(
      `0x${hex}`
    );

  if (
    value === BigInt(0)
  ) {
    return "0";
  }

  let encoded = "";

  while (
    value > BigInt(0)
  ) {
    const remainder =
      Number(
        value % BASE
      );

    encoded =
      BASE62[remainder] +
      encoded;

    value =
      value / BASE;
  }

  return encoded;
}

export function decodeListingId(
  code: string
) {
  const normalized =
    code.trim();

  if (
    !normalized ||
    normalized.length > 24
  ) {
    return null;
  }

  let value =
    BigInt(0);

  for (
    const character
    of normalized
  ) {
    const index =
      BASE62.indexOf(
        character
      );

    if (
      index < 0
    ) {
      return null;
    }

    value =
      value * BASE +
      BigInt(index);
  }

  const hex =
    value
      .toString(16)
      .padStart(
        32,
        "0"
      );

  if (
    hex.length !== 32
  ) {
    return null;
  }

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}