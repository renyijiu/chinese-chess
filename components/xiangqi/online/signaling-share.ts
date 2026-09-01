export const MAX_SIGNALING_QR_BYTES = 2_048;

const ENCODER = new TextEncoder();

export function signalingTextFitsQr(signal: string): boolean {
  return signal.length > 0 && ENCODER.encode(signal).byteLength <= MAX_SIGNALING_QR_BYTES;
}

export function isShareCancellation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

export async function createSignalingQrDataUrl(
  signal: string,
  loadQrCode: () => Promise<Pick<typeof import("qrcode"), "toDataURL">> = () => import("qrcode"),
): Promise<string> {
  if (!signalingTextFitsQr(signal)) throw new Error("qr-signal-too-large");
  const qrCode = await loadQrCode();
  return qrCode.toDataURL(signal, {
    errorCorrectionLevel: "L",
    margin: 2,
    type: "image/png",
    width: 280,
  });
}
