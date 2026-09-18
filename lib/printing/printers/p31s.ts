import {
  P31SWebPrinter,
  supportsWebBluetooth,
} from "@/lib/p31s-web";

import type {
  MintRadarPrintJob,
  MintRadarPrinter,
  MintRadarPrinterConnection,
  MintRadarPrintTransport,
} from "../types";

export class MintRadarP31SWebPrinter
  implements MintRadarPrinter
{
  readonly model = "p31s" as const;

  readonly transport: MintRadarPrintTransport =
    "web-bluetooth";

  private printer = new P31SWebPrinter();

  get connected() {
    return this.printer.connected;
  }

  async connect(): Promise<MintRadarPrinterConnection> {
    if (!supportsWebBluetooth()) {
      throw new Error(
        "Web Bluetooth is not available on this device."
      );
    }

    const printerName =
      await this.printer.connect();

    return {
      connected: true,
      printerName,
      transport: this.transport,
    };
  }

  async disconnect(): Promise<void> {
    await this.printer.disconnect();
  }

  async print(
    job: MintRadarPrintJob
  ): Promise<void> {
    if (job.printerModel !== "p31s") {
      throw new Error(
        `P31S driver cannot print a ${job.printerModel} job.`
      );
    }

    const copies = Math.max(
      1,
      Math.floor(job.copies ?? 1)
    );

    for (
      let copy = 0;
      copy < copies;
      copy += 1
    ) {
      await this.printer.printCanvas(
        job.canvas
      );
    }
  }
}