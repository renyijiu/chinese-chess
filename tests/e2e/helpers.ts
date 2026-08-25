import { expect, type Locator, type Page } from "@playwright/test";

import { squareToWorld } from "../../components/xiangqi/runtime/board-coordinates";

const CAMERA_FOV_DEGREES = 37;

async function boardScreenPoint(
  canvas: Locator,
  file: number,
  rank: number,
  side: "red" | "black" = "red",
) {
  const box = await canvas.boundingBox();
  expect(box, "the WebGL canvas must have a visible bounding box").not.toBeNull();

  const [worldX, worldY, worldZ] = squareToWorld({ file, rank });
  const cameraHeight = box!.width < 720 ? 31.5 : 23.5;
  const verticalWorldSpan = 2 * Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360)
    * (cameraHeight - worldY);
  const pixelsPerWorldUnit = box!.height / verticalWorldSpan;
  const orientation = side === "red" ? 1 : -1;
  return {
    x: box!.x + box!.width / 2 + worldX * pixelsPerWorldUnit * orientation,
    y: box!.y + box!.height / 2 + worldZ * pixelsPerWorldUnit * orientation,
  };
}

export async function clickBoardSquare(
  canvas: Locator,
  file: number,
  rank: number,
  side: "red" | "black" = "red",
) {
  const point = await boardScreenPoint(canvas, file, rank, side);
  await canvas.page().mouse.click(point.x, point.y);
}

export async function tapBoardSquare(
  canvas: Locator,
  file: number,
  rank: number,
  side: "red" | "black" = "red",
) {
  const point = await boardScreenPoint(canvas, file, rank, side);
  await canvas.page().touchscreen.tap(point.x, point.y);
}

export async function waitForEnvironmentSettled(
  page: Page,
  expected?: "ready" | "degraded",
) {
  const viewer = page.locator(".board-viewer");
  await expect(viewer).toHaveAttribute(
    "data-environment-status",
    expected ?? /^(ready|degraded)$/,
  );
}

export async function settleVisualScene(page: Page) {
  await waitForEnvironmentSettled(page);
  await expect.poll(
    () => page.evaluate(() => window.__XIANGQI_PERFORMANCE__?.sampleCount ?? 0),
  ).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  }));
}

export async function openCleanGame(
  page: Page,
  quality: "high" | "medium" | "low" = "low",
  reducedMotion = false,
) {
  await page.addInitScript(({ initialQuality, initialReducedMotion }) => {
    if (window.sessionStorage.getItem("xiangqi3d:e2e-initialized")) return;
    window.localStorage.clear();
    window.localStorage.setItem("xiangqi3d:settings:v1", JSON.stringify({
      ambientVolume: 0.55,
      masterVolume: 0.8,
      musicVolume: 0.42,
      muted: false,
      quality: initialQuality,
      reducedMotion: initialReducedMotion,
      sfxVolume: 0.8,
      uiVolume: 0.72,
      version: 1,
      voiceVolume: 0.75,
    }));
    window.sessionStorage.setItem("xiangqi3d:e2e-initialized", "true");
  }, { initialQuality: quality, initialReducedMotion: reducedMotion });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "开始本机双人对局" })).toBeVisible();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-quality", quality);
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-reduced-motion", String(reducedMotion));
  await waitForEnvironmentSettled(page);
}

export async function startGame(page: Page) {
  await page.getByRole("button", { name: "开始本机双人对局" }).click();
  const keyboard = page.locator(".game-keyboard-control button");
  await expect(keyboard).toBeFocused();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-audio-state", "running");
  return keyboard;
}

export async function setReducedMotion(page: Page, enabled = true) {
  await page.getByRole("button", { name: "设置" }).click();
  const toggle = page.getByRole("checkbox", { name: "减少动态效果" });
  if ((await toggle.isChecked()) !== enabled) await toggle.setChecked(enabled);
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-reduced-motion", String(enabled));
  await page.getByRole("button", { name: "设置" }).click();
}

export async function waitForRevision(page: Page, revision: number) {
  const shell = page.locator(".xiangqi-game-shell");
  await expect(shell).toHaveAttribute("data-game-revision", String(revision));
  await expect(page.locator(".game-keyboard-control button")).toHaveAttribute("aria-disabled", "false");
}

export async function pressSequence(control: Locator, keys: readonly string[]) {
  for (const key of keys) await control.press(key);
}
