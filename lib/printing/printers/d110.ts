import {
  disconnectD110,
  identifyD110,
  printD110Image,
} from "../../niimbot-web";

import type {
  MintRadarPrintJob,
  MintRadarPrinter,
  MintRadarPrinterConnection,
} from "../types";

export class MintRadarD110WebPrinter
  implements MintRadarPrinter
{
  readonly model =
    "niimbot_d110" as const;

  readonly transport =
    "web-bluetooth" as const;

  private isConnected = false;
  private detectedModelId:
    | number
    | null = null;
  private detectedPrinterName =
    "NIIMBOT D110_M";

  get connected() {
    return this.isConnected;
  }

  get modelId() {
    return this.detectedModelId;
  }

  get printerName() {
    return this.detectedPrinterName;
  }

  async connect(): Promise<
    MintRadarPrinterConnection & {
      modelId?: number;
    }
  > {
    const printer =
      await identifyD110();

    const modelId =
      Number(printer?.modelId);

    if (
      Number.isFinite(modelId)
    ) {
      this.detectedModelId =
        modelId;
    }

    this.detectedPrinterName =
      printer?.label ||
      "NIIMBOT D110_M";

    this.isConnected = true;

    return {
      connected: true,
      printerName:
        this.detectedPrinterName,
      transport:
        this.transport,
      ...(this.detectedModelId !== null
        ? {
            modelId:
              this.detectedModelId,
          }
        : {}),
    };
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    await disconnectD110();

    this.isConnected = false;
    this.detectedModelId = null;
  }

  async print(
    job: MintRadarPrintJob
  ): Promise<void> {
    if (!this.isConnected) {
      throw new Error(
        "Connect to the NIIMBOT D110_M first."
      );
    }

    if (
      job.canvas.width % 8 !== 0
    ) {
      throw new Error(
        "D110_M label width must be a multiple of 8 pixels."
      );
    }

    await printD110Image(
      job.canvas.toDataURL(
        "image/png"
      ),
      job.canvas.width,
      job.canvas.height,
      job.copies ?? 1
    );
  }
}
