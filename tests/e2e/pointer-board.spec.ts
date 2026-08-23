import { expect, test } from "@playwright/test";

import { clickBoardSquare, openCleanGame, startGame } from "./helpers";

test("a real canvas pointer selects and moves a board piece", async ({ page }) => {
  test.setTimeout(90_000);
  await openCleanGame(page);
  await startGame(page);
  await page.getByRole("button", { name: "俯视棋盘" }).click();
  await page.waitForTimeout(2_000);

  const canvas = page.locator("canvas");
  await clickBoardSquare(canvas, 0, 3);
  await expect(page.locator(".game-turn-card small")).toContainText("1 个合法落点");

  await clickBoardSquare(canvas, 0, 4);
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "1");
  await expect(page.locator(".game-history")).toContainText("红·兵 a3 → a4");
});
