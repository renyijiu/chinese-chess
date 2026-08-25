import { FACTION_COLORS } from "../pieces/faction-colors";

export type ThemeStateIndicator = "dot" | "ring" | "double-outline" | "halo" | "seal";

export type ThemeStateToken = Readonly<{
  color: number;
  indicator: ThemeStateIndicator;
}>;

function state(color: number, indicator: ThemeStateIndicator): ThemeStateToken {
  return Object.freeze({ color, indicator });
}

export function cssHex(color: number) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

const MATERIALS = Object.freeze({
  agedBronze: 0x806847,
  blackLacquer: 0x171612,
  chalk: 0xeadcc3,
  firedClay: 0x986347,
  firedClayLight: 0xc18a64,
  firedClayShadow: 0x4f3026,
});

const ACCENTS = Object.freeze({
  cinnabar: FACTION_COLORS.red.trim,
  mineralBlue: 0x365f75,
  verdigris: FACTION_COLORS.black.trim,
});

const STATES = Object.freeze({
  capture: state(ACCENTS.cinnabar, "ring"),
  check: state(FACTION_COLORS.red.glow, "seal"),
  keyboardFocus: state(ACCENTS.mineralBlue, "double-outline"),
  legal: state(MATERIALS.chalk, "dot"),
  selected: state(MATERIALS.agedBronze, "halo"),
});

const HUD = Object.freeze({
  border: MATERIALS.agedBronze,
  surface: MATERIALS.blackLacquer,
  surfaceRaised: MATERIALS.firedClayShadow,
  text: MATERIALS.chalk,
  textMuted: MATERIALS.firedClayLight,
});

const ENVIRONMENT = Object.freeze({
  background: MATERIALS.blackLacquer,
  brazierFlame: 0xffa247,
  brazierLight: 0xff9a55,
  fillLight: ACCENTS.mineralBlue,
  fog: 0x33271f,
  keyLight: MATERIALS.firedClayLight,
});

/** Canonical numeric values consumed by Three.js scene and interaction layers. */
export const QIN_DIORAMA_THEME = Object.freeze({
  accents: ACCENTS,
  environment: ENVIRONMENT,
  factions: FACTION_COLORS,
  hud: HUD,
  materials: MATERIALS,
  states: STATES,
});

/** JSON-serializable projection of the canonical theme for DOM and CSS consumers. */
export const QIN_DIORAMA_CSS_VARIABLES = Object.freeze({
  "--qin-aged-bronze": cssHex(QIN_DIORAMA_THEME.materials.agedBronze),
  "--qin-black-lacquer": cssHex(QIN_DIORAMA_THEME.materials.blackLacquer),
  "--qin-chalk": cssHex(QIN_DIORAMA_THEME.materials.chalk),
  "--qin-cinnabar": cssHex(QIN_DIORAMA_THEME.accents.cinnabar),
  "--qin-fired-clay": cssHex(QIN_DIORAMA_THEME.materials.firedClay),
  "--qin-fired-clay-light": cssHex(QIN_DIORAMA_THEME.materials.firedClayLight),
  "--qin-fired-clay-shadow": cssHex(QIN_DIORAMA_THEME.materials.firedClayShadow),
  "--qin-mineral-blue": cssHex(QIN_DIORAMA_THEME.accents.mineralBlue),
  "--qin-verdigris": cssHex(QIN_DIORAMA_THEME.accents.verdigris),
  "--qin-faction-red-primary": cssHex(QIN_DIORAMA_THEME.factions.red.clothPrimary),
  "--qin-faction-red-secondary": cssHex(QIN_DIORAMA_THEME.factions.red.clothSecondary),
  "--qin-faction-red-bronze": cssHex(QIN_DIORAMA_THEME.factions.red.bronze),
  "--qin-faction-red-glow": cssHex(QIN_DIORAMA_THEME.factions.red.glow),
  "--qin-faction-red-trim": cssHex(QIN_DIORAMA_THEME.factions.red.trim),
  "--qin-faction-black-primary": cssHex(QIN_DIORAMA_THEME.factions.black.clothPrimary),
  "--qin-faction-black-secondary": cssHex(QIN_DIORAMA_THEME.factions.black.clothSecondary),
  "--qin-faction-black-bronze": cssHex(QIN_DIORAMA_THEME.factions.black.bronze),
  "--qin-faction-black-glow": cssHex(QIN_DIORAMA_THEME.factions.black.glow),
  "--qin-faction-black-trim": cssHex(QIN_DIORAMA_THEME.factions.black.trim),
  "--qin-state-capture": cssHex(QIN_DIORAMA_THEME.states.capture.color),
  "--qin-state-check": cssHex(QIN_DIORAMA_THEME.states.check.color),
  "--qin-state-keyboard-focus": cssHex(QIN_DIORAMA_THEME.states.keyboardFocus.color),
  "--qin-state-legal": cssHex(QIN_DIORAMA_THEME.states.legal.color),
  "--qin-state-selected": cssHex(QIN_DIORAMA_THEME.states.selected.color),
  "--qin-hud-border": cssHex(QIN_DIORAMA_THEME.hud.border),
  "--qin-hud-surface": cssHex(QIN_DIORAMA_THEME.hud.surface),
  "--qin-hud-surface-raised": cssHex(QIN_DIORAMA_THEME.hud.surfaceRaised),
  "--qin-hud-text": cssHex(QIN_DIORAMA_THEME.hud.text),
  "--qin-hud-text-muted": cssHex(QIN_DIORAMA_THEME.hud.textMuted),
  "--qin-environment-background": cssHex(QIN_DIORAMA_THEME.environment.background),
  "--qin-environment-fill-light": cssHex(QIN_DIORAMA_THEME.environment.fillLight),
  "--qin-environment-fog": cssHex(QIN_DIORAMA_THEME.environment.fog),
  "--qin-environment-key-light": cssHex(QIN_DIORAMA_THEME.environment.keyLight),
});
