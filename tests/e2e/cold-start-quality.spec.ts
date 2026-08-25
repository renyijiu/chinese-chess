import { expect, test } from "@playwright/test";

import { getPanoramaUrl } from "../../components/xiangqi/scene/diorama-environment";
import type { QualityTier } from "../../components/xiangqi/runtime/quality";
import { waitForEnvironmentSettled } from "./helpers";

const SAVED_QUALITIES = ["low", "medium"] as const satisfies readonly QualityTier[];

for (const quality of SAVED_QUALITIES) {
  test(`restores saved ${quality} quality before mounting the 3D scene`, async ({ page }) => {
    const panoramaRequests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/background/qin-diorama-panorama-v1-")) panoramaRequests.push(path);
    });
    await page.addInitScript((savedQuality) => {
      window.localStorage.setItem("xiangqi3d:settings:v1", JSON.stringify({
        ambientVolume: 0.55,
        masterVolume: 0.8,
        musicVolume: 0.42,
        muted: false,
        quality: savedQuality,
        reducedMotion: false,
        sfxVolume: 0.8,
        uiVolume: 0.72,
        version: 1,
        voiceVolume: 0.75,
      }));
    }, quality);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "开始本机双人对局" })).toBeVisible();
    await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-quality", quality);
    await waitForEnvironmentSettled(page);

    expect(panoramaRequests).toContain(getPanoramaUrl(quality));
    expect(panoramaRequests).not.toContain(getPanoramaUrl("high"));
    expect(new Set(panoramaRequests)).toEqual(new Set([getPanoramaUrl(quality)]));
  });
}
