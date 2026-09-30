import type {
  MintRadarLabelOrientation,
  MintRadarPlatform,
  MintRadarPrintTransport,
  MintRadarPrinterProfile,
  MintRadarPrinterProfileId,
} from "./types";

/**
 * MintRadar Printer Registry v1
 *
 * This registry is descriptive on purpose. It does not replace or reroute any
 * existing printer driver, renderer, Bluetooth transport, or native bridge.
 *
 * VERIFIED means the current MintRadar label path has been physically tested
 * on that printer.
 *
 * PENDING means the profile can exist in MintRadar while physical hardware
 * verification is still required before certification.
 */
export const MINT_RADAR_PRINTERS: readonly MintRadarPrinterProfile[] = [
  {
    id: "p31s",
    displayName: "Polono P31S",
    manufacturer: "Polono",
    modelName: "P31S",
    verification: "verified",
    driverFamily: "p31s",
    orientations: {
      vertical: true,
      horizontal: true,
    },
    platformSupport: [
      {
        platform: "web",
        transport: "web-bluetooth",
      },
      {
        platform: "ios",
        transport: "native-ios",
      },
    ],
  },
  {
    id: "d110",
    displayName: "NIIMBOT D110_M",
    manufacturer: "NIIMBOT",
    modelName: "D110_M",
    verification: "verified",
    driverFamily: "niimbot-b1",
    orientations: {
      vertical: true,
      horizontal: true,
    },
    platformSupport: [
      {
        platform: "ios",
        transport: "native-ios",
      },
    ],
  },
  {
    id: "d11h",
    displayName: "NIIMBOT D11_H",
    manufacturer: "NIIMBOT",
    modelName: "D11_H",
    verification: "pending",
    driverFamily: "niimbot",
    orientations: {
      vertical: true,
      horizontal: true,
    },
    platformSupport: [
      {
        platform: "web",
        transport: "web-bluetooth",
      },
    ],
  },
];

export function getMintRadarPrinterProfile(
  printerId: MintRadarPrinterProfileId
): MintRadarPrinterProfile {
  const profile = MINT_RADAR_PRINTERS.find(
    (printer) => printer.id === printerId
  );

  if (!profile) {
    throw new Error(
      `Unknown MintRadar printer profile: ${printerId}`
    );
  }

  return profile;
}

export function getMintRadarPrinterProfiles(): readonly MintRadarPrinterProfile[] {
  return MINT_RADAR_PRINTERS;
}

export function isMintRadarPrinterVerified(
  printerId: MintRadarPrinterProfileId
): boolean {
  return (
    getMintRadarPrinterProfile(printerId).verification ===
    "verified"
  );
}

export function supportsMintRadarOrientation(
  printerId: MintRadarPrinterProfileId,
  orientation: MintRadarLabelOrientation
): boolean {
  return Boolean(
    getMintRadarPrinterProfile(printerId).orientations[
      orientation
    ]
  );
}

export function getMintRadarPrinterTransport(
  printerId: MintRadarPrinterProfileId,
  platform: MintRadarPlatform
): MintRadarPrintTransport | null {
  return (
    getMintRadarPrinterProfile(
      printerId
    ).platformSupport.find(
      (support) => support.platform === platform
    )?.transport ?? null
  );
}

export function isMintRadarPrinterAvailableOnPlatform(
  printerId: MintRadarPrinterProfileId,
  platform: MintRadarPlatform
): boolean {
  return (
    getMintRadarPrinterTransport(
      printerId,
      platform
    ) !== null
  );
}
