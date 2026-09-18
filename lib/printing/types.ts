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