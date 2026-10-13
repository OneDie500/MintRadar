
"use client";

import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

/**
 * Opens external market research links.
 *
 * iOS: Capacitor Browser (SFSafariViewController)
 * Android: Capacitor Browser (Chrome Custom Tabs)
 * Web: Opens a regular new browser tab
 *
 * Note: Capacitor Browser does not guarantee launching
 * the installed app belonging to the destination website.
 */
export async function openMobileMarketLink(
  url: string
): Promise<void> {
  if (!/^https:\/\//i.test(url)) {
    console.warn("Blocked non-HTTPS market link:", url);
    return;
  }

  if (!Capacitor.isNativePlatform()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    await Browser.open({
      url,
      presentationStyle: "popover",
    });
  } catch (error) {
    console.error(
      "Could not open market link in native browser:",
      error
    );

    // Fallback to the device's external browser.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

import type { MouseEvent } from "react";

/**
 * Handles market-link clicks while preserving normal desktop
 * browser behavior and opening Capacitor Browser on mobile.
 */
export function openMarketCompLink(
  event: MouseEvent<HTMLAnchorElement>,
  url: string,
  copySearchTerms?: string
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  if (copySearchTerms && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(copySearchTerms).catch(() => {});
  }

  if (!Capacitor.isNativePlatform()) {
    return;
  }

  event.preventDefault();
  void openMobileMarketLink(url);
}
