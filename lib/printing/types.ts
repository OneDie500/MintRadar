export type MintRadarPrinterModel =
  | "p31s"
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

/**
 * A physical Bluetooth labeler discovered by MintRadar.
 *
 * Discovery is intentionally separate from connection and printing.
 * Finding a device does not connect to it or change the active printer.
 */
export type MintRadarDiscoveredPrinter = {
  /**
   * CoreBluetooth peripheral identifier.
   *
   * This lets MintRadar distinguish between multiple nearby physical
   * labelers, including multiple printers of the same model.
   */
  deviceId: string;

  /**
   * Name reported by the Bluetooth peripheral or advertisement.
   */
  deviceName: string;

  /**
   * MintRadar printer-registry profile matched from the discovered hardware.
   *
   * Null means MintRadar discovered the Bluetooth device but could not
   * identify it as a supported printer profile.
   */
  profileId: MintRadarPrinterProfileId | null;

  /**
   * Whether MintRadar currently recognizes this hardware as a supported
   * printer.
   */
  supported: boolean;

  /**
   * Bluetooth signal strength reported during discovery.
   *
   * We can use this later to help order nearby printers without making
   * signal strength part of the connection or printing logic.
   */
  rssi?: number;
};