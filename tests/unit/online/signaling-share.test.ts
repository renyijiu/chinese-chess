import { describe, expect, it, vi } from "vitest";

import {
  MAX_SIGNALING_QR_BYTES,
  createSignalingQrDataUrl,
  isShareCancellation,
  signalingTextFitsQr,
} from "../../../components/xiangqi/online/signaling-share";

describe("manual signaling sharing", () => {
  it("uses a conservative UTF-8 QR limit", () => {
    expect(signalingTextFitsQr("a".repeat(MAX_SIGNALING_QR_BYTES))).toBe(true);
    expect(signalingTextFitsQr("a".repeat(MAX_SIGNALING_QR_BYTES + 1))).toBe(false);
    expect(signalingTextFitsQr("棋".repeat(682))).toBe(true);
    expect(signalingTextFitsQr("棋".repeat(683))).toBe(false);
    expect(signalingTextFitsQr("")).toBe(false);
  });

  it("loads QR rendering only after a valid explicit request", async () => {
    const toDataURL = vi.fn(async () => "data:image/png;base64,qr");
    const loader = vi.fn(async () => ({ toDataURL }));

    await expect(createSignalingQrDataUrl("invite", loader)).resolves.toBe(
      "data:image/png;base64,qr",
    );
    expect(loader).toHaveBeenCalledOnce();
    expect(toDataURL).toHaveBeenCalledWith(
      "invite",
      expect.objectContaining({
        errorCorrectionLevel: "L",
        width: 280,
      }),
    );
  });

  it("rejects oversized input before loading the QR library", async () => {
    const loader = vi.fn();
    await expect(
      createSignalingQrDataUrl("a".repeat(MAX_SIGNALING_QR_BYTES + 1), loader),
    ).rejects.toThrow("qr-signal-too-large");
    expect(loader).not.toHaveBeenCalled();
  });

  it("distinguishes share cancellation from a real sharing error", () => {
    expect(isShareCancellation({ name: "AbortError" })).toBe(true);
    expect(isShareCancellation(new Error("denied"))).toBe(false);
    expect(isShareCancellation(null)).toBe(false);
  });
});
