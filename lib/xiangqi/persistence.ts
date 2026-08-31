import { createInitialGame, dispatch, isSquare } from "./engine";
import {
  POPULAR_RULESET_ID,
  XIANGQI_SCHEMA_VERSION,
  type GameCommand,
  type GameState,
  type ReplayCommand,
  type Side,
} from "./types";

interface SerializedGameV1 {
  readonly schemaVersion: typeof XIANGQI_SCHEMA_VERSION;
  readonly rulesetId: typeof POPULAR_RULESET_ID;
  readonly initialPosition: "standard";
  readonly commands: ReadonlyArray<ReplayCommand>;
}

export class XiangqiSerializationError extends Error {
  readonly code = "invalid-save";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "XiangqiSerializationError";
  }
}

export function serializeGame(state: GameState): string {
  const value: SerializedGameV1 = {
    schemaVersion: XIANGQI_SCHEMA_VERSION,
    rulesetId: POPULAR_RULESET_ID,
    initialPosition: "standard",
    commands: state.commandLog,
  };
  return JSON.stringify(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function fingerprintGame(state: GameState): Promise<string> {
  return sha256Hex(serializeGame(state));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReplayCommand(value: unknown, index: number): ReplayCommand {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new XiangqiSerializationError(`Command ${index} is not an object with a type.`);
  }
  if (value.type === "undo") {
    return { type: "undo" };
  }
  if (value.type === "resign") {
    if (value.side === undefined) return { type: "resign" };
    if (value.side !== "red" && value.side !== "black") {
      throw new XiangqiSerializationError(`Command ${index} contains an invalid resigning side.`);
    }
    return { type: "resign", side: value.side as Side };
  }
  if (value.type !== "move" || !isRecord(value.from) || !isRecord(value.to)) {
    throw new XiangqiSerializationError(`Command ${index} is not a valid replay command.`);
  }
  const fromFile = value.from.file;
  const fromRank = value.from.rank;
  const toFile = value.to.file;
  const toRank = value.to.rank;
  if (
    typeof fromFile !== "number" ||
    typeof fromRank !== "number" ||
    typeof toFile !== "number" ||
    typeof toRank !== "number"
  ) {
    throw new XiangqiSerializationError(`Command ${index} contains an invalid square.`);
  }
  const from = { file: fromFile, rank: fromRank };
  const to = { file: toFile, rank: toRank };
  if (!isSquare(from) || !isSquare(to)) {
    throw new XiangqiSerializationError(`Command ${index} contains an invalid square.`);
  }
  return { type: "move", from, to };
}

function parseSerializedGame(serialized: string): SerializedGameV1 {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (cause) {
    throw new XiangqiSerializationError("The save is not valid JSON.", { cause });
  }
  if (!isRecord(value)) {
    throw new XiangqiSerializationError("The save root must be an object.");
  }
  if (
    value.schemaVersion !== XIANGQI_SCHEMA_VERSION ||
    value.rulesetId !== POPULAR_RULESET_ID ||
    value.initialPosition !== "standard"
  ) {
    throw new XiangqiSerializationError("The save schema, ruleset, or initial position is unsupported.");
  }
  if (!Array.isArray(value.commands) || value.commands.length > 10_000) {
    throw new XiangqiSerializationError("The save command list is missing or too large.");
  }
  return {
    schemaVersion: XIANGQI_SCHEMA_VERSION,
    rulesetId: POPULAR_RULESET_ID,
    initialPosition: "standard",
    commands: value.commands.map(parseReplayCommand),
  };
}

export function deserializeGame(serialized: string): GameState {
  const saved = parseSerializedGame(serialized);
  let state = createInitialGame();
  for (const replay of saved.commands) {
    const command: GameCommand = { ...replay, expectedRevision: state.revision };
    const result = dispatch(state, command);
    if (result.error) {
      throw new XiangqiSerializationError(
        `Replay command ${state.commandLog.length} was rejected: ${result.error.code}.`,
      );
    }
    state = result.state;
  }
  return state;
}
