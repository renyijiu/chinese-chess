"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import { RoundedBox } from "@react-three/drei";
import { Component, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import {
  BOARD_FILE_POSITIONS,
  BOARD_SPACING,
  BOARD_SURFACE_Y,
} from "../runtime/board-coordinates";
import { useScheduledFrame } from "../runtime/FrameScheduler";
import {
  makeBoardOrnamentPlacements,
  makeBoardSegments,
  makeClayTilePlacements,
  makeEnclosureWallPlacements,
  type BoardOrnamentKind,
} from "./board-geometry";
import { cssHex, QIN_DIORAMA_THEME } from "./scene-theme";

const FILE_MIN = Math.min(...BOARD_FILE_POSITIONS);
const FILE_MAX = Math.max(...BOARD_FILE_POSITIONS);
const TILE_HEIGHT = 0.24;
const TILE_TOP_Y = BOARD_SURFACE_Y - 0.035;

function QinClayTiles({ castShadow = true }: { castShadow?: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(
    () => new RoundedBoxGeometry(
      BOARD_SPACING - 0.065,
      TILE_HEIGHT,
      BOARD_SPACING - 0.065,
      2,
      0.075,
    ),
    [],
  );
  const tiles = useMemo(() => makeClayTilePlacements(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();

    tiles.forEach((tile, index) => {
      transform.position.set(tile.position[0], TILE_TOP_Y - TILE_HEIGHT / 2, tile.position[1]);
      transform.rotation.set(0, tile.rotation, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [tiles]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, tiles.length]}
      castShadow={castShadow}
      name="qin-clay-tiles"
      raycast={() => null}
      receiveShadow
    >
      <meshStandardMaterial
        color={QIN_DIORAMA_THEME.materials.firedClay}
        roughness={0.92}
      />
    </instancedMesh>
  );
}

export function BoardLines({ castShadow = true }: { castShadow?: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const segments = useMemo(() => makeBoardSegments(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const direction = new THREE.Vector3();
    segments.forEach(([[x1, z1], [x2, z2]], index) => {
      start.set(x1, BOARD_SURFACE_Y - 0.021, z1);
      end.set(x2, BOARD_SURFACE_Y - 0.021, z2);
      direction.subVectors(end, start);
      const length = direction.length();
      transform.position.copy(start).add(end).multiplyScalar(0.5);
      transform.quaternion.setFromUnitVectors(up, direction.normalize());
      transform.scale.set(1, length, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [segments]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, segments.length]}
      castShadow={castShadow}
      name="black-lacquer-grid"
      raycast={() => null}
    >
      <cylinderGeometry args={[0.024, 0.024, 1, 8]} />
      <meshStandardMaterial
        color={QIN_DIORAMA_THEME.materials.blackLacquer}
        metalness={0.04}
        roughness={0.72}
      />
    </instancedMesh>
  );
}

const glazeVertexShader = `
  uniform float uTime;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    vUv = uv;
    vec3 displaced = position;
    float wave = sin(position.x * 1.7 + uTime * 0.42) * 0.012;
    wave += sin(position.x * 3.9 - uTime * 0.58 + position.y * 3.0) * 0.006;
    displaced.z += wave;
    vWave = wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const glazeFragmentShader = `
  uniform float uTime;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uGlintColor;
  varying vec2 vUv;
  varying float vWave;

  void main() {
    float current = sin(vUv.x * 24.0 - uTime * 0.48 + sin(vUv.y * 9.0)) * 0.5 + 0.5;
    float swirl = sin(length(vUv - vec2(0.5)) * 42.0 - uTime * 0.34) * 0.5 + 0.5;
    float glint = smoothstep(0.91, 1.0, current * 0.7 + swirl * 0.3) * 0.18;
    float blend = clamp(vUv.y * 0.42 + 0.24 + vWave * 2.5, 0.0, 1.0);
    vec3 color = mix(uDeepColor, uShallowColor, blend);
    color += uGlintColor * glint;
    gl_FragColor = vec4(color, 0.94);
  }
`;

class OptionalRiverBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.warn("Animated Qin glaze degraded to its static river surface", error);
  }

  render() {
    return this.state.failed ? <StaticGlazedRiver /> : this.props.children;
  }
}

function StaticGlazedRiver() {
  return (
    <group name="qin-glazed-river-fallback">
      <mesh raycast={() => null} receiveShadow position={[0, 0.31, 0]}>
        <boxGeometry args={[FILE_MAX - FILE_MIN + 0.14, 0.16, BOARD_SPACING - 0.06]} />
        <meshStandardMaterial
          color={QIN_DIORAMA_THEME.materials.blackLacquer}
          metalness={0.04}
          roughness={0.72}
        />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.455, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FILE_MAX - FILE_MIN, BOARD_SPACING - 0.14]} />
        <meshStandardMaterial
          color={QIN_DIORAMA_THEME.accents.mineralBlue}
          metalness={0.05}
          roughness={0.65}
        />
      </mesh>
    </group>
  );
}

function GlazedRiver({ animate = true }: { animate?: boolean }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => {
    const { accents, materials } = QIN_DIORAMA_THEME;
    return {
      uDeepColor: {
        value: new THREE.Color(materials.blackLacquer).lerp(
          new THREE.Color(accents.mineralBlue),
          0.42,
        ),
      },
      uGlintColor: { value: new THREE.Color(materials.chalk) },
      uShallowColor: {
        value: new THREE.Color(accents.mineralBlue).lerp(
          new THREE.Color(accents.verdigris),
          0.38,
        ),
      },
      uTime: { value: 0 },
    };
  }, []);

  useScheduledFrame((elapsed) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = elapsed;
  }, animate);

  return (
    <group name={animate ? "qin-glazed-river-animated" : "qin-glazed-river-static"}>
      <mesh raycast={() => null} receiveShadow position={[0, 0.31, 0]}>
        <boxGeometry args={[FILE_MAX - FILE_MIN + 0.14, 0.16, BOARD_SPACING - 0.06]} />
        <meshStandardMaterial
          color={QIN_DIORAMA_THEME.materials.blackLacquer}
          metalness={0.08}
          roughness={0.64}
        />
      </mesh>
      <mesh raycast={() => null} position={[0, 0.455, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FILE_MAX - FILE_MIN, BOARD_SPACING - 0.14, 32, 4]} />
        <shaderMaterial
          ref={materialRef}
          fragmentShader={glazeFragmentShader}
          transparent
          uniforms={uniforms}
          vertexShader={glazeVertexShader}
        />
      </mesh>
      {[-BOARD_SPACING / 2, BOARD_SPACING / 2].map((z) => (
        <mesh key={z} raycast={() => null} receiveShadow position={[0, 0.525, z]}>
          <boxGeometry args={[FILE_MAX - FILE_MIN + 0.32, 0.18, 0.15, 1, 1, 2]} />
          <meshStandardMaterial
            color={QIN_DIORAMA_THEME.materials.firedClayShadow}
            metalness={0.02}
            roughness={0.94}
          />
        </mesh>
      ))}
    </group>
  );
}

function RiverInscription({ position, text }: { position: [number, number, number]; text: string }) {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = '700 68px "Songti SC", "STSong", serif';
    context.fillStyle = cssHex(QIN_DIORAMA_THEME.materials.chalk);
    context.shadowColor = cssHex(QIN_DIORAMA_THEME.materials.blackLacquer);
    context.shadowBlur = 7;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const material = materialRef.current;
    if (material) {
      material.map = texture;
      material.needsUpdate = true;
    }
    return () => {
      texture.dispose();
      if (material) material.map = null;
    };
  }, [text]);
  return (
    <mesh raycast={() => null} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[2.5, 0.63]} />
      <meshBasicMaterial ref={materialRef} alphaTest={0.08} transparent toneMapped={false} />
    </mesh>
  );
}

function QinDoubleEnclosure({ castShadow }: { castShadow: boolean }) {
  const wallRef = useRef<THREE.InstancedMesh>(null);
  const wallGeometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 2, 0.16), []);
  const walls = useMemo(() => makeEnclosureWallPlacements(), []);

  useLayoutEffect(() => {
    const mesh = wallRef.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    walls.forEach((wall, index) => {
      transform.position.set(wall.position[0], BOARD_SURFACE_Y - 0.2, wall.position[1]);
      transform.scale.set(...wall.scale);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [walls]);

  useEffect(() => () => wallGeometry.dispose(), [wallGeometry]);

  return (
    <group name="qin-double-enclosure">
      <RoundedBox
        args={[13.3, 0.72, 14.78]}
        castShadow={castShadow}
        position={[0, 0.02, 0]}
        radius={0.24}
        raycast={() => null}
        receiveShadow
        smoothness={3}
      >
        <meshStandardMaterial
          color={QIN_DIORAMA_THEME.materials.firedClayShadow}
          metalness={0.02}
          roughness={0.97}
        />
      </RoundedBox>
      <RoundedBox
        args={[12.76, 0.2, 14.22]}
        castShadow={castShadow}
        position={[0, 0.4, 0]}
        radius={0.12}
        raycast={() => null}
        receiveShadow
        smoothness={2}
      >
        <meshStandardMaterial
          color={QIN_DIORAMA_THEME.materials.firedClay}
          metalness={0.01}
          roughness={0.95}
        />
      </RoundedBox>
      <instancedMesh
        ref={wallRef}
        args={[wallGeometry, undefined, walls.length]}
        castShadow={castShadow}
        name="qin-mausoleum-double-wall"
        raycast={() => null}
        receiveShadow
      >
        <meshStandardMaterial
          color={QIN_DIORAMA_THEME.materials.firedClayLight}
          roughness={0.93}
        />
      </instancedMesh>
    </group>
  );
}

function QinBoardOrnaments() {
  const brickRef = useRef<THREE.InstancedMesh>(null);
  const gateRef = useRef<THREE.InstancedMesh>(null);
  const medallionRef = useRef<THREE.InstancedMesh>(null);
  const swirlRef = useRef<THREE.InstancedMesh>(null);
  const ornaments = useMemo(() => makeBoardOrnamentPlacements(), []);
  const byKind = useMemo(() => {
    const groups: Record<BoardOrnamentKind, ReturnType<typeof makeBoardOrnamentPlacements>> = {
      "brick-impression": [],
      "gate-cue": [],
      "tile-medallion": [],
      "water-swirl": [],
    };
    ornaments.forEach((placement) => groups[placement.kind].push(placement));
    return groups;
  }, [ornaments]);

  useLayoutEffect(() => {
    const transform = new THREE.Object3D();
    const write = (
      ref: typeof brickRef,
      kind: BoardOrnamentKind,
      y: number,
      flatRotation = false,
    ) => {
      const mesh = ref.current;
      if (!mesh) return;
      byKind[kind].forEach((placement, index) => {
        transform.position.set(placement.position[0], y, placement.position[1]);
        transform.rotation.set(flatRotation ? Math.PI / 2 : 0, placement.rotation, 0);
        transform.scale.set(placement.scale[0], 1, placement.scale[1]);
        transform.updateMatrix();
        mesh.setMatrixAt(index, transform.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };

    write(brickRef, "brick-impression", 0.515);
    write(gateRef, "gate-cue", 0.57);
    write(medallionRef, "tile-medallion", 0.535);
    write(swirlRef, "water-swirl", 0.55, true);
  }, [byKind]);

  return (
    <group name="sparse-qin-impressions">
      <instancedMesh
        ref={brickRef}
        args={[undefined, undefined, byKind["brick-impression"].length]}
        raycast={() => null}
      >
        <boxGeometry args={[1, 0.025, 1]} />
        <meshStandardMaterial color={QIN_DIORAMA_THEME.materials.blackLacquer} roughness={0.8} />
      </instancedMesh>
      <instancedMesh
        ref={gateRef}
        args={[undefined, undefined, byKind["gate-cue"].length]}
        raycast={() => null}
      >
        <boxGeometry args={[1, 0.14, 1, 2, 1, 2]} />
        <meshStandardMaterial
          color={QIN_DIORAMA_THEME.materials.agedBronze}
          metalness={0.34}
          roughness={0.67}
        />
      </instancedMesh>
      <instancedMesh
        ref={medallionRef}
        args={[undefined, undefined, byKind["tile-medallion"].length]}
        raycast={() => null}
      >
        <cylinderGeometry args={[1, 1, 0.055, 12]} />
        <meshStandardMaterial color={QIN_DIORAMA_THEME.materials.chalk} roughness={0.88} />
      </instancedMesh>
      <instancedMesh
        ref={swirlRef}
        args={[undefined, undefined, byKind["water-swirl"].length]}
        raycast={() => null}
      >
        <torusGeometry args={[0.7, 0.12, 5, 18, Math.PI * 1.55]} />
        <meshStandardMaterial
          color={QIN_DIORAMA_THEME.accents.verdigris}
          metalness={0.12}
          roughness={0.76}
        />
      </instancedMesh>
    </group>
  );
}

export function BoardSurface({ animate, shadows }: { animate: boolean; shadows: boolean }) {
  return (
    <group name="qin-terracotta-mausoleum-board">
      <QinDoubleEnclosure castShadow={false} />
      <QinClayTiles castShadow={shadows} />
      <OptionalRiverBoundary>
        <GlazedRiver animate={animate} />
      </OptionalRiverBoundary>
      <BoardLines castShadow={false} />
      <RiverInscription position={[-2.42, 0.505, 0]} text="楚  河" />
      <RiverInscription position={[2.42, 0.505, 0]} text="漢  界" />
      <QinBoardOrnaments />
    </group>
  );
}
