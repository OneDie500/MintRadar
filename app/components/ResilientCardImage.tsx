"use client";

import { useEffect, useState } from "react";

type Props = {
  src?: string | null;
  name?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  category?: string | null;
  alt?: string;
  className?: string;
  emptyClassName?: string;
};

export default function ResilientCardImage({
  src,
  name,
  setName,
  cardNumber,
  category,
  alt,
  className = "w-full h-full object-contain",
  emptyClassName = "w-full h-full flex items-center justify-center text-zinc-700",
}: Props) {
  const [resolvedSrc, setResolvedSrc] =
    useState<string | null>(src || null);

  const [failedSrc, setFailedSrc] =
    useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setResolvedSrc(src || null);
    setFailedSrc(null);

    async function resolveFallback() {
      const normalizedCategory =
        (category || "").trim().toLowerCase();

      if (
        normalizedCategory !== "pokemon" ||
        !name
      ) {
        return;
      }

      try {
        const params = new URLSearchParams({
          name,
        });

        if (setName) {
          params.set("setName", setName);
        }

        if (cardNumber) {
          params.set("cardNumber", cardNumber);
        }

        const response = await fetch(
          `/api/catalog/pokemon-image-fallback?${params.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          return;
        }

        const payload = await response.json();

        if (
          !cancelled &&
          payload?.ok &&
          payload?.imageUrl
        ) {
          setResolvedSrc(
            String(payload.imageUrl)
          );
          setFailedSrc(null);
        }
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          console.warn(
            `Card image fallback skipped for ${name}:`,
            error
          );
        }
      }
    }

    if (!src) {
      void resolveFallback();
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    src,
    name,
    setName,
    cardNumber,
    category,
  ]);

  async function handleImageError() {
    if (
      resolvedSrc &&
      resolvedSrc !== failedSrc
    ) {
      setFailedSrc(resolvedSrc);

      const normalizedCategory =
        (category || "").trim().toLowerCase();

      if (
        normalizedCategory === "pokemon" &&
        name
      ) {
        try {
          const params = new URLSearchParams({
            name,
          });

          if (setName) {
            params.set("setName", setName);
          }

          if (cardNumber) {
            params.set("cardNumber", cardNumber);
          }

          const response = await fetch(
            `/api/catalog/pokemon-image-fallback?${params.toString()}`,
            { cache: "no-store" }
          );

          const payload =
            await response.json();

          if (
            response.ok &&
            payload?.ok &&
            payload?.imageUrl &&
            payload.imageUrl !== resolvedSrc
          ) {
            setResolvedSrc(
              String(payload.imageUrl)
            );
            return;
          }
        } catch {
          // Fall through to empty state.
        }
      }

      setResolvedSrc(null);
    }
  }

  if (!resolvedSrc) {
    return (
      <div className={emptyClassName}>
        No Image
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt || name || "Card"}
      className={className}
      onError={handleImageError}
    />
  );
}
