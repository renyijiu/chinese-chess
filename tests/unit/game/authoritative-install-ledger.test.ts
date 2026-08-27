import { describe, expect, it, vi } from "vitest";

import { AuthoritativeInstallLedger } from "../../../components/xiangqi/game/authoritative-install-ledger";

describe("AuthoritativeInstallLedger", () => {
  it("releases a network receipt at authoritative install time", async () => {
    const ledger = new AuthoritativeInstallLedger();
    const installed = vi.fn();
    const wait = ledger.waitFor("0:1").then(installed);

    await Promise.resolve();
    expect(installed).not.toHaveBeenCalled();
    ledger.markInstalled("0:1");
    await wait;
    expect(installed).toHaveBeenCalledOnce();
  });

  it("does not release invalidated or cancelled waiters", async () => {
    const ledger = new AuthoritativeInstallLedger();
    const invalidated = vi.fn();
    const cancelled = vi.fn();
    void ledger.waitFor("old").then(invalidated);
    void ledger.waitFor("cancelled").then(cancelled);

    ledger.cancel("cancelled");
    ledger.invalidate();
    ledger.markInstalled("old");
    ledger.markInstalled("cancelled");
    await Promise.resolve();
    expect(invalidated).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
  });
});
