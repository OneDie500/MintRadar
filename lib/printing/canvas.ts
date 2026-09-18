export function canvasToBase64Png(
  canvas: HTMLCanvasElement
): string {
  const dataUrl =
    canvas.toDataURL("image/png");

  const commaIndex =
    dataUrl.indexOf(",");

  if (commaIndex === -1) {
    throw new Error(
      "Could not encode label image."
    );
  }

  return dataUrl.slice(
    commaIndex + 1
  );
}