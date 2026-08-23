# Piece presentation contract v1

This contract is frozen by the marshal vertical slice and applies to the six
remaining role families.

## Authority and recovery

- The pure Xiangqi dispatcher commits first; the new `GameState` is saved before
  any visual, animation, VFX, camera, or audio work starts.
- Presentation consumes immutable `before`, `after`, and `DomainEvent`
  snapshots. It never writes rule state.
- The event key is `${revision}:${sequence}`. Replayed active or completed keys
  are idempotent.
- Skip, callback failure, page hiding, and the wall-clock timeout settle to the
  committed `after` state. Temporary captured actors and effects are discarded.

## Scene and animation

- Hierarchy: `boardRoot -> visualRoot -> rig/mesh`; exported clips have no
  horizontal root motion.
- Every visible rig is cloned with `SkeletonUtils.clone()` and owns one
  `AnimationMixer`. A single scene `AnimationDirector` updates all registered
  mixers.
- Canonical clip names are `idle_loop`, `move_start`, `move_loop`, `move_end`,
  `attack_primary`, `hit_react`, and `destroy`. Missing clips safely fall back to
  board-root interpolation.
- Shared geometry, textures, and source materials are immutable at runtime.
  Opacity, hit response, and faction changes use per-instance material clones or
  owned effect materials.

## Timeline cues

- Ordinary move: `telegraph -> release -> impact -> complete`, 700 ms target.
- Capture: `telegraph -> release -> impact -> fracture -> vanish -> complete`,
  1,500 ms target.
- Reduced motion settles in 100 ms using a short board-root interpolation and
  reduced light/particle intensity.
- `impact` belongs to runtime contact/projectile logic rather than a guessed
  delay inside the attack GLB. Timeline markers are crossed exactly once even
  when one rendered frame crosses several markers.
- Cue consumers subscribe to the presentation store. Audio or VFX listener
  errors are isolated and cannot hold the board lock.
