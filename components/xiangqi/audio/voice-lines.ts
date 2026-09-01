import type { Side } from "../../../lib/xiangqi/index";
import type { AudioRole } from "./audio-types";

export const ROLE_VOICE_LINES: Readonly<
  Record<AudioRole, Readonly<Record<Side, readonly string[]>>>
> = Object.freeze({
  marshal: {
    red: ["令行如山！", "护我山河！", "将士听令！"],
    black: ["玄甲听令！", "此阵必破！", "全军进击！"],
  },
  advisor: {
    red: ["符节在此。", "依令布阵！", "守正出奇。"],
    black: ["虎符合验。", "护卫在此。", "阵门已开。"],
  },
  elephant: {
    red: ["踏碎敌阵！", "山岳同行！", "无可撼动！"],
    black: ["玄象开路！", "大地震鸣！", "碾过此阵！"],
  },
  chariot: {
    red: ["长驱直入！", "铁轮开道！", "破阵！"],
    black: ["战车推进！", "碾碎防线！", "势不可挡！"],
  },
  horse: {
    red: ["策马破敌！", "银枪所向！", "随我冲锋！"],
    black: ["玄骑突进！", "月刃出鞘！", "踏破长阵！"],
  },
  cannon: {
    red: ["张弩！", "重矢破阵！", "床弩齐发！"],
    black: ["绞轴上弦！", "重弩已张！", "穿阵！"],
  },
  soldier: {
    red: ["寸土不让！", "向前！", "死战不退！"],
    black: ["步步为营！", "列阵推进！", "绝不后退！"],
  },
});
