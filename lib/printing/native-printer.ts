import {
  registerPlugin,
} from "@capacitor/core";

export type NativePrinterModel =
  | "p31s"
  | "d11h";

export type NativePrinterConnectionResult = {
  connected: boolean;
  printerName?: string;
};

export type NativePrinterPrintOptions = {
  printerModel: NativePrinterModel;

  /**
   * Base64-encoded PNG representation
   * of the finished MintRadar label.
   *
   * The native printer bridge is responsible
   * for converting this image into the byte
   * format required by the selected printer.
   */
  imageBase64: string;

  width: number;
  height: number;

  copies?: number;
};

export interface MintRadarNativePrinterPlugin {
  isSupported(): Promise<{
    supported: boolean;
  }>;

  connect(options: {
    printerModel: NativePrinterModel;
  }): Promise<NativePrinterConnectionResult>;

  disconnect(options: {
    printerModel: NativePrinterModel;
  }): Promise<void>;

  print(
    options: NativePrinterPrintOptions
  ): Promise<void>;
}

export const MintRadarNativePrinter =
  registerPlugin<MintRadarNativePrinterPlugin>(
    "MintRadarNativePrinter"
  );