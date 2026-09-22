import { expect, test } from "@playwright/test";

import {
  openCleanGame,
  pressSequence,
  setReducedMotion,
  startGame,
  waitForRevision,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Fiber = {
      child: Fiber | null;
      sibling: Fiber | null;
      flags: number;
      type?: { name?: string };
      memoizedProps?: {
        actorId?: string;
        object?: { selection?: { set: (objects: unknown[]) => unknown } };
      };
    };
    const target = window as typeof window & {
      __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
      __ACTOR_RENDERS__?: Record<string, number>;
      __BLOOM_MAX_SELECTION__?: number;
    };
    let rendererId = 0;
    const renderers = new Map<number, unknown>();
    const observedSelections = new WeakSet<object>();
    target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers,
      inject: (renderer: unknown) => {
        renderers.set(++rendererId, renderer);
        return rendererId;
      },
      onCommitFiberUnmount: () => undefined,
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        const visit = (fiber: Fiber | null) => {
          if (!fiber) return;
          const counts = target.__ACTOR_RENDERS__;
          const actor = fiber.memoizedProps?.actorId;
          if (counts && actor && fiber.type?.name === "PieceActor" && (fiber.flags & 1) !== 0) {
            counts[actor] = (counts[actor] ?? 0) + 1;
          }
          const effect = fiber.memoizedProps?.object;
          if (effect?.selection && !observedSelections.has(effect.selection)) {
            const selection = effect.selection;
            observedSelections.add(selection);
            const set = selection.set;
            selection.set = function (objects) {
              target.__BLOOM_MAX_SELECTION__ = Math.max(
                target.__BLOOM_MAX_SELECTION__ ?? 0,
                objects.length,
              );
              return set.call(this, objects);
            };
          }
          visit(fiber.child);
          visit(fiber.sibling);
        };
        visit(root.current);
      },
    };
  });
});

test("keeps stationary actors out of per-frame React updates", async ({ page }, testInfo) => {
  await openCleanGame(page);
  const keyboard = await startGame(page);
  await pressSequence(keyboard, [
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowUp",
    "ArrowUp",
    "ArrowUp",
    "Enter",
    "ArrowUp",
  ]);
  await page.evaluate(() => {
    (window as typeof window & { __ACTOR_RENDERS__?: Record<string, number> }).__ACTOR_RENDERS__ =
      {};
  });
  await keyboard.press("Enter");
  await waitForRevision(page, 1);
  const counts = await page.evaluate(
    () =>
      (window as typeof window & { __ACTOR_RENDERS__?: Record<string, number> }).__ACTOR_RENDERS__,
  );
  await testInfo.attach("actor-render-counts.json", {
    body: JSON.stringify(counts),
    contentType: "application/json",
  });
  console.info(`ACTOR_RENDERS ${JSON.stringify(counts)}`);
  expect(counts?.["red:soldier:0"]).toBeGreaterThan(0);
  expect(counts?.["red:general:0"]).toBeLessThanOrEqual(3);
});

for (const failGlow of [false, true]) {
  test(`preloads high-quality glow on first move${failGlow ? " and tolerates download failure" : ""}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // Keep software rendering affordable while exercising the full high-quality graph.
    await page.setViewportSize({ width: 640, height: 480 });
    let glowRequests = 0;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/scene/BattlePostprocessing.tsx*", async (route) => {
      glowRequests++;
      if (failGlow) await route.abort();
      else await route.continue();
    });
    await openCleanGame(page, "high", true);
    expect(glowRequests).toBe(0);
    const keyboard = await startGame(page);
    await pressSequence(keyboard, [
      "ArrowLeft",
      "ArrowLeft",
      "ArrowLeft",
      "ArrowLeft",
      "ArrowUp",
      "ArrowUp",
      "ArrowUp",
      "Enter",
      "ArrowUp",
      "Enter",
    ]);
    await waitForRevision(page, 1);
    await pressSequence(keyboard, ["ArrowUp", "ArrowUp", "Enter", "ArrowDown", "Enter"]);
    await waitForRevision(page, 2);
    await expect.poll(() => glowRequests).toBe(1);
    await setReducedMotion(page, false);
    await pressSequence(keyboard, ["ArrowDown", "Enter", "ArrowUp", "Enter"]);
    await waitForRevision(page, 3);
    expect(glowRequests).toBe(1);
    if (!failGlow) {
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { __BLOOM_MAX_SELECTION__?: number })
              .__BLOOM_MAX_SELECTION__ ?? 0,
        ),
      ).toBeGreaterThan(0);
    }
    await expect(page.locator(".game-capture-ledger .black")).toContainText("卒");
    await expect(page.locator("canvas")).toBeVisible();
    expect(errors).toEqual([]);
  });
}
