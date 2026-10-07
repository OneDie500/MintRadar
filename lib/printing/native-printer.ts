import {
  registerPlugin,
} from "@capacitor/core";

import type {
  MintRadarDiscoveredPrinter,
} from "./types";

export type NativePrinterModel =
  | "p31s"
  | "niimbot_d110"
  | "d11h";

export type NativePrinterConnectionResult = {
  connected: boolean;
  printerName?: string;
  modelId?: number;
};

export type NativePrinterDiscoveryResult = {
  printers: MintRadarDiscoveredPrinter[];
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

  /**
   * Scan for nearby Bluetooth labelers that MintRadar
   * can identify.
   *
   * Discovery does not connect to a printer and does
   * not change the currently selected printer.
   */
  findPrinters(): Promise<NativePrinterDiscoveryResult>;

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