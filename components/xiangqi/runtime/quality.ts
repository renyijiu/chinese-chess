export type QualityTier = "high" | "medium" | "low";
export type PieceLod = 0 | 1 | 2;
export type PanoramaVariant = "high" | "medium" | "low";
export type EnvironmentShadowStrategy = "static-full" | "static-reduced" | "none";
export type DynamicEnvironmentLightStrategy = "animated" | "static" | "none";

export type EnvironmentMotionPolicy = Readonly<{
  dust: boolean;
  dynamicLightUpdates: boolean;
  flags: boolean;
  river: boolean;
}>;

export type EnvironmentQualityProfile = Readonly<{
  detailLevel: 3 | 2 | 1;
  dynamicLightStrategy: DynamicEnvironmentLightStrategy;
  motion: EnvironmentMotionPolicy;
  panorama: PanoramaVariant;
  shadowStrategy: EnvironmentShadowStrategy;
}>;

export type QualityProfile = Readonly<{
  ambientFps: number;
  dpr: readonly [minimum: number, maximum: number];
  dynamicEffectLights: boolean;
  environment: EnvironmentQualityProfile;
  lod: PieceLod;
  particleScale: number;
  postprocessing: boolean;
  shadowMapSize: 2048 | 1024 | 512;
  shadows: boolean;
}>;

function dpr(minimum: number, maximum: number): readonly [minimum: number, maximum: number] {
  return Object.freeze([minimum, maximum]) as readonly [number, number];
}

function motion(value: EnvironmentMotionPolicy): EnvironmentMotionPolicy {
  return Object.freeze(value);
}

function environment(value: EnvironmentQualityProfile): EnvironmentQualityProfile {
  return Object.freeze(value);
}

function profile(value: QualityProfile): QualityProfile {
  return Object.freeze(value);
}

const REDUCED_MOTION_ENVIRONMENT = motion({
  dust: false,
  dynamicLightUpdates: false,
  flags: false,
  river: false,
});

export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = Object.freeze({
  high: profile({
    ambientFps: 60,
    dpr: dpr(1, 1.5),
    dynamicEffectLights: true,
    environment: environment({
      detailLevel: 3,
      dynamicLightStrategy: "animated",
      motion: motion({ dust: true, dynamicLightUpdates: true, flags: true, river: true }),
      panorama: "high",
      shadowStrategy: "static-full",
    }),
    lod: 1,
    particleScale: 1,
    postprocessing: true,
    shadowMapSize: 2048,
    shadows: true,
  }),
  medium: profile({
    ambientFps: 24,
    dpr: dpr(1, 1.25),
    dynamicEffectLights: true,
    environment: environment({
      detailLevel: 2,
      dynamicLightStrategy: "static",
      motion: motion({ dust: true, dynamicLightUpdates: false, flags: true, river: true }),
      panorama: "medium",
      shadowStrategy: "static-reduced",
    }),
    lod: 1,
    particleScale: 0.65,
    postprocessing: false,
    shadowMapSize: 1024,
    shadows: true,
  }),
  low: profile({
    ambientFps: 15,
    dpr: dpr(1, 1),
    dynamicEffectLights: false,
    environment: environment({
      detailLevel: 1,
      dynamicLightStrategy: "none",
      motion: motion({ dust: false, dynamicLightUpdates: false, flags: false, river: false }),
      panorama: "low",
      shadowStrategy: "none",
    }),
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

export function resolveEnvironmentMotion(
  profile: QualityProfile,
  reducedMotion: boolean,
): EnvironmentMotionPolicy {
  return reducedMotion ? REDUCED_MOTION_ENVIRONMENT : profile.environment.motion;
}
