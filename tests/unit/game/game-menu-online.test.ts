import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GameMenu } from "../../../components/xiangqi/hud/GameHud";

function renderMenu(onlineEnabled: boolean, resumeMode?: "online") {
  return renderToStaticMarkup(
    createElement(GameMenu, {
      hasSave: Boolean(resumeMode),
      loading: false,
      onlineEnabled,
      resumeMode,
      onContinue: () => undefined,
      onStart: () => undefined,
    }),
  );
}

describe("GameMenu online entry", () => {
  it("keeps the online entry behind its public feature flag", () => {
    expect(renderMenu(false)).not.toContain("好友直连");
    expect(renderMenu(true)).toContain("好友直连");
  });

  it("describes online continuation as a fresh pairing", () => {
    expect(renderMenu(true, "online")).toContain("重新配对继续在线棋局");
    expect(renderMenu(false, "online")).toContain("在线模式当前未启用");
  });
});
