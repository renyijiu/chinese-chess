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

const GAME_SAVE_KEY = "xiangqi3d:game:v2";
const GAME_SAVE_LOCK_NAME = "xiangqi3d:game-save:v2";

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

test("serializes synchronized new-game writers and keeps the loser in memory-only mode", async ({ context, page }) => {
  test.setTimeout(120_000);
  await openCleanGame(page);
  const contender = await context.newPage();
  await contender.goto("/", { waitUntil: "domcontentloaded" });
  await waitForEnvironmentSettled(contender);
  await expect(contender.getByRole("button", { name: "开始本机双人对局" })).toBeVisible();

  await page.evaluate((lockName) => {
    const state = window as typeof window & {
      __releaseGameSaveLock?: () => void;
      __gameSaveLockHeld?: boolean;
    };
    void navigator.locks.request(lockName, () => new Promise<void>((resolve) => {
      state.__releaseGameSaveLock = resolve;
      state.__gameSaveLockHeld = true;
    }));
  }, GAME_SAVE_LOCK_NAME);
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as typeof window & { __gameSaveLockHeld?: boolean }).__gameSaveLockHeld,
  ))).toBe(true);

  await Promise.all([
    page.getByRole("button", { name: "开始本机双人对局" }).click(),
    contender.getByRole("button", { name: "开始本机双人对局" }).click(),
  ]);
  await expect.poll(() => page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query();
    return snapshot.pending?.filter((lock) => lock.name === lockName).length ?? 0;
  }, GAME_SAVE_LOCK_NAME)).toBe(2);
  await page.evaluate(() => {
    (window as typeof window & { __releaseGameSaveLock?: () => void }).__releaseGameSaveLock?.();
  });

  await Promise.all([
    expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0"),
    expect(contender.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0"),
    expect(page.locator(".game-keyboard-control button")).toBeFocused(),
    expect(contender.locator(".game-keyboard-control button")).toBeFocused(),
  ]);
  const warnings = await Promise.all([
    page.locator(".game-persistence-warning").allTextContents().then((values) => values.join(" ")),
    contender.locator(".game-persistence-warning").allTextContents().then((values) => values.join(" ")),
  ]);
  expect(warnings.filter((warning) => warning.includes("其他标签页已更新本地存档"))).toHaveLength(1);

  const winnerSave = await page.evaluate((key) => window.localStorage.getItem(key), GAME_SAVE_KEY);
  expect(winnerSave).not.toBeNull();
  await page.waitForTimeout(100);
  expect(await contender.evaluate((key) => window.localStorage.getItem(key), GAME_SAVE_KEY)).toBe(winnerSave);
});

test("single-flights repeated menu starts while persistence waits for the save lock", async ({ page }) => {
  test.setTimeout(120_000);
  await openCleanGame(page);
  await page.evaluate((lockName) => {
    const state = window as typeof window & {
      __releaseGameSaveLock?: () => void;
      __gameSaveLockHeld?: boolean;
    };
    void navigator.locks.request(lockName, () => new Promise<void>((resolve) => {
      state.__releaseGameSaveLock = resolve;
      state.__gameSaveLockHeld = true;
    }));
  }, GAME_SAVE_LOCK_NAME);
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as typeof window & { __gameSaveLockHeld?: boolean }).__gameSaveLockHeld,
  ))).toBe(true);

  const start = page.getByRole("button", { name: "开始本机双人对局" });
  await start.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(start).toBeDisabled();
  await expect.poll(() => page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query();
    return snapshot.pending?.filter((lock) => lock.name === lockName).length ?? 0;
  }, GAME_SAVE_LOCK_NAME)).toBe(1);

  await page.evaluate(() => {
    (window as typeof window & { __releaseGameSaveLock?: () => void }).__releaseGameSaveLock?.();
  });
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");
  await expect(page.locator(".game-keyboard-control button")).toBeFocused();
  await expect(page.locator(".game-persistence-warning")).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { revision?: number }).revision : null;
  }, GAME_SAVE_KEY)).toBe(0);
});

test("invalidates a locked stale move and makes restart confirmation single-submit", async ({ page }) => {
  test.setTimeout(120_000);
  await openCleanGame(page);
  const keyboard = await startGame(page);
  await setReducedMotion(page);

  await page.evaluate((lockName) => {
    const state = window as typeof window & {
      __releaseGameSaveLock?: () => void;
      __gameSaveLockHeld?: boolean;
      __revisionTrace?: string[];
    };
    state.__revisionTrace = [];
    const shell = document.querySelector(".xiangqi-game-shell");
    if (shell) {
      new MutationObserver(() => {
        state.__revisionTrace?.push(shell.getAttribute("data-game-revision") ?? "missing");
      }).observe(shell, { attributeFilter: ["data-game-revision"] });
    }
    void navigator.locks.request(lockName, () => new Promise<void>((resolve) => {
      state.__releaseGameSaveLock = resolve;
      state.__gameSaveLockHeld = true;
    }));
  }, GAME_SAVE_LOCK_NAME);
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as typeof window & { __gameSaveLockHeld?: boolean }).__gameSaveLockHeld,
  ))).toBe(true);

  await keyboard.focus();
  await pressSequence(keyboard, [
    "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft",
    "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp", "Enter",
  ]);
  await expect.poll(() => page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query();
    return snapshot.pending?.filter((lock) => lock.name === lockName).length ?? 0;
  }, GAME_SAVE_LOCK_NAME)).toBe(1);

  await page.getByRole("button", { name: "重新开局" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "确认重新开局？" });
  await confirmation.getByRole("button", { name: "重新开局" }).click();
  await expect(confirmation).toHaveAttribute("aria-busy", "true");
  await expect(confirmation.getByRole("button", { name: "取消" })).toBeDisabled();
  await expect(confirmation.getByRole("button", { name: "重新开局" })).toBeDisabled();
  // The restart is single-filed behind the active command mutation, so only
  // that command has reached the browser Web Lock queue at this point.
  await expect.poll(() => page.evaluate(async (lockName) => {
    const snapshot = await navigator.locks.query();
    return snapshot.pending?.filter((lock) => lock.name === lockName).length ?? 0;
  }, GAME_SAVE_LOCK_NAME)).toBe(1);

  await page.evaluate(() => {
    (window as typeof window & { __releaseGameSaveLock?: () => void }).__releaseGameSaveLock?.();
  });
  await expect(confirmation).toBeHidden();
  await expect(page.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");
  await expect(page.locator(".game-history li")).toHaveCount(0);
  expect(await page.evaluate(() => (
    (window as typeof window & { __revisionTrace?: string[] }).__revisionTrace ?? []
  ))).not.toContain("1");
  await expect.poll(() => page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { revision?: number }).revision : null;
  }, GAME_SAVE_KEY)).toBe(0);
});

test("labels a valid external menu update separately and overwrites it only after confirmation", async ({ context, page }) => {
  test.setTimeout(120_000);
  await openCleanGame(page);
  await startGame(page);
  await setReducedMotion(page);

  const staleMenu = await context.newPage();
  await staleMenu.goto("/", { waitUntil: "domcontentloaded" });
  await waitForEnvironmentSettled(staleMenu);
  await expect(staleMenu.getByRole("button", { name: "继续对局" })).toBeVisible();

  const activeKeyboard = page.locator(".game-keyboard-control button");
  await activeKeyboard.focus();
  await pressSequence(activeKeyboard, [
    "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft",
    "ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowUp", "Enter",
  ]);
  await waitForRevision(page, 1);
  const advancedSave = await page.evaluate((key) => window.localStorage.getItem(key), GAME_SAVE_KEY);
  expect(advancedSave).not.toBeNull();

  await expect(staleMenu.locator(".game-warning")).toContainText("其他标签页已更新本地存档");
  await staleMenu.getByRole("button", { name: "开始本机双人对局" }).click();
  const confirmation = staleMenu.getByRole("alertdialog", { name: "覆盖当前棋局？" });
  await expect(confirmation).toContainText("其他标签页已有有效的新进度");
  await expect(confirmation).not.toContainText("损坏");
  expect(await staleMenu.evaluate((key) => window.localStorage.getItem(key), GAME_SAVE_KEY)).toBe(advancedSave);

  await confirmation.getByRole("button", { name: "开始新局" }).click();
  await expect(confirmation).toBeHidden();
  await expect(staleMenu.locator(".xiangqi-game-shell")).toHaveAttribute("data-game-revision", "0");
  await expect(staleMenu.locator(".game-keyboard-control button")).toBeFocused();
  await expect.poll(
    () => staleMenu.evaluate((key) => window.localStorage.getItem(key), GAME_SAVE_KEY),
  ).not.toBe(advancedSave);
  await staleMenu.evaluate(({ key, staleValue }) => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: staleValue }));
  }, { key: GAME_SAVE_KEY, staleValue: advancedSave });
  await expect.poll(() => staleMenu.evaluate(() => (
    ![...document.querySelectorAll(".game-persistence-warning")]
      .some((element) => element.textContent?.includes("其他标签页已更新本地存档"))
  ))).toBe(true);
});
