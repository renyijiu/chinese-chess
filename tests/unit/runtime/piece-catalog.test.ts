import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ASSET_ROLE_BY_GAME_ROLE,
  pieceAssetUrl,
} from "../../../components/xiangqi/pieces/piece-catalog";

type PieceManifest = Readonly<{
  roles: Readonly<
    Record<
      string,
      Readonly<{
        variants: Readonly<
          Record<
            "red" | "black",
            Readonly<{
              lods: Readonly<Record<"lod0" | "lod1" | "lod2", string>>;
            }>
          >
        >;
      }>
    >
  >;
}>;

const manifest = JSON.parse(
  readFileSync(new URL("../../../public/models/pieces/v1/manifest.json", import.meta.url), "utf8"),
) as PieceManifest;

describe("piece asset catalog", () => {
  it("covers all seven game roles with production GLB families", () => {
    expect(ASSET_ROLE_BY_GAME_ROLE).toEqual({
      general: "marshal",
      advisor: "advisor",
      elephant: "elephant",
      chariot: "chariot",
      horse: "horse",
      cannon: "cannon",
      soldier: "soldier",
    });
  });

  it("matches every role and LOD URL in the validated production manifest", () => {
    for (const [gameRole, assetRole] of Object.entries(ASSET_ROLE_BY_GAME_ROLE)) {
      const roleManifest = manifest.roles[assetRole];
      if (!roleManifest) throw new Error(`Missing asset role ${assetRole}`);
      for (const lod of [0, 1, 2] as const) {
        const expected = roleManifest.variants.red.lods[`lod${lod}`];
        expect(pieceAssetUrl(gameRole as keyof typeof ASSET_ROLE_BY_GAME_ROLE, lod)).toBe(expected);
        expect(roleManifest.variants.black.lods[`lod${lod}`]).toBe(expected);
      }
    }
  });
});
