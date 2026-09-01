import { deserializeGame, serializeGame, sha256Hex } from "../persistence";
import type { GameState, ReplayCommand } from "../types";
import { decodeOnlineMessageValueV1, encodeOnlineMessageV1 } from "./protocol";
import type { SnapshotMessageV1 } from "./types";

export type SnapshotDigest = (canonicalSerializedGame: string) => string | Promise<string>;

export type SnapshotValidationErrorCode =
  | "invalid-snapshot"
  | "invalid-serialization"
  | "non-canonical"
  | "undo-not-allowed"
  | "revision-mismatch"
  | "hash-mismatch"
  | "digest-failed";

export type SnapshotValidationResult =
  | Readonly<{ ok: true; game: GameState }>
  | Readonly<{ ok: false; error: Readonly<{ code: SnapshotValidationErrorCode }> }>;

export type CommandLogComparison =
  | Readonly<{ status: "equal" }>
  | Readonly<{ status: "fast-forward"; missingCommands: ReadonlyArray<ReplayCommand> }>
  | Readonly<{ status: "conflict" }>;

export type SnapshotFastForwardResult =
  | Readonly<{
      ok: true;
      status: "equal" | "fast-forward";
      game: GameState;
      missingCommands: ReadonlyArray<ReplayCommand>;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{ code: SnapshotValidationErrorCode | "history-conflict" }>;
    }>;

function invalid(code: SnapshotValidationErrorCode): SnapshotValidationResult {
  return { ok: false, error: { code } };
}

function commandsEqual(left: ReplayCommand, right: ReplayCommand): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case "undo":
      return true;
    case "resign":
      return right.type === "resign" && left.side === right.side;
    case "move":
      return (
        right.type === "move" &&
        left.from.file === right.from.file &&
        left.from.rank === right.from.rank &&
        left.to.file === right.to.file &&
        left.to.rank === right.to.rank
      );
  }
}

export function compareCommandLogs(
  local: ReadonlyArray<ReplayCommand>,
  remote: ReadonlyArray<ReplayCommand>,
): CommandLogComparison {
  if (
    local.some((command) => command.type === "undo") ||
    remote.some((command) => command.type === "undo")
  ) {
    return { status: "conflict" };
  }
  if (remote.length < local.length) return { status: "conflict" };
  for (let index = 0; index < local.length; index += 1) {
    const localCommand = local[index];
    const remoteCommand = remote[index];
    if (!localCommand || !remoteCommand || !commandsEqual(localCommand, remoteCommand)) {
      return { status: "conflict" };
    }
  }
  if (remote.length === local.length) return { status: "equal" };
  return { status: "fast-forward", missingCommands: remote.slice(local.length) };
}

export async function validateSnapshotV1(
  snapshot: unknown,
  digest: SnapshotDigest = sha256Hex,
): Promise<SnapshotValidationResult> {
  const encoded = encodeOnlineMessageV1(snapshot);
  if (!encoded.ok) return invalid("invalid-snapshot");
  const decoded = decodeOnlineMessageValueV1(snapshot);
  if (!decoded.ok || decoded.value.type !== "snapshot") return invalid("invalid-snapshot");

  let game: GameState;
  try {
    game = deserializeGame(decoded.value.serializedGame);
  } catch {
    return invalid("invalid-serialization");
  }
  if (serializeGame(game) !== decoded.value.serializedGame) return invalid("non-canonical");
  if (game.commandLog.some((command) => command.type === "undo"))
    return invalid("undo-not-allowed");
  if (game.revision !== decoded.value.revision) return invalid("revision-mismatch");

  let positionHash: string;
  try {
    positionHash = await digest(decoded.value.serializedGame);
  } catch {
    return invalid("digest-failed");
  }
  if (positionHash !== decoded.value.positionHash) return invalid("hash-mismatch");
  return { ok: true, game };
}

export async function validateSnapshotForFastForwardV1(
  local: Pick<GameState, "commandLog">,
  snapshot: SnapshotMessageV1,
  digest: SnapshotDigest = sha256Hex,
): Promise<SnapshotFastForwardResult> {
  const validated = await validateSnapshotV1(snapshot, digest);
  if (!validated.ok) return validated;

  const comparison = compareCommandLogs(local.commandLog, validated.game.commandLog);
  if (comparison.status === "conflict") {
    return { ok: false, error: { code: "history-conflict" } };
  }
  return {
    ok: true,
    status: comparison.status,
    game: validated.game,
    missingCommands: comparison.status === "fast-forward" ? comparison.missingCommands : [],
  };
}
