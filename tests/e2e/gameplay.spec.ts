import { expect, test } from "@playwright/test";

import {
  openCleanGame,
  pressSequence,
  setReducedMotion,
  startGame,
  waitForRevision,
} from "./helpers";

test("keyboard can select, cancel, move, capture, restore, undo, and resign", async ({ page }) => {
  test.setTimeout(120_000);
  let updateDepthError: string | undefined;
  page.on("console", (message) => {
    if (
      !updateDepthError &&
      message.type() === "error" &&
      message.text().includes("Maximum update depth exceeded")
    ) {
      updateDepthError = message.text();
    }
  });
  await openCleanGame(page);
  const keyboard = await startGame(page);
  const historyPanel = page.locator(".game-history");
  await expect(historyPanel).toHaveAttribute("data-expanded", "false");
  await expect(page.getByRole("button", { name: "展开完整着法历史" })).toBeVisible();
  await setReducedMotion(page);
  await keyboard.focus();
  const turnDetail = page.locator(".game-turn-card small");

  await pressSequence(keyboard, [
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowUp",
    "ArrowUp",
    "ArrowUp",
    "Enter",
  ]);
  await expect(turnDetail).toHaveText("1 个合法落点");
  await keyboard.press("Escape");
  await expect(turnDetail).toHaveText("第 1 手");

  await keyboard.press("Enter");
  await pressSequence(keyboard, ["ArrowUp", "Enter"]);
  await waitForRevision(page, 1);

  await pressSequence(keyboard, ["ArrowUp", "ArrowUp", "Enter", "ArrowDown", "Enter"]);
  await waitForRevision(page, 2);

  await pressSequence(keyboard, ["ArrowDown", "Enter", "ArrowUp", "Enter"]);
  await waitForRevision(page, 3);
  await expect(page.locator('.game-history li[data-last-move="true"]')).toContainText("吃黑卒");
  await expect(page.locator('.game-history li[data-capture="true"]')).toHaveCount(1);
  await expect(page.locator(".game-capture-ledger .black")).toContainText("卒");
  await expect(page.locator(".game-history li:visible")).toHaveCount(1);
  await page.getByRole("button", { name: "展开完整着法历史" }).click();
  await expect(historyPanel).toHaveAttribute("data-expanded", "true");
  await expect(page.locator(".game-history li:visible")).toHaveCount(3);
  await page.getByRole("button", { name: "收起着法历史" }).click();
  await expect(historyPanel).toHaveAttribute("data-expanded", "false");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "继续对局" }).click();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "3");
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator(".game-turn-card strong")).toHaveText("黑方");
  const restoredMoves = page.locator(".game-history li");
  await expect(restoredMoves).toHaveCount(3);
  await expect(restoredMoves.nth(0)).toContainText("红·兵 a4 → a5");
  await expect(restoredMoves.nth(0)).toContainText("吃黑卒");
  await expect(restoredMoves.nth(1)).toContainText("黑·卒 a6 → a5");
  await expect(restoredMoves.nth(2)).toContainText("红·兵 a3 → a4");

  await page.getByRole("button", { name: "悔棋" }).click();
  await waitForRevision(page, 4);
  await expect(page.locator(".game-history")).not.toContainText("吃");
  await expect(page.locator(".game-capture-ledger .black strong")).toHaveText("—");

  await page.getByRole("button", { name: "认输" }).click();
  const dialog = page.getByRole("alertdialog", { name: "确认认输？" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
  await expect(page.locator(".xiangqi-game-shell > div[inert]")).toHaveCount(1);
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "认输" }).click();
  await page.getByRole("button", { name: "确认认输" }).click();
  await expect(page.getByRole("heading", { name: /胜 · 认输/ })).toBeVisible();
  expect(updateDepthError, "presentation frames must not recursively update React").toBeUndefined();
});
