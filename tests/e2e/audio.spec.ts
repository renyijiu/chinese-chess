import { expect, test } from "@playwright/test";

import { openCleanGame } from "./helpers";

declare global {
  interface Window {
    __XIANGQI_AUDIO_PROBE__?: { constructed: number; initialStates: string[]; resumed: number };
  }
}

test("audio context is created and resumed by the start gesture", async ({ page }) => {
  await page.addInitScript(() => {
    const probe = { constructed: 0, initialStates: [] as string[], resumed: 0 };
    Object.defineProperty(window, "__XIANGQI_AUDIO_PROBE__", { value: probe });
    const NativeAudioContext = window.AudioContext;
    const nativeResume = NativeAudioContext.prototype.resume;
    NativeAudioContext.prototype.resume = function resume() {
      probe.resumed += 1;
      return nativeResume.call(this);
    };
    window.AudioContext = new Proxy(NativeAudioContext, {
      construct(target, argumentsList, newTarget) {
        probe.constructed += 1;
        const context = Reflect.construct(target, argumentsList, newTarget) as AudioContext;
        probe.initialStates.push(context.state);
        return context;
      },
    });
  });

  await openCleanGame(page);
  await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_PROBE__)).toEqual({
    constructed: 0,
    initialStates: [],
    resumed: 0,
  });
  await page.getByRole("button", { name: "开始本机双人对局" }).click();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-audio-state", "running");
  await expect.poll(() => page.evaluate(() => window.__XIANGQI_AUDIO_PROBE__?.constructed)).toBe(1);
  const probe = await page.evaluate(() => window.__XIANGQI_AUDIO_PROBE__!);
  expect(
    probe.initialStates[0] === "running" || probe.resumed >= 1,
    "a suspended AudioContext must be resumed within the start gesture",
  ).toBe(true);
});
