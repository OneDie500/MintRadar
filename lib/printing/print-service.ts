import {
  MintRadarP31SWebPrinter,
} from "./printers/p31s";

import {
  MintRadarD110WebPrinter,
} from "./printers/d110";

import {
  MintRadarNativePrinter,
} from "./native-printer";

import {
  canvasToBase64Png,
} from "./canvas";

import {
  getMintRadarPlatform,
  getPreferredPrintTransport,
  isMintRadarNative,
} from "./platform";

import type {
  MintRadarPrinterModel,
  MintRadarPrintTransport,
} from "./types";

export type MintRadarPrinterState = {
  connected: boolean;

  printerName?: string;

  modelId?: number;

  printerModel: MintRadarPrinterModel;

  transport: MintRadarPrintTransport;
};

class MintRadarPrintService {
  private webP31S =
    new MintRadarP31SWebPrinter();

  private webD110 =
    new MintRadarD110WebPrinter();

  private nativeConnections =
    new Map<
      MintRadarPrinterModel,
      MintRadarPrinterState
    >();

  get platform() {
    return getMintRadarPlatform();
  }

  get native() {
    return isMintRadarNative();
  }

  get preferredTransport() {
    return getPreferredPrintTransport();
  }

  async isNativePrintingSupported() {
    if (!this.native) {
      return false;
    }

    try {
      const result =
        await MintRadarNativePrinter.isSupported();

      return Boolean(
        result.supported
      );
    } catch {
      return false;
    }
  }

  async connect(
    printerModel: MintRadarPrinterModel
  ): Promise<MintRadarPrinterState> {
    const transport =
      this.preferredTransport;

    if (
      transport ===
      "web-bluetooth"
    ) {
      if (
        printerModel ===
        "p31s"
      ) {
        const connection =
          await this.webP31S.connect();

        return {
          connected:
            connection.connected,

          printerName:
            connection.printerName,

          printerModel,

          transport:
            connection.transport,
        };
      }

      if (
        printerModel ===
        "niimbot_d110"
      ) {
        const connection =
          await this.webD110.connect();

        return {
          connected:
            connection.connected,

          printerName:
            connection.printerName,

          modelId:
            connection.modelId,

          printerModel,

          transport:
            connection.transport,
        };
      }

      throw new Error(
        `${printerModel.toUpperCase()} Web Bluetooth has not been connected to the MintRadar print service yet.`
      );
    }

    const supported =
      await this.isNativePrintingSupported();

    if (!supported) {
      throw new Error(
        "Native Bluetooth printing is not available in this MintRadar build."
      );
    }

    const result =
      await MintRadarNativePrinter.connect({
        printerModel,
      });

    const state: MintRadarPrinterState = {
      connected:
        result.connected,

      printerName:
        result.printerName,

      modelId:
        result.modelId,

      printerModel,

      transport,
    };

    this.nativeConnections.set(
      printerModel,
      state
    );

    return state;
  }

  async disconnect(
    printerModel: MintRadarPrinterModel
  ): Promise<void> {
    const transport =
      this.preferredTransport;

    if (
      transport ===
      "web-bluetooth"
    ) {
      if (
        printerModel ===
        "p31s"
      ) {
        await this.webP31S.disconnect();
        return;
      }

      if (
        printerModel ===
        "niimbot_d110"
      ) {
        await this.webD110.disconnect();
      }

      return;
    }

    await MintRadarNativePrinter.disconnect({
      printerModel,
    });

    this.nativeConnections.delete(
      printerModel
    );
  }

  isConnected(
    printerModel: MintRadarPrinterModel
  ): boolean {
    const transport =
      this.preferredTransport;

    if (
      transport ===
      "web-bluetooth"
    ) {
      if (
        printerModel ===
        "p31s"
      ) {
        return this.webP31S.connected;
      }

      if (
        printerModel ===
        "niimbot_d110"
      ) {
        return this.webD110.connected;
      }

      return false;
    }

    return Boolean(
      this.nativeConnections.get(
        printerModel
      )?.connected
    );
  }

  async printCanvas(
    printerModel: MintRadarPrinterModel,
    canvas: HTMLCanvasElement,
    copies = 1
  ): Promise<void> {
    const safeCopies =
      Math.max(
        1,
        Math.floor(copies)
      );

    const transport =
      this.preferredTransport;

    if (
      transport ===
      "web-bluetooth"
    ) {
      if (
        printerModel ===
        "p31s"
      ) {
        if (
          !this.webP31S.connected
        ) {
          throw new Error(
            "Connect to the P31S first."
          );
        }

        await this.webP31S.print({
          id: crypto.randomUUID(),

          printerModel:
            "p31s",

          canvas,

          copies:
            safeCopies,
        });

        return;
      }

      if (
        printerModel ===
        "niimbot_d110"
      ) {
        if (
          !this.webD110.connected
        ) {
          throw new Error(
            "Connect to the D110_M first."
          );
        }

        await this.webD110.print({
          id: crypto.randomUUID(),

          printerModel:
            "niimbot_d110",

          canvas,

          copies:
            safeCopies,
        });

        return;
      }

      throw new Error(
        `${printerModel.toUpperCase()} Web Bluetooth printing has not been connected to the MintRadar print service yet.`
      );
    }

    const supported =
      await this.isNativePrintingSupported();

    if (!supported) {
      throw new Error(
        "Native Bluetooth printing is not available in this MintRadar build."
      );
    }

    if (
      !this.isConnected(
        printerModel
      )
    ) {
      throw new Error(
        `Connect to the ${printerModel.toUpperCase()} first.`
      );
    }

    const imageBase64 =
      canvasToBase64Png(
        canvas
      );

    await MintRadarNativePrinter.print({
      printerModel,

      imageBase64,

      width:
        canvas.width,

      height:
        canvas.height,

      copies:
        safeCopies,
    });
  }
}

export const mintRadarPrintService =
  new MintRadarPrintService();