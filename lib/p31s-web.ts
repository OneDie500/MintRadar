export const P31S_SERVICE_UUID =
  "0000ff00-0000-1000-8000-00805f9b34fb";

export const P31S_WRITE_UUID =
  "0000ff02-0000-1000-8000-00805f9b34fb";

export const P31S_CANVAS_WIDTH = 320;
export const P31S_CANVAS_HEIGHT = 112;

type BluetoothLike = {
  requestDevice: (
    options: Record<string, unknown>
  ) => Promise<any>;
};

function getBluetooth(): BluetoothLike | null {
  if (
    typeof navigator ===
    "undefined"
  ) {
    return null;
  }

  const nav =
    navigator as Navigator & {
      bluetooth?: BluetoothLike;
    };

  return nav.bluetooth || null;
}

export function supportsWebBluetooth() {
  return Boolean(
    getBluetooth()
  );
}

function sleep(ms: number) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function concatBytes(
  ...parts: Uint8Array[]
) {
  const length =
    parts.reduce(
      (
        sum,
        part
      ) =>
        sum +
        part.length,
      0
    );

  const merged =
    new Uint8Array(
      length
    );

  let offset = 0;

  for (
    const part
    of parts
  ) {
    merged.set(
      part,
      offset
    );

    offset +=
      part.length;
  }

  return merged;
}

function canvasToBitmap(
  source: HTMLCanvasElement
) {
  const rotated =
    document.createElement(
      "canvas"
    );

  rotated.width = 112;
  rotated.height = 320;

  const ctx =
    rotated.getContext(
      "2d",
      {
        willReadFrequently:
          true,
      }
    );

  if (!ctx) {
    throw new Error(
      "Could not create printer bitmap."
    );
  }

  ctx.fillStyle = "#fff";

  ctx.fillRect(
    0,
    0,
    rotated.width,
    rotated.height
  );

  ctx.save();

  ctx.translate(
    rotated.width,
    0
  );

  ctx.rotate(
    Math.PI / 2
  );

  ctx.drawImage(
    source,
    0,
    0
  );

  ctx.restore();

  const image =
    ctx.getImageData(
      0,
      0,
      rotated.width,
      rotated.height
    );

  const widthBytes =
    Math.ceil(
      rotated.width / 8
    );

  const bitmap =
    new Uint8Array(
      widthBytes *
        rotated.height
    );

  for (
    let y = 0;
    y <
    rotated.height;
    y += 1
  ) {
    for (
      let byteX = 0;
      byteX <
      widthBytes;
      byteX += 1
    ) {
      let byteValue = 0;

      for (
        let bit = 0;
        bit < 8;
        bit += 1
      ) {
        const x =
          byteX *
            8 +
          bit;

        let white = true;

        if (
          x <
          rotated.width
        ) {
          const i =
            (
              y *
                rotated.width +
              x
            ) *
            4;

          const lum =
            image.data[i] *
              0.299 +
            image.data[
              i + 1
            ] *
              0.587 +
            image.data[
              i + 2
            ] *
              0.114;

          white =
            image.data[
              i + 3
            ] <
              128 ||
            lum >= 128;
        }

        if (white) {
          byteValue |=
            0x80 >>
            bit;
        }
      }

      bitmap[
        y *
          widthBytes +
          byteX
      ] =
        byteValue;
    }
  }

  return {
    widthBytes,
    height:
      rotated.height,
    bitmap,
  };
}

function buildCommand(
  canvas: HTMLCanvasElement
) {
  const {
    widthBytes,
    height,
    bitmap,
  } =
    canvasToBitmap(
      canvas
    );

  const enc =
    new TextEncoder();

  const header =
    enc.encode(
      `SIZE 14.0 mm,40.0 mm\r\nGAP 5.0 mm,0 mm\r\nDIRECTION 0,0\r\nDENSITY 15\r\nCLS\r\nBITMAP 0,0,${widthBytes},${height},1,`
    );

  const footer =
    enc.encode(
      "\r\nPRINT 1\r\n"
    );

  return concatBytes(
    header,
    bitmap,
    footer
  );
}

export class P31SWebPrinter {
  private device: any =
    null;

  private writeCharacteristic:
    any = null;

  get connected() {
    return Boolean(
      this.device?.gatt
        ?.connected &&
        this
          .writeCharacteristic
    );
  }

  private clearCharacteristic() {
    this.writeCharacteristic =
      null;
  }

  private async ensureGattConnection() {
    if (
      !this.device?.gatt
    ) {
      throw new Error(
        "The selected Bluetooth device does not support a GATT connection."
      );
    }

    if (
      this.device.gatt
        .connected
    ) {
      return this.device
        .gatt;
    }

    return await this.device
      .gatt
      .connect();
  }

  private async discoverPrintService(
    server: any
  ) {
    let lastError:
      any = null;

    // --------------------------------------------------
    // P31S COLD-START SERVICE DISCOVERY
    //
    // The first Bluetooth selection successfully wakes
    // the printer, but ff00/ff02 can take several seconds
    // to become available. Keep the SAME GATT connection
    // alive and retry discovery instead of disconnecting.
    // --------------------------------------------------

    const waits = [
      1800,
      2200,
      2800,
      3500,
    ];

    for (
      let attempt = 0;
      attempt <
      waits.length;
      attempt += 1
    ) {
      try {
        await sleep(
          waits[
            attempt
          ]
        );

        const service =
          await server
            .getPrimaryService(
              P31S_SERVICE_UUID
            );

        const characteristic =
          await service
            .getCharacteristic(
              P31S_WRITE_UUID
            );

        return characteristic;
      } catch (
        error
      ) {
        lastError =
          error;

        console.warn(
          `P31S service discovery attempt ${
            attempt + 1
          } failed.`,
          error
        );

        // If Chrome/macOS dropped GATT on its own,
        // reconnect the SAME selected device and continue.
        if (
          !this.device
            ?.gatt
            ?.connected
        ) {
          try {
            server =
              await this.device
                .gatt
                .connect();

            await sleep(
              700
            );
          } catch (
            reconnectError
          ) {
            lastError =
              reconnectError;
          }
        }
      }
    }

    console.error(
      "P31S print service did not become available:",
      lastError
    );

    throw new Error(
      "MintRadar connected to the P31S, but its print service did not become ready in time. Keep the printer powered on and try Connect & Print again."
    );
  }

  async connect() {
    const bluetooth =
      getBluetooth();

    if (!bluetooth) {
      throw new Error(
        "Web Bluetooth is not available in this browser."
      );
    }

    if (
      this.connected
    ) {
      return (
        this.device
          ?.name ||
        "P31S"
      );
    }

    this.clearCharacteristic();

    // --------------------------------------------------
    // REUSE THE SAME DEVICE IF IT WAS ALREADY SELECTED
    // --------------------------------------------------

    if (
      !this.device
    ) {
      this.device =
        await bluetooth
          .requestDevice({
            acceptAllDevices:
              true,

            optionalServices:
              [
                P31S_SERVICE_UUID,
              ],
          });

      if (
        !this.device
      ) {
        throw new Error(
          "No Bluetooth device was selected."
        );
      }

      if (
        typeof this.device
          .addEventListener ===
        "function"
      ) {
        this.device
          .addEventListener(
            "gattserverdisconnected",
            () => {
              this.clearCharacteristic();
            }
          );
      }
    }

    try {
      let server =
        await this
          .ensureGattConnection();

      // Initial settle time before the longer
      // discovery loop begins.
      await sleep(
        700
      );

      this.writeCharacteristic =
        await this
          .discoverPrintService(
            server
          );

      // Give the characteristic a moment to settle
      // before the first write.
      await sleep(
        300
      );

      return (
        this.device
          ?.name ||
        "P31S"
      );
    } catch (
      error: any
    ) {
      this.clearCharacteristic();

      console.error(
        "P31S connection error:",
        error
      );

      throw new Error(
        error?.message ||
          "MintRadar could not connect to the P31S."
      );
    }
  }

  async disconnect() {
    if (
      this.device?.gatt
        ?.connected
    ) {
      try {
        this.device
          .gatt
          .disconnect();
      } catch {
        // Ignore disconnect errors.
      }
    }

    this.clearCharacteristic();
    this.device = null;
  }

  private async send(
    bytes: Uint8Array
  ) {
    if (
      !this
        .writeCharacteristic
    ) {
      throw new Error(
        "Connect to the P31S first."
      );
    }

    for (
      let i = 0;
      i <
      bytes.length;
      i += 180
    ) {
      const chunk =
        bytes.slice(
          i,
          i + 180
        );

      if (
        typeof this
          .writeCharacteristic
          .writeValueWithoutResponse ===
        "function"
      ) {
        await this
          .writeCharacteristic
          .writeValueWithoutResponse(
            chunk
          );
      } else {
        await this
          .writeCharacteristic
          .writeValue(
            chunk
          );
      }

      await sleep(30);
    }
  }

  async printCanvas(
    canvas: HTMLCanvasElement
  ) {
    if (
      !this.connected
    ) {
      throw new Error(
        "Connect to the P31S first."
      );
    }

    await this.send(
      new Uint8Array([
        0x1b,
        0x21,
        0x6f,
        0x0d,
        0x0a,
      ])
    );

    await sleep(
      250
    );

    await this.send(
      buildCommand(
        canvas
      )
    );

    await sleep(
      2000
    );
  }
}
