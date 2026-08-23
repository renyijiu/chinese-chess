import type { Role } from "../../../lib/xiangqi/index";
import type { PieceLod } from "../runtime/quality";

export type AssetRole = "marshal" | Exclude<Role, "general">;

export const ASSET_ROLE_BY_GAME_ROLE: Readonly<Record<Role, AssetRole>> = Object.freeze({
  general: "marshal",
  advisor: "advisor",
  elephant: "elephant",
  chariot: "chariot",
  horse: "horse",
  cannon: "cannon",
  soldier: "soldier",
});

export function pieceAssetUrl(role: Role, lod: PieceLod) {
  const assetRole = ASSET_ROLE_BY_GAME_ROLE[role];
  return `/models/pieces/v1/${assetRole}/${assetRole}-lod${lod}.glb`;
}
