export type QualityTier = "high" | "medium" | "low";
export type PieceLod = 0 | 1 | 2;

export type QualityProfile = Readonly<{
  ambientFps: number;
  dpr: readonly [minimum: number, maximum: number];
  dynamicEffectLights: boolean;
  lod: PieceLod;
  particleScale: number;
  postprocessing: boolean;
  shadowMapSize: 2048 | 1024 | 512;
  shadows: boolean;
}>;

function profile(value: QualityProfile): QualityProfile {
  return Object.freeze(value);
}

export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = Object.freeze({
  high: profile({
    ambientFps: 60,
    dpr: [1, 1.5],
    dynamicEffectLights: true,
    lod: 1,
    particleScale: 1,
    postprocessing: true,
    shadowMapSize: 2048,
    shadows: true,
  }),
  medium: profile({
    ambientFps: 24,
    dpr: [1, 1.25],
    dynamicEffectLights: true,
    lod: 1,
    particleScale: 0.65,
    postprocessing: false,
    shadowMapSize: 1024,
    shadows: true,
  }),
  low: profile({
    ambientFps: 15,
    dpr: [1, 1],
    dynamicEffectLights: false,
    lod: 2,
    particleScale: 0.35,
    postprocessing: false,
    shadowMapSize: 512,
    shadows: false,
  }),
});

export function getQualityProfile(tier: QualityTier): QualityProfile {
  return QUALITY_PROFILES[tier];
}
