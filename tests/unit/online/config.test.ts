import { describe, expect, it } from "vitest";

import {
  parseStunUrls,
  resolveOnlineRuntimeConfig,
} from "../../../components/xiangqi/online/config";

describe("online runtime config", () => {
  it("is disabled by default and permits an empty ICE server list", () => {
    expect(resolveOnlineRuntimeConfig(undefined, undefined)).toEqual({
      enabled: false,
      rtcConfiguration: { iceServers: [] },
    });
  });

  it("accepts only bounded, unique stun URLs", () => {
    expect(parseStunUrls([
      "stun:stun.example.test:3478",
      " turn:turn.example.test ",
      "stuns:secure.example.test",
      "stun:stun.example.test:3478",
      "stun:second.example.test",
      "stun:contains whitespace",
    ].join(","))).toEqual([
      "stun:stun.example.test:3478",
      "stun:second.example.test",
    ]);
  });

  it("enables only explicit public flag values", () => {
    expect(resolveOnlineRuntimeConfig("1", "stun:one.example,turn:two.example"))
      .toMatchObject({ enabled: true });
    expect(resolveOnlineRuntimeConfig("yes", "").enabled).toBe(false);
  });
});
