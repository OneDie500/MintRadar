export const NIIMBOT_D11H_MODEL = {
  id: 528,
  name: "D11_H",
  name_prefixes: [
    "D11",
  ],
  task: "v4",
  dpi: 300,
  density: 3,
  label_type: 1,
  speed: 1,
};

export const NIIMBOT_D11H_SIZE = {
  id: "T12x40",
  code: "T12*40",
  label:
    "12 × 40 mm (D11_H)",

  w_mm: 12,
  h_mm: 40,

  // D11_H reports a 144 px printhead.
  // 12 mm stock is approximately 142 px at 300 dpi.
  w_px: 142,

  // 40 mm at approximately 11.8 px/mm.
  h_px: 472,

  margin: 6,

  // The package's validated 12 mm D11_H stock uses
  // a -6 px registration offset. We carry that forward
  // for the same 12 mm media width.
  offset_y_px: -6,

  dpi: 300,
};

type BluetoothLike = {
  requestDevice: (
    options: Record<
      string,
      unknown
    >
  ) => Promise<any>;
};

type NiimbotGlobal = {
  isSupported: () =>
    boolean;

  identify: (
    model: Record<
      string,
      unknown
    >
  ) => Promise<any>;

  printImage: (
    image: string,
    options: {
      model: Record<
        string,
        unknown
      >;

      size: Record<
        string,
        unknown
      >;

      copies?: number;

      onProgress?: (
        status: unknown
      ) => void;
    }
  ) => Promise<any>;

  printer?: {
    modelId?:
      number | null;

    protocolVersion?:
      number | null;

    label?:
      string | null;

    task?:
      string | null;

    dpi?:
      number | null;
  };
};

declare global {
  interface Window {
    Niimbot?:
      NiimbotGlobal;
  }
}

let driverPromise:
  | Promise<NiimbotGlobal>
  | null = null;

function getBluetooth():
  | BluetoothLike
  | null {
  if (
    typeof navigator ===
    "undefined"
  ) {
    return null;
  }

  const nav =
    navigator as Navigator & {
      bluetooth?:
        BluetoothLike;
    };

  return (
    nav.bluetooth ||
    null
  );
}

function getDriverUrl() {
  return "/niimbot/niimbot.js";
}

export function supportsNiimbotWebBluetooth() {
  if (
    typeof window ===
    "undefined"
  ) {
    return false;
  }

  return Boolean(
    getBluetooth()
  );
}

export async function loadNiimbotDriver() {
  if (
    typeof window ===
    "undefined"
  ) {
    throw new Error(
      "Niimbot printing is only available in the browser."
    );
  }

  if (
    window.Niimbot
  ) {
    return window.Niimbot;
  }

  if (
    driverPromise
  ) {
    return driverPromise;
  }

  driverPromise =
    new Promise<NiimbotGlobal>(
      (
        resolve,
        reject
      ) => {
        const existing =
          document.querySelector(
            'script[data-mintradar-niimbot="true"]'
          ) as HTMLScriptElement | null;

        if (
          existing
        ) {
          existing.addEventListener(
            "load",
            () => {
              if (
                window.Niimbot
              ) {
                resolve(
                  window.Niimbot
                );
              } else {
                reject(
                  new Error(
                    "Niimbot driver loaded but did not initialize."
                  )
                );
              }
            }
          );

          existing.addEventListener(
            "error",
            () => {
              reject(
                new Error(
                  "MintRadar could not load the Niimbot driver."
                )
              );
            }
          );

          return;
        }

        const script =
          document.createElement(
            "script"
          );

        script.src =
          getDriverUrl();

        script.async =
          true;

        script.dataset.mintradarNiimbot =
          "true";

        script.onload =
          () => {
            if (
              window.Niimbot
            ) {
              resolve(
                window.Niimbot
              );
            } else {
              reject(
                new Error(
                  "Niimbot driver loaded but did not initialize."
                )
              );
            }
          };

        script.onerror =
          () => {
            reject(
              new Error(
                "MintRadar could not load the Niimbot driver."
              )
            );
          };

        document.head.appendChild(
          script
        );
      }
    );

  return driverPromise;
}

export async function identifyD11H() {
  const driver =
    await loadNiimbotDriver();

  if (
    !driver.isSupported()
  ) {
    throw new Error(
      "Web Bluetooth is not available in this browser/device."
    );
  }

  await driver.identify(
    NIIMBOT_D11H_MODEL
  );

  const detectedModelId =
    driver.printer
      ?.modelId;

  if (
    detectedModelId &&
    detectedModelId !==
      NIIMBOT_D11H_MODEL.id
  ) {
    throw new Error(
      `Connected Niimbot is model ${detectedModelId}, not D11_H.`
    );
  }

  return (
    driver.printer ||
    null
  );
}

export async function printD11HImage(
  imageDataUrl: string
) {
  const driver =
    await loadNiimbotDriver();

  if (
    !driver.isSupported()
  ) {
    throw new Error(
      "Web Bluetooth is not available in this browser/device."
    );
  }

  return driver.printImage(
    imageDataUrl,
    {
      model:
        NIIMBOT_D11H_MODEL,

      size:
        NIIMBOT_D11H_SIZE,

      copies: 1,
    }
  );
}
