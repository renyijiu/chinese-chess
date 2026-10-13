import { expect, test, type Page } from "@playwright/test";

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
      alternate: Fiber | null;
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
      __COMPONENT_RENDERS__?: Record<string, number>;
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
        // Follow only the fibers React worked on in this commit. A subtree it
        // skipped keeps its previous child pointer and its stale render flags.
        const visit = (first: Fiber | null) => {
          for (let fiber = first; fiber; fiber = fiber.sibling) {
            const name = fiber.type?.name;
            if (name && (fiber.flags & 1) !== 0) {
              const components = target.__COMPONENT_RENDERS__;
              if (components) components[name] = (components[name] ?? 0) + 1;
              const actors = target.__ACTOR_RENDERS__;
              const actor = fiber.memoizedProps?.actorId;
              if (actors && actor && name === "PieceActor") {
                actors[actor] = (actors[actor] ?? 0) + 1;
              }
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
            if (fiber.child && fiber.child !== fiber.alternate?.child) visit(fiber.child);
          }
        };
        visit(root.current);
      },
    };
  });
});

type RenderCounts = Readonly<{
  actors: Record<string, number>;
  components: Record<string, number>;
}>;

async function resetRenderCounts(page: Page) {
  await page.evaluate(() => {
    const target = window as typeof window & {
      __ACTOR_RENDERS__?: Record<string, number>;
      __COMPONENT_RENDERS__?: Record<string, number>;
    };
    target.__ACTOR_RENDERS__ = {};
    target.__COMPONENT_RENDERS__ = {};
  });
}

function readRenderCounts(page: Page): Promise<RenderCounts> {
  return page.evaluate(() => {
    const target = window as typeof window & {
      __ACTOR_RENDERS__?: Record<string, number>;
      __COMPONENT_RENDERS__?: Record<string, number>;
    };
    return {
      actors: { ...target.__ACTOR_RENDERS__ },
      components: { ...target.__COMPONENT_RENDERS__ },
    };
  });
}

test("keeps stationary actors and the static scene out of React updates", async ({
  page,
}, testInfo) => {
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
  await resetRenderCounts(page);
  await keyboard.press("Enter");
  await waitForRevision(page, 1);
  const move = await readRenderCounts(page);

  // Moving the keyboard cursor redraws its marker and nothing else in the scene.
  await resetRenderCounts(page);
  await pressSequence(keyboard, ["ArrowRight", "ArrowRight"]);
  await expect(keyboard).toContainText("c4");
  const cursor = await readRenderCounts(page);

  await testInfo.attach("render-counts.json", {
    body: JSON.stringify({ cursor, move }),
    contentType: "application/json",
  });
  console.info(`RENDER_COUNTS ${JSON.stringify({ cursor, move })}`);
  expect(move.actors["red:soldier:0"]).toBeGreaterThan(0);
  expect(Object.keys(move.actors)).toEqual(["red:soldier:0"]);
  expect(cursor.actors).toEqual({});
  for (const counts of [move, cursor]) {
    expect(counts.components.DioramaEnvironment ?? 0).toBe(0);
    expect(counts.components.BoardSurface ?? 0).toBe(0);
  }
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
