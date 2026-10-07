export type MintRadarPrinterModel =
  | "p31s"
  | "niimbot_d110"
  | "d11h";

export type MintRadarPrintTransport =
  | "web-bluetooth"
  | "native-ios"
  | "native-android";

export type MintRadarPlatform =
  | "web"
  | "ios"
  | "android";

export type MintRadarPrintStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "printing"
  | "error";

export type MintRadarPrintJob = {
  id: string;

  printerModel: MintRadarPrinterModel;

  canvas: HTMLCanvasElement;

  copies?: number;
};

export type MintRadarDiscoveredPrinter = {
  deviceId: string;

  deviceName: string;

  profileId: MintRadarPrinterProfileId;

  supported: boolean;

  rssi?: number;
};

export type MintRadarPrinterConnection = {
  connected: boolean;

  printerName?: string;

  transport: MintRadarPrintTransport;
};

export interface MintRadarPrinter {
  readonly model: MintRadarPrinterModel;

  readonly transport: MintRadarPrintTransport;

  readonly connected: boolean;

  connect(): Promise<MintRadarPrinterConnection>;

  disconnect(): Promise<void>;

  print(job: MintRadarPrintJob): Promise<void>;
}

/**
 * Stable IDs used by the MintRadar printer picker/registry.
 *
 * These IDs describe user-selectable printer profiles. They are intentionally
 * separate from the transport implementation so a verified printer can keep
 * using its existing known-good connection/print path while the registry grows.
 */
export type MintRadarPrinterProfileId =
  | "p31s"
  | "d110"
  | "d11h";

export type MintRadarPrinterVerification =
  | "verified"
  | "pending";

export type MintRadarPrinterDriverFamily =
  | "p31s"
  | "niimbot-b1"
  | "niimbot";

export type MintRadarLabelOrientation =
  | "vertical"
  | "horizontal";

export type MintRadarPrinterOrientationSupport = {
  vertical: boolean;
  horizontal: boolean;
};

export type MintRadarPrinterPlatformSupport = {
  platform: MintRadarPlatform;
  transport: MintRadarPrintTransport;
};

export type MintRadarPrinterProfile = {
  id: MintRadarPrinterProfileId;

  displayName: string;

  manufacturer: string;

  modelName: string;

  verification: MintRadarPrinterVerification;

  driverFamily: MintRadarPrinterDriverFamily;

  orientations: MintRadarPrinterOrientationSupport;

  platformSupport: readonly MintRadarPrinterPlatformSupport[];
};

