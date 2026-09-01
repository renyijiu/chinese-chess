import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const AUTHORITATIVE_SOURCE_COMMIT = "96cadeb";
export const SOURCE_LOCK_PATH = "assets/models/authoritative-piece-sources.lock.json";

const LOCK_SCHEMA = "xiangqi-authoritative-piece-sources/v1";
const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(message);
}

export function readSourceLock(root, roleNames) {
  const path = resolve(root, SOURCE_LOCK_PATH);
  if (!existsSync(path)) fail(`Missing authoritative source lock: ${path}`);
  let lock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Invalid authoritative source lock: ${error.message}`);
  }
  if (lock.schema !== LOCK_SCHEMA) fail(`Authoritative source lock schema must be ${LOCK_SCHEMA}`);
  if (lock.sourceCommit !== AUTHORITATIVE_SOURCE_COMMIT) {
    fail(`Authoritative source lock must pin source commit ${AUTHORITATIVE_SOURCE_COMMIT}`);
  }
  const lockedRoles = Object.keys(lock.roles ?? {}).sort();
  const expectedRoles = [...roleNames].sort();
  if (JSON.stringify(lockedRoles) !== JSON.stringify(expectedRoles)) {
    fail(
      `Authoritative source lock roles differ; expected ${expectedRoles.join(", ")}, got ${lockedRoles.join(", ")}`,
    );
  }
  return lock;
}

export function assertLockedBytes(bytes, entry, label) {
  if (!entry?.path || !SHA256_PATTERN.test(entry.sha256 ?? "")) {
    fail(`${label} must provide a path and lowercase SHA-256 digest`);
  }
  if (bytes.subarray(0, LFS_POINTER_PREFIX.length).toString("utf8") === LFS_POINTER_PREFIX) {
    fail(`${label} is an unhydrated Git LFS pointer: ${entry.path}`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== entry.sha256) {
    fail(`${label} digest drift: ${entry.path} expected ${entry.sha256}, got ${actual}`);
  }
  return actual;
}

export function assertLockedFile(root, entry, label) {
  if (!entry?.path) fail(`${label} must provide a path`);
  const path = resolve(root, entry.path);
  if (!existsSync(path)) fail(`Missing ${label}: ${entry.path}`);
  assertLockedBytes(readFileSync(path), entry, label);
  return path;
}

export function verifyAuthoritativeSources(root, lock, roleNames) {
  for (const role of roleNames) {
    const source = lock.roles[role];
    assertLockedFile(root, source?.visual, `${role} authoritative GLB`);
    assertLockedFile(root, source?.editableMaster, `${role} authoritative BLEND`);
  }
}

export function verifyRawLods(root, lock, roleNames, lods) {
  for (const role of roleNames) {
    for (const lod of lods) {
      assertLockedFile(root, lock.roles[role]?.rawLods?.[lod], `${role}/${lod} raw GLB`);
    }
  }
}
