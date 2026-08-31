import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { clickBoardSquare, openCleanGame, waitForEnvironmentSettled } from "./helpers";

async function readSignal(page: Page, label: string) {
  const signal = page.getByLabel(label);
  await expect(signal).not.toHaveValue("");
  return signal.inputValue();
}

async function exchangeOfferAndAnswer(host: Page, guest: Page) {
  const offer = await readSignal(host, "完整 Offer 邀请文本");
  await guest.getByLabel("粘贴好友的Offer 邀请文本").fill(offer);
  await guest.getByRole("button", { name: "生成 Answer" }).click();

  const answer = await readSignal(guest, "完整 Answer 响应文本");
  await host.getByLabel("粘贴好友的Answer 响应文本").fill(answer);
  await host.getByRole("button", { name: "接受 Answer 并连接" }).click();

  await expect(host.getByRole("button", { name: "我已准备" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "我已准备" })).toBeVisible();
}

async function completeManualSignaling(host: Page, guest: Page) {
  await host.getByRole("button", { name: "好友直连" }).click();
  await guest.getByRole("button", { name: "好友直连" }).click();

  await host.getByRole("button", { name: "创建邀请" }).click();
  await guest.getByRole("button", { name: "粘贴邀请加入" }).click();
  await exchangeOfferAndAnswer(host, guest);
}

async function resumeSavedMatch(host: Page, guest: Page) {
  await Promise.all([
    host.reload({ waitUntil: "domcontentloaded" }),
    guest.reload({ waitUntil: "domcontentloaded" }),
  ]);
  await Promise.all([
    waitForEnvironmentSettled(host),
    waitForEnvironmentSettled(guest),
  ]);

  const hostContinue = host.getByRole("button", { name: "重新配对继续在线棋局" });
  const guestContinue = guest.getByRole("button", { name: "重新配对继续在线棋局" });
  await expect(hostContinue).toBeVisible();
  await expect(guestContinue).toBeVisible();
  await Promise.all([hostContinue.click(), guestContinue.click()]);
  await exchangeOfferAndAnswer(host, guest);
}

async function readyBoth(host: Page, guest: Page) {
  await host.getByRole("button", { name: "我已准备" }).click();
  await expect(host.getByText("已准备，正在等待好友…")).toBeVisible();
  await guest.getByRole("button", { name: "我已准备" }).click();

  await expect(host.locator(".xiangqi-game-shell")).toHaveAttribute("data-match-mode", "online");
  await expect(guest.locator(".xiangqi-game-shell")).toHaveAttribute("data-match-mode", "online");
  await expect(host.locator(".game-turn-card strong")).toHaveText("红方");
  await expect(guest.locator(".game-turn-card strong")).toHaveText("红方");
}

async function waitForBothRevisions(host: Page, guest: Page, revision: number) {
  await expect(host.locator(".xiangqi-game-shell")).toHaveAttribute(
    "data-game-revision",
    String(revision),
  );
  await expect(guest.locator(".xiangqi-game-shell")).toHaveAttribute(
    "data-game-revision",
    String(revision),
  );
}

async function showOverheadBoard(page: Page) {
  await page.getByRole("button", { name: "俯视棋盘" }).click();
  await expect(page.getByRole("button", { name: "战场视角" })).toBeVisible();
  // The Three.js camera lerps to its top-down destination over rendered frames.
  await page.waitForTimeout(2_000);
}

test("@online two browsers can pair, play, resign off-turn, and rematch with swapped sides", async ({
  baseURL,
  browser,
}) => {
  test.setTimeout(180_000);
  expect(baseURL, "the Playwright baseURL must be configured").toBeTruthy();
  if (!baseURL) throw new Error("the Playwright baseURL must be configured");

  let hostContext: BrowserContext | undefined;
  let guestContext: BrowserContext | undefined;

  try {
    hostContext = await browser.newContext({
      baseURL,
      colorScheme: "dark",
      viewport: { height: 900, width: 1440 },
    });
    guestContext = await browser.newContext({
      baseURL,
      colorScheme: "dark",
      viewport: { height: 900, width: 1440 },
    });
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    await Promise.all([
      openCleanGame(host, "low", true),
      openCleanGame(guest, "low", true),
    ]);
    await completeManualSignaling(host, guest);
    await readyBoth(host, guest);

    await expect(host.locator(".xiangqi-game-shell")).toHaveAttribute("data-human-side", "red");
    await expect(guest.locator(".xiangqi-game-shell")).toHaveAttribute("data-human-side", "black");
    await Promise.all([showOverheadBoard(host), showOverheadBoard(guest)]);

    const hostCanvas = host.locator("canvas");
    await clickBoardSquare(hostCanvas, 0, 3, "red");
    await clickBoardSquare(hostCanvas, 0, 4, "red");
    await waitForBothRevisions(host, guest, 1);
    await expect(host.locator(".game-history")).toContainText("红·兵 a3 → a4");
    await expect(guest.locator(".game-history")).toContainText("红·兵 a3 → a4");

    const guestCanvas = guest.locator("canvas");
    await clickBoardSquare(guestCanvas, 0, 6, "black");
    await clickBoardSquare(guestCanvas, 0, 5, "black");
    await waitForBothRevisions(host, guest, 2);
    await expect(host.locator(".game-history")).toContainText("黑·卒 a6 → a5");
    await expect(guest.locator(".game-history")).toContainText("黑·卒 a6 → a5");

    // It is red's turn, so black resigns outside its turn.
    await expect(guest.locator(".game-turn-card strong")).toHaveText("红方");
    await guest.getByRole("button", { name: "认输" }).click();
    await guest.getByRole("button", { name: "确认认输" }).click();
    await expect(host.getByRole("heading", { name: "红方胜 · 认输" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "红方胜 · 认输" })).toBeVisible();
    await waitForBothRevisions(host, guest, 3);

    // An ended save still needs fresh signaling and mutual readiness for the
    // resume hash check. Once the coordinator reaches terminal, the UI must
    // reopen the result/rematch shell without unlocking board input.
    await resumeSavedMatch(host, guest);
    await host.getByRole("button", { name: "我已准备" }).click();
    await guest.getByRole("button", { name: "我已准备" }).click();
    await expect(host.getByRole("heading", { name: "红方胜 · 认输" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "红方胜 · 认输" })).toBeVisible();
    await waitForBothRevisions(host, guest, 3);

    await host.getByRole("button", { name: "邀请再来一局" }).click();
    await expect(guest.getByRole("button", { name: "接受再来一局" })).toBeVisible();
    await guest.getByRole("button", { name: "接受再来一局" }).click();

    await expect(host.getByRole("button", { name: "我已准备" })).toBeVisible();
    await expect(guest.getByRole("button", { name: "我已准备" })).toBeVisible();
    await readyBoth(host, guest);

    await expect(host.locator(".xiangqi-game-shell")).toHaveAttribute("data-human-side", "black");
    await expect(guest.locator(".xiangqi-game-shell")).toHaveAttribute("data-human-side", "red");
    await waitForBothRevisions(host, guest, 0);

    // Refresh destroys SDP/ICE state. Both browsers resume their local saves
    // only after completing a fresh manual signaling exchange and hash check.
    await resumeSavedMatch(host, guest);
    await readyBoth(host, guest);
    await expect(host.locator(".xiangqi-game-shell")).toHaveAttribute("data-human-side", "black");
    await expect(guest.locator(".xiangqi-game-shell")).toHaveAttribute("data-human-side", "red");
    await waitForBothRevisions(host, guest, 0);
  } finally {
    await Promise.allSettled([
      hostContext?.close(),
      guestContext?.close(),
    ]);
  }
});
