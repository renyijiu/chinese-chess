"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import {
  BOARD_FILE_POSITIONS,
  BOARD_RANK_POSITIONS,
  BOARD_SPACING,
} from "../runtime/board-coordinates";
import { useScheduledFrame } from "../runtime/FrameScheduler";

type LineSegment = [[number, number], [number, number]];

const FILE_MIN = Math.min(...BOARD_FILE_POSITIONS);
const FILE_MAX = Math.max(...BOARD_FILE_POSITIONS);
const RANK_MIN = Math.min(...BOARD_RANK_POSITIONS);
const RANK_MAX = Math.max(...BOARD_RANK_POSITIONS);
const ASCENDING_RANKS = [...BOARD_RANK_POSITIONS].sort((a, b) => a - b);

function makeStoneBumpTexture() {
  const size = 128;
  const data = new Uint8Array(size * size);
  let seed = 9301;

  for (let index = 0; index < data.length; index += 1) {
    seed = (seed * 49297 + 233280) % 233280;
    const noise = seed / 233280;
    const x = index % size;
    const y = Math.floor(index / size);
    const veins = Math.sin(x * 0.23 + Math.sin(y * 0.08) * 3) * 12;
    data[index] = Math.max(0, Math.min(255, 116 + noise * 62 + veins));
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.7, 1.7);
  texture.needsUpdate = true;
  return texture;
}

function makeStoneColorTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 1729;

  for (let index = 0; index < size * size; index += 1) {
    seed = (seed * 48271) % 2147483647;
    const noise = seed / 2147483647;
    const x = index % size;
    const y = Math.floor(index / size);
    const broadGrain = Math.sin(x * 0.08 + Math.sin(y * 0.055) * 2.8) * 7;
    const fineGrain = (noise - 0.5) * 24;
    const base = 150 + broadGrain + fineGrain;
    const offset = index * 4;
    data[offset] = Math.max(0, Math.min(255, base * 0.95));
    data[offset + 1] = Math.max(0, Math.min(255, base));
    data[offset + 2] = Math.max(0, Math.min(255, base * 0.96));
    data[offset + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.45, 1.45);
  texture.needsUpdate = true;
  return texture;
}

export function StoneSlabs({ castShadow = true }: { castShadow?: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const bumpTexture = useMemo(() => makeStoneBumpTexture(), []);
  const colorTexture = useMemo(() => makeStoneColorTexture(), []);
  const slabs = useMemo(() => {
    const placements: Array<{ color: THREE.Color; position: [number, number, number]; rotation: number }> = [];
    let seed = 41;

    for (let file = 0; file < 8; file += 1) {
      for (const rankInterval of [-4, -3, -2, -1, 1, 2, 3, 4]) {
        seed = (seed * 16807) % 2147483647;
        const variation = (seed % 100) / 100;
        const tone = 0.8 + variation * 0.19;
        placements.push({
          color: new THREE.Color(0x4c504d).multiplyScalar(tone),
          position: [
            (file - 3.5) * BOARD_SPACING,
            0.535 + variation * 0.018,
            rankInterval * BOARD_SPACING,
          ],
          rotation: (variation - 0.5) * 0.007,
        });
      }
    }
    return placements;
  }, []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    slabs.forEach((slab, index) => {
      transform.position.set(...slab.position);
      transform.rotation.set(0, slab.rotation, 0);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, slab.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [slabs]);

  useEffect(
    () => () => {
      bumpTexture.dispose();
      colorTexture.dispose();
    },
    [bumpTexture, colorTexture],
  );

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, slabs.length]} castShadow={castShadow} receiveShadow>
      <boxGeometry args={[BOARD_SPACING - 0.055, 0.22, BOARD_SPACING - 0.055, 2, 1, 2]} />
      <meshPhysicalMaterial
        bumpMap={bumpTexture}
        bumpScale={0.055}
        clearcoat={0.08}
        clearcoatRoughness={0.55}
        color={0xffffff}
        map={colorTexture}
        metalness={0.04}
        roughness={0.82}
      />
    </instancedMesh>
  );
}

function WetPatches() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const patches = useMemo(
    () => [
      [-3.74, -4.38, 0.36, 0.18, 0.3], [-1.44, -3.52, 0.44, 0.16, -0.5],
      [1.74, -4.16, 0.31, 0.2, 0.1], [3.62, -2.16, 0.42, 0.14, 0.6],
      [-3.3, -1.34, 0.28, 0.13, -0.3], [-0.92, -1.5, 0.48, 0.17, 0.2],
      [2.38, 1.38, 0.38, 0.16, -0.7], [-3.72, 2.16, 0.34, 0.18, 0.4],
      [-1.6, 3.44, 0.47, 0.17, -0.2], [0.72, 4.2, 0.3, 0.13, 0.8],
      [3.42, 3.62, 0.4, 0.15, -0.4], [2.14, 4.66, 0.24, 0.12, 0.2],
    ] as Array<[number, number, number, number, number]>,
    [],
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    patches.forEach(([x, z, width, depth, angle], index) => {
      transform.position.set(x, 0.663, z);
      transform.rotation.set(-Math.PI / 2, 0, angle);
      transform.scale.set(width, depth, 1);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [patches]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, patches.length]} receiveShadow>
      <circleGeometry args={[1, 24]} />
      <meshPhysicalMaterial color={0x142927} depthWrite={false} metalness={0.2} opacity={0.21} roughness={0.2} transparent />
    </instancedMesh>
  );
}

function addCornerMark(segments: LineSegment[], x: number, z: number, xDirection: -1 | 1, zDirection: -1 | 1) {
  const offset = 0.17;
  const length = 0.12;
  const cornerX = x + xDirection * offset;
  const cornerZ = z + zDirection * offset;
  segments.push([[cornerX, cornerZ], [cornerX - xDirection * length, cornerZ]]);
  segments.push([[cornerX, cornerZ], [cornerX, cornerZ - zDirection * length]]);
}

export function makeBoardSegments() {
  const segments: LineSegment[] = [];
  ASCENDING_RANKS.forEach((z) => segments.push([[FILE_MIN, z], [FILE_MAX, z]]));
  BOARD_FILE_POSITIONS.forEach((x, index) => {
    if (index === 0 || index === BOARD_FILE_POSITIONS.length - 1) {
      segments.push([[x, RANK_MIN], [x, RANK_MAX]]);
      return;
    }
    segments.push([[x, RANK_MIN], [x, ASCENDING_RANKS[4]]]);
    segments.push([[x, ASCENDING_RANKS[5]], [x, RANK_MAX]]);
  });
  segments.push(
    [[-BOARD_SPACING, RANK_MIN], [BOARD_SPACING, ASCENDING_RANKS[2]]],
    [[BOARD_SPACING, RANK_MIN], [-BOARD_SPACING, ASCENDING_RANKS[2]]],
    [[-BOARD_SPACING, ASCENDING_RANKS[7]], [BOARD_SPACING, RANK_MAX]],
    [[BOARD_SPACING, ASCENDING_RANKS[7]], [-BOARD_SPACING, RANK_MAX]],
  );

  const markedIntersections = [
    ...[-3, 3].flatMap((file) => [-2.5, 2.5].map((rank) => [file * BOARD_SPACING, rank * BOARD_SPACING])),
    ...[-4, -2, 0, 2, 4].flatMap((file) => [-1.5, 1.5].map((rank) => [file * BOARD_SPACING, rank * BOARD_SPACING])),
  ] as Array<[number, number]>;

  markedIntersections.forEach(([x, z]) => {
    const xDirections: Array<-1 | 1> = x === FILE_MIN ? [1] : x === FILE_MAX ? [-1] : [-1, 1];
    xDirections.forEach((xDirection) => {
      addCornerMark(segments, x, z, xDirection, -1);
      addCornerMark(segments, x, z, xDirection, 1);
    });
  });
  return segments;
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
      start.set(x1, 0.67, z1);
      end.set(x2, 0.67, z2);
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
    <instancedMesh ref={meshRef} args={[undefined, undefined, segments.length]} castShadow={castShadow}>
      <cylinderGeometry args={[0.021, 0.021, 1, 8]} />
      <meshStandardMaterial color={0x8c7149} metalness={0.82} roughness={0.39} />
    </instancedMesh>
  );
}

const waterVertexShader = `
  uniform float uTime; varying vec2 vUv; varying float vWave;
  void main() {
    vUv = uv; vec3 displaced = position;
    float wave = sin(position.x * 2.3 + uTime * 0.9) * 0.028;
    wave += sin(position.x * 5.1 - uTime * 1.25 + position.y * 4.0) * 0.012;
    displaced.z += wave; vWave = wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const waterFragmentShader = `
  uniform float uTime; varying vec2 vUv; varying float vWave;
  void main() {
    float current = sin(vUv.x * 44.0 - uTime * 1.2 + sin(vUv.y * 12.0)) * 0.5 + 0.5;
    float glint = smoothstep(0.86, 1.0, current) * 0.34;
    vec3 deep = vec3(0.018, 0.105, 0.115); vec3 shallow = vec3(0.095, 0.29, 0.30);
    vec3 color = mix(deep, shallow, vUv.y * 0.46 + 0.2 + vWave * 3.0);
    color += vec3(0.45, 0.54, 0.49) * glint;
    gl_FragColor = vec4(color, 0.96);
  }
`;

export function River({ animate = true, castShadows = false }: { animate?: boolean; castShadows?: boolean }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useScheduledFrame((elapsed) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = elapsed;
  }, animate);

  return (
    <group>
      <mesh receiveShadow position={[0, 0.27, 0]}>
        <boxGeometry args={[FILE_MAX - FILE_MIN + 0.08, 0.12, BOARD_SPACING - 0.08]} />
        <meshStandardMaterial color={0x071b1d} metalness={0.15} roughness={0.38} />
      </mesh>
      <mesh position={[0, 0.39, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[FILE_MAX - FILE_MIN, BOARD_SPACING - 0.13, 64, 10]} />
        <shaderMaterial ref={materialRef} fragmentShader={waterFragmentShader} transparent uniforms={uniforms} vertexShader={waterVertexShader} />
      </mesh>
      {[-BOARD_SPACING / 2, BOARD_SPACING / 2].map((z) => (
        <mesh key={z} castShadow={castShadows} receiveShadow position={[0, 0.49, z]}>
          <boxGeometry args={[FILE_MAX - FILE_MIN + 0.35, 0.24, 0.16]} />
          <meshStandardMaterial color={0x353b39} metalness={0.12} roughness={0.86} />
        </mesh>
      ))}
    </group>
  );
}

function RiverInscription({ position, text }: { position: [number, number, number]; text: string }) {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = '700 68px "Songti SC", "STSong", serif';
    context.fillStyle = "#d1ae6b"; context.shadowColor = "rgba(0, 0, 0, 0.8)"; context.shadowBlur = 8;
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
    const material = materialRef.current;
    if (material) { material.map = texture; material.needsUpdate = true; }
    return () => { texture.dispose(); if (material) material.map = null; };
  }, [text]);
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[2.5, 0.63]} />
      <meshBasicMaterial ref={materialRef} alphaTest={0.08} transparent toneMapped={false} />
    </mesh>
  );
}

function BoardFoundation({ castShadow }: { castShadow: boolean }) {
  const crenelsRef = useRef<THREE.InstancedMesh>(null);
  const crenels = useMemo(() => {
    const placements: Array<[number, number, number]> = [];
    for (let z = -6.15; z <= 6.15; z += 0.88) placements.push([-6.18, 1.01, z], [6.18, 1.01, z]);
    for (let x = -5.72; x <= 5.72; x += 0.88) {
      placements.push([x, 1.01, -6.88]);
      if (Math.abs(x) > 2.15) placements.push([x, 1.01, 6.88]);
    }
    return placements;
  }, []);
  useLayoutEffect(() => {
    const mesh = crenelsRef.current;
    if (!mesh) return;
    const transform = new THREE.Object3D();
    crenels.forEach((position, index) => { transform.position.set(...position); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix); });
    mesh.instanceMatrix.needsUpdate = true;
  }, [crenels]);

  return (
    <group>
      <mesh castShadow={castShadow} receiveShadow position={[0, -0.19, 0]}><boxGeometry args={[13.35, 0.74, 14.85]} /><meshStandardMaterial color={0x1d2221} metalness={0.06} roughness={0.94} /></mesh>
      <mesh castShadow={castShadow} receiveShadow position={[0, 0.24, 0]}><boxGeometry args={[12.65, 0.25, 14.15]} /><meshStandardMaterial color={0x343937} metalness={0.12} roughness={0.86} /></mesh>
      <mesh castShadow={castShadow} receiveShadow position={[-6.05, 0.59, 0]}><boxGeometry args={[0.42, 0.58, 13.95]} /><meshStandardMaterial color={0x292f2d} roughness={0.91} /></mesh>
      <mesh castShadow={castShadow} receiveShadow position={[6.05, 0.59, 0]}><boxGeometry args={[0.42, 0.58, 13.95]} /><meshStandardMaterial color={0x292f2d} roughness={0.91} /></mesh>
      <mesh castShadow={castShadow} receiveShadow position={[0, 0.59, -6.75]}><boxGeometry args={[12.5, 0.58, 0.42]} /><meshStandardMaterial color={0x292f2d} roughness={0.91} /></mesh>
      <mesh castShadow={castShadow} receiveShadow position={[-4.12, 0.59, 6.75]}><boxGeometry args={[4, 0.58, 0.42]} /><meshStandardMaterial color={0x292f2d} roughness={0.91} /></mesh>
      <mesh castShadow={castShadow} receiveShadow position={[4.12, 0.59, 6.75]}><boxGeometry args={[4, 0.58, 0.42]} /><meshStandardMaterial color={0x292f2d} roughness={0.91} /></mesh>
      <instancedMesh ref={crenelsRef} args={[undefined, undefined, crenels.length]} castShadow={castShadow} receiveShadow>
        <boxGeometry args={[0.48, 0.58, 0.48]} /><meshStandardMaterial color={0x343b38} metalness={0.08} roughness={0.88} />
      </instancedMesh>
      {[0, 1, 2].map((step) => (
        <mesh key={step} castShadow={castShadow} receiveShadow position={[0, -0.32 - step * 0.2, 7.24 + step * 0.36]}>
          <boxGeometry args={[4.1 + step * 0.5, 0.22, 0.72]} /><meshStandardMaterial color={0x2d3331} roughness={0.94} />
        </mesh>
      ))}
    </group>
  );
}

export function BoardSurface({ animate, shadows }: { animate: boolean; shadows: boolean }) {
  return (
    <>
      <BoardFoundation castShadow={false} />
      <StoneSlabs castShadow={shadows} />
      <WetPatches />
      <River animate={animate} />
      <BoardLines castShadow={false} />
      <RiverInscription position={[-2.42, 0.485, 0]} text="楚  河" />
      <RiverInscription position={[2.42, 0.485, 0]} text="漢  界" />
    </>
  );
}
