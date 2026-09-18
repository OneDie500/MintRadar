import { Capacitor } from "@capacitor/core";

import type {
  MintRadarPlatform,
  MintRadarPrintTransport,
} from "./types";

export function getMintRadarPlatform(): MintRadarPlatform {
  const platform = Capacitor.getPlatform();

  if (platform === "ios") {
    return "ios";
  }

  if (platform === "android") {
    return "android";
  }

  return "web";
}

export function isMintRadarNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function getPreferredPrintTransport(): MintRadarPrintTransport {
  const platform = getMintRadarPlatform();

  if (platform === "ios") {
    return "native-ios";
  }

  if (platform === "android" && isMintRadarNative()) {
    return "native-android";
  }

  return "web-bluetooth";
}