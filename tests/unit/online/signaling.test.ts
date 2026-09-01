import { describe, expect, it } from "vitest";

import {
  MAX_SIGNALING_FRAME_BYTES,
  SIGNALING_VERSION,
  decodeSignalingMessageV1,
  encodeSignalingMessageV1,
  isSignalingMessageExpired,
  type SignalingMessageV1,
} from "../../../lib/xiangqi/online/index";

const APPLICATION_SDP = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=sctp-port:5000",
  "",
].join("\r\n");

const offer = {
  signalVersion: SIGNALING_VERSION,
  kind: "offer",
  sessionId: "session-1",
  pairingId: "pairing-1",
  matchId: "match-1",
  hostPeerId: "peer-host",
  intent: "new",
  createdAt: 1_000,
  expiresAt: 2_000,
  description: { type: "offer", sdp: APPLICATION_SDP },
} as const satisfies SignalingMessageV1;

const answer = {
  signalVersion: SIGNALING_VERSION,
  kind: "answer",
  sessionId: "session-1",
  pairingId: "pairing-1",
  matchId: "match-1",
  hostPeerId: "peer-host",
  guestPeerId: "peer-guest",
  intent: "resume",
  createdAt: 1_100,
  expiresAt: 2_100,
  description: { type: "answer", sdp: APPLICATION_SDP },
} as const satisfies SignalingMessageV1;

describe("manual signaling protocol v1", () => {
  it("round-trips exact offer and answer unions and validates an expected kind", () => {
    for (const message of [offer, answer]) {
      const encoded = encodeSignalingMessageV1(message);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) throw new Error(encoded.error.code);
      expect(decodeSignalingMessageV1(encoded.value, message.kind)).toEqual({
        ok: true,
        value: message,
      });
    }

    expect(decodeSignalingMessageV1(JSON.stringify(answer), "offer")).toEqual({
      ok: false,
      error: { code: "kind" },
    });
  });

  it("rejects extra fields, invalid identities, timestamps, and description-kind mismatches", () => {
    const invalid = [
      { ...offer, surprise: true },
      { ...offer, hostPeerId: " " },
      { ...offer, sessionId: "x".repeat(129) },
      { ...offer, createdAt: -1 },
      { ...offer, expiresAt: offer.createdAt },
      { ...offer, description: { type: "answer", sdp: APPLICATION_SDP } },
      { ...offer, description: { type: "offer", sdp: APPLICATION_SDP, extra: true } },
    ];
    for (const value of invalid) {
      expect(decodeSignalingMessageV1(JSON.stringify(value))).toEqual({
        ok: false,
        error: { code: "schema" },
      });
      expect(encodeSignalingMessageV1(value)).toEqual({
        ok: false,
        error: { code: "schema" },
      });
    }
  });

  it("accepts exactly one application media section and rejects audio, video, or extra media", () => {
    const invalidSdps = [
      APPLICATION_SDP.replace("m=application", "m=audio"),
      `${APPLICATION_SDP}m=video 9 UDP/TLS/RTP/SAVPF 96\r\n`,
      `${APPLICATION_SDP}m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n`,
      "v=0\r\ns=-\r\nt=0 0\r\n",
    ];
    for (const sdp of invalidSdps) {
      expect(
        decodeSignalingMessageV1(
          JSON.stringify({
            ...offer,
            description: { type: "offer", sdp },
          }),
        ),
      ).toEqual({ ok: false, error: { code: "schema" } });
    }
  });

  it("treats TTL as a UX check without changing schema acceptance", () => {
    expect(isSignalingMessageExpired(offer, 1_999)).toBe(false);
    expect(isSignalingMessageExpired(offer, 2_000)).toBe(true);
    expect(decodeSignalingMessageV1(JSON.stringify(offer))).toEqual({ ok: true, value: offer });
  });

  it("distinguishes frame size, JSON, version, and expected-kind failures", () => {
    expect(decodeSignalingMessageV1("[".repeat(MAX_SIGNALING_FRAME_BYTES + 1))).toEqual({
      ok: false,
      error: { code: "size" },
    });
    expect(decodeSignalingMessageV1("{")).toEqual({ ok: false, error: { code: "json" } });
    expect(decodeSignalingMessageV1(JSON.stringify({ signalVersion: 2 }))).toEqual({
      ok: false,
      error: { code: "version" },
    });

    expect(
      encodeSignalingMessageV1({
        ...offer,
        description: {
          type: "offer",
          sdp: `${APPLICATION_SDP}a=x:${"棋".repeat(MAX_SIGNALING_FRAME_BYTES)}\r\n`,
        },
      }),
    ).toEqual({ ok: false, error: { code: "size" } });
  });
});
