import { describe, expect, it, vi } from "vitest";

import {
  createInitialGame,
  dispatch,
} from "../../../lib/xiangqi/index";
import { ControllerRuntime } from "../../../components/xiangqi/game/ControllerRuntime";
import {
  commandErrorMessage,
  describeKeyboardSquare,
  eventAnnouncement,
  formatGameOutcome,
} from "../../../components/xiangqi/game/announcements";
import { isKeyboardNavigationKey } from "../../../components/xiangqi/game/controller";
import { createLocalMatch } from "../../../components/xiangqi/game/match";

describe("XiangqiGame component support", () => {
  it("keeps mutable controller callbacks outside React state", async () => {
    const initial = createLocalMatch();
    const replacement = createLocalMatch();
    const commit = vi.fn(async () => undefined);
    const fallback = vi.fn(async () => undefined);
    const runtime = new ControllerRuntime(initial);

    runtime.synchronize(replacement);
    runtime.setHandlers(commit, fallback);
    await runtime.commit({} as Parameters<typeof runtime.commit>[0]);
    await runtime.fallback("match-1", "lightweight-hard");
    runtime.setMounted(false);

    expect(runtime.currentMatch).toBe(replacement);
    expect(runtime.isMounted).toBe(false);
    expect(commit).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith("match-1", "lightweight-hard");
  });

  it("derives keyboard labels and navigation policy from the rules state", () => {
    const game = createInitialGame();

    expect(describeKeyboardSquare(game, { file: 0, rank: 3 })).toBe("红方兵卒");
    expect(describeKeyboardSquare(game, { file: 0, rank: 4 })).toBe("空交叉点");
    expect(isKeyboardNavigationKey("ArrowLeft")).toBe(true);
    expect(isKeyboardNavigationKey("W")).toBe(true);
    expect(isKeyboardNavigationKey("Tab")).toBe(false);
  });

  it("turns command and domain outcomes into stable announcements", () => {
    const game = createInitialGame();
    const result = dispatch(game, {
      type: "move",
      expectedRevision: 0,
      from: { file: 0, rank: 3 },
      to: { file: 0, rank: 4 },
    });
    const committed = result.events.find((event) => event.type === "MoveCommitted");

    expect(committed?.type).toBe("MoveCommitted");
    expect(eventAnnouncement(result.events, result.state)).toBe(
      committed?.type === "MoveCommitted" ? committed.move.notation : "",
    );
    expect(commandErrorMessage("stale-revision")).toBe("这次操作已过期，请重新选择棋子。");
    expect(formatGameOutcome(result.state)).toBe("棋局进行中");
  });
});
