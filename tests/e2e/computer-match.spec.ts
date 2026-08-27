import { expect, test, type Page } from "@playwright/test";

import { openCleanGame, waitForRevision } from "./helpers";

async function forceNextDie(page: Page, dieResult: 1 | 2 | 3 | 4 | 5 | 6) {
  await page.addInitScript((value) => {
    let first = true;
    const original = Crypto.prototype.getRandomValues;
    Crypto.prototype.getRandomValues = function getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (first && array instanceof Uint8Array) {
        first = false;
        array.fill(value - 1);
        return array as T;
      }
      return Reflect.apply(original, this, [array]) as T;
    };
  }, dieResult);
}

async function chooseComputerMode(page: Page, difficulty: "简单" | "标准" | "困难" | "大师") {
  await page.getByRole("button", { name: "人机对战" }).click();
  await page.getByRole("radio", { name: difficulty, exact: true }).check();
}

test("rolls and persists an odd die before confirming a red-side computer match", async ({ page }) => {
  await forceNextDie(page, 5);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "简单");

  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await expect(page.getByRole("status", { name: "阵营分配结果" })).toContainText("5");
  await expect(page.getByRole("status", { name: "阵营分配结果" })).toContainText("红方");
  await expect(page.getByRole("button", { name: "以红方开始对局" })).toBeEnabled();

  const persisted = await page.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v2"));
  expect(persisted).toContain('"dieResult":5');
  expect(persisted).toContain('"humanSide":"red"');

  await page.getByRole("button", { name: "以红方开始对局" }).click();
  await expect(page.getByRole("button", { name: "悔棋" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "认输" })).toBeEnabled();
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText("简单");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");
});

test("restores a persisted die confirmation without rerolling", async ({ page }) => {
  await forceNextDie(page, 3);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "标准");
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await expect(page.getByRole("button", { name: "以红方开始对局" })).toBeEnabled();
  const saved = await page.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v2"));

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status", { name: "阵营分配结果" })).toContainText("3");
  await expect(page.getByRole("button", { name: "以红方开始对局" })).toBeEnabled();
  await expect(page.locator(".computer-die")).not.toHaveAttribute("data-rolling", "true");
  expect(await page.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v2"))).toBe(saved);
});

test("orients for human black and lets the computer open while controls stay responsive", async ({ page }) => {
  await forceNextDie(page, 4);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "困难");
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以黑方开始对局" }).click();

  await expect(page.getByRole("button", { name: "切换到红方视角" })).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("region", { name: "对局设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新开局" })).toBeEnabled();
  await page.getByRole("button", { name: "重新开局" }).click();
  await expect(page.getByRole("alertdialog", { name: "确认重新开局？" })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText(/思考|落子|结算|轮到你/);
  await waitForRevision(page, 1);
  await expect(page.getByRole("button", { name: "认输" })).toBeEnabled();
});

test("discloses Master fallback, hides computer undo, and preserves local undo", async ({ page }) => {
  await forceNextDie(page, 5);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "大师");
  await expect(page.getByRole("note")).toContainText(/首次使用.*下载/);
  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以红方开始对局" }).click();
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText("大师");
  await expect(page.getByRole("status", { name: "对手状态" })).toContainText("困难");
  await expect(page.getByRole("button", { name: "悔棋" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const raw = window.localStorage.getItem("xiangqi3d:game:v2");
    return raw ? JSON.parse(raw).match.effectiveTier : null;
  })).toBe("lightweight-hard");

  await page.evaluate(() => {
    window.localStorage.removeItem("xiangqi3d:game:v2");
    window.localStorage.removeItem("xiangqi3d:game:v2:backup");
    window.localStorage.removeItem("xiangqi3d:game:v1");
    window.localStorage.removeItem("xiangqi3d:game:v1:backup");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "开始本机双人对局" }).click();
  await expect(page.getByRole("button", { name: "悔棋" })).toBeVisible();
});

test("keeps setup and presentation controls usable at 390 by 844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await forceNextDie(page, 5);
  await openCleanGame(page, "low", true);
  await chooseComputerMode(page, "标准");

  const menu = page.getByRole("dialog", { name: "兵临九宫" });
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(844);
  const rollBox = await page.getByRole("button", { name: "掷骰决定阵营" }).boundingBox();
  expect(rollBox?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "掷骰决定阵营" }).click();
  await page.getByRole("button", { name: "以红方开始对局" }).click();
  await page.getByRole("button", { name: "设置" }).click();
  const settingsBox = await page.getByRole("region", { name: "对局设置" }).boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(settingsBox!.x).toBeGreaterThanOrEqual(0);
  expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(390);
  expect(settingsBox!.y + settingsBox!.height).toBeLessThanOrEqual(844);
});
