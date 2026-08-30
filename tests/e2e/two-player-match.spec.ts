import { expect, test } from "@playwright/test";

import {
  clickBoardSquare,
  openCleanGame,
  pressSequence,
  setReducedMotion,
  startGame,
  waitForEnvironmentSettled,
  waitForRevision,
} from "./helpers";

test("red and black can alternate legal moves across four complete turns", async ({ page }) => {
  test.setTimeout(120_000);
  await openCleanGame(page);
  await startGame(page);
  await setReducedMotion(page);
  await page.getByRole("button", { name: "俯视棋盘" }).click();
  await page.waitForTimeout(1_200);

  const canvas = page.locator("canvas");
  const turn = page.locator(".game-turn-card strong");
  const moves = [
    { from: [0, 3], history: "红·兵 a3 → a4", sideAfter: "黑方", to: [0, 4] },
    { from: [0, 6], history: "黑·卒 a6 → a5", sideAfter: "红方", to: [0, 5] },
    { from: [1, 0], history: "红·马 b0 → c2", sideAfter: "黑方", to: [2, 2] },
    { from: [1, 9], history: "黑·马 b9 → c7", sideAfter: "红方", to: [2, 7] },
    { from: [0, 0], history: "红·车 a0 → a1", sideAfter: "黑方", to: [0, 1] },
    { from: [0, 9], history: "黑·车 a9 → a8", sideAfter: "红方", to: [0, 8] },
    { from: [1, 2], history: "红·炮 b2 → b3", sideAfter: "黑方", to: [1, 3] },
    { from: [1, 7], history: "黑·炮 b7 → b6", sideAfter: "红方", to: [1, 6] },
  ] as const;

  for (const [index, move] of moves.entries()) {
    await clickBoardSquare(canvas, move.from[0], move.from[1]);
    await expect(page.locator(".game-turn-card small")).toContainText("合法落点");
    await clickBoardSquare(canvas, move.to[0], move.to[1]);
    await waitForRevision(page, index + 1);
    await expect(turn).toHaveText(move.sideAfter);
    await expect(page.locator(".game-history")).toContainText(move.history);
  }

  await expect(page.locator(".game-history li")).toHaveCount(8);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "继续对局" }).click();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "8");
  await expect(page.locator(".game-history li")).toHaveCount(8);
  await expect(turn).toHaveText("红方");
});

test("warns a stale tab, preserves the newer save, and allows an explicit new game", async ({ context, page }) => {
  test.setTimeout(120_000);
  await openCleanGame(page);
  await startGame(page);
  await setReducedMotion(page);

  const staleTab = await context.newPage();
  await staleTab.goto("/", { waitUntil: "domcontentloaded" });
  await waitForEnvironmentSettled(staleTab);
  await staleTab.getByRole("button", { name: "继续对局" }).click();
  await expect(staleTab.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");

  const activeKeyboard = page.locator(".game-keyboard-control button");
  await activeKeyboard.focus();
  await pressSequence(activeKeyboard, [
    "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft",
    "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp", "Enter",
  ]);
  await waitForRevision(page, 1);
  const advancedSave = await page.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v2"));
  expect(advancedSave).not.toBeNull();

  await expect(staleTab.locator(".game-persistence-warning")).toContainText("其他标签页已更新本地存档");
  const staleKeyboard = staleTab.locator(".game-keyboard-control button");
  await staleKeyboard.focus();
  await pressSequence(staleKeyboard, [
    "ArrowLeft", "ArrowLeft",
    "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp", "Enter",
  ]);
  await waitForRevision(staleTab, 1);

  expect(await staleTab.evaluate(() => window.localStorage.getItem("xiangqi3d:game:v2"))).toBe(advancedSave);
  await expect(staleTab.locator(".game-persistence-warning")).toContainText("不会覆盖对方进度");

  await staleTab.getByRole("button", { name: "重新开局" }).click();
  const confirmation = staleTab.getByRole("alertdialog", { name: "确认重新开局？" });
  await confirmation.getByRole("button", { name: "重新开局" }).click();
  await expect(staleTab.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");
  const replacement = await staleTab.evaluate(() => {
    const raw = window.localStorage.getItem("xiangqi3d:game:v2");
    return raw ? JSON.parse(raw) as { revision?: number; serialized?: string } : null;
  });
  expect(replacement?.revision).toBe(0);
  expect(replacement?.serialized).not.toBe(JSON.parse(advancedSave ?? "{}").serialized);
});
