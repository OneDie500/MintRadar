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

  private clearConnection() {
    this.writeCharacteristic =
      null;
  }

  private forgetDevice() {
    this.clearConnection();
    this.device = null;
  }

  async connect() {
    const bluetooth =
      getBluetooth();

    if (!bluetooth) {
      throw new Error(
        "Web Bluetooth is not available in this browser."
      );
    }

    if (this.connected) {
      return (
        this.device?.name ||
        "P31S"
      );
    }

    // Keep the selected P31S across its wake cycle. A cold printer can
    // initially connect before ff00/ff02 are exposed.
    if (!this.device) {
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
    }

    if (!this.device) {
      this.forgetDevice();

      throw new Error(
        "No Bluetooth device was selected."
      );
    }

    let lastError: any = null;

    // Attempt 1 wakes a cold printer. Attempt 2 reconnects to the SAME
    // selected device instead of reopening the browser chooser.
    for (
      let attempt = 0;
      attempt < 2;
      attempt += 1
    ) {
      try {
        this.clearConnection();

        if (
          this.device?.gatt
            ?.connected
        ) {
          this.device
            .gatt
            .disconnect();

          await sleep(250);
        }

        const server =
          await this.device
            .gatt
            .connect();

        await sleep(
          attempt === 0
            ? 900
            : 1600
        );

        const service =
          await server
            .getPrimaryService(
              P31S_SERVICE_UUID
            );

        this.writeCharacteristic =
          await service
            .getCharacteristic(
              P31S_WRITE_UUID
            );

        await sleep(250);

        return (
          this.device?.name ||
          "P31S"
        );
      } catch (
        error: any
      ) {
        lastError = error;

        console.error(
          `P31S connection attempt ${attempt + 1} error:`,
          error
        );

        this.clearConnection();

        try {
          if (
            this.device?.gatt
              ?.connected
          ) {
            this.device
              .gatt
              .disconnect();
          }
        } catch {
          // Ignore cleanup errors.
        }

        if (attempt === 0) {
          // Preserve this device and give the printer time to expose ff00.
          await sleep(1200);
          continue;
        }
      }
    }

    // Only forget after both attempts fail. The next explicit Connect action
    // can then reopen the chooser for a genuinely fresh selection.
    this.forgetDevice();

    console.error(
      "P31S connection failed after automatic wake retry:",
      lastError
    );

    throw new Error(
      "Could not connect to the P31S label service. Make sure the printer is awake, then tap Connect & Print again."
    );
  }

  async disconnect() {
    try {
      if (
        this.device?.gatt
          ?.connected
      ) {
        this.device
          .gatt
          .disconnect();
      }
    } catch {
      // Ignore cleanup errors.
    }

    this.forgetDevice();
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

      await sleep(
        30
      );
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
