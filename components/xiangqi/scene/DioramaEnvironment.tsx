"use client";

/* eslint-disable react/no-unknown-property -- R3F scene graph props are valid custom JSX properties. */

import { useTexture } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import { useScheduledFrame } from "../runtime/FrameScheduler";
import type { QualityProfile } from "../runtime/quality";
import {
  getDioramaPropPlacements,
  getPanoramaUrl,
  resolveEnvironmentStatus,
  type DioramaPropKind,
  type DioramaPropPlacement,
  type EnvironmentLayerStatus,
  type EnvironmentStatus,
} from "./diorama-environment";
import { QIN_DIORAMA_THEME } from "./scene-theme";

type LayerBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  layer: string;
};

class EnvironmentLayerBoundary extends Component<LayerBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.warn(`Optional Qin diorama layer degraded: ${this.props.layer}`, error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function LayerStatusSignal({
  onStatus,
  status,
}: {
  onStatus: (status: EnvironmentLayerStatus) => void;
  status: EnvironmentLayerStatus;
}) {
  useEffect(() => onStatus(status), [onStatus, status]);
  return null;
}

function QinGradientSky() {
  const uniforms = useMemo(() => ({
    bottomColor: { value: new THREE.Color(QIN_DIORAMA_THEME.environment.fog) },
    topColor: { value: new THREE.Color(QIN_DIORAMA_THEME.environment.background) },
  }), []);
  return (
    <mesh
      frustumCulled={false}
      name="qin-theme-gradient-fallback"
      raycast={() => null}
      renderOrder={-2000}
    >
      <sphereGeometry args={[78, 32, 18]} />
      <shaderMaterial
        depthWrite={false}
        fog={false}
        fragmentShader={`
          uniform vec3 bottomColor;
          uniform vec3 topColor;
          varying vec3 vWorldPosition;
          void main() {
            float heightMix = smoothstep(-12.0, 32.0, vWorldPosition.y);
            gl_FragColor = vec4(mix(bottomColor, topColor, heightMix), 1.0);
          }
        `}
        side={THREE.BackSide}
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
      />
    </mesh>
  );
}

function QinSceneAtmosphere() {
  const getThree = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    const scene = getThree().scene;
    const previousBackground = scene.background;
    const previousFog = scene.fog;
    const background = new THREE.Color(QIN_DIORAMA_THEME.environment.background);
    const fog = new THREE.FogExp2(QIN_DIORAMA_THEME.environment.fog, 0.017);
    scene.background = background;
    scene.fog = fog;
    invalidate();
    return () => {
      if (scene.background === background) scene.background = previousBackground;
      if (scene.fog === fog) scene.fog = previousFog;
    };
  }, [getThree, invalidate]);
  return <QinGradientSky />;
}

function QinPanorama({
  onStatus,
  url,
}: {
  onStatus: (status: EnvironmentLayerStatus) => void;
  url: string;
}) {
  const texture = useTexture(url);
  const invalidate = useThree((state) => state.invalidate);
  const panorama = useMemo(() => {
    const prepared = texture.clone();
    prepared.colorSpace = THREE.SRGBColorSpace;
    prepared.mapping = THREE.UVMapping;
    prepared.minFilter = THREE.LinearMipmapLinearFilter;
    prepared.magFilter = THREE.LinearFilter;
    prepared.needsUpdate = true;
    return prepared;
  }, [texture]);

  useEffect(() => {
    onStatus("ready");
    invalidate();
    return () => {
      panorama.dispose();
      invalidate();
    };
  }, [invalidate, onStatus, panorama]);
  return (
    <mesh frustumCulled={false} name="qin-diorama-panorama" raycast={() => null} renderOrder={-1000}>
      <sphereGeometry args={[76, 48, 24]} />
      <meshBasicMaterial depthWrite={false} fog={false} map={panorama} side={THREE.BackSide} />
    </mesh>
  );
}

type StaticPropKind = "wall" | "pit-corridor" | "mound" | "tent";

function makePropGeometry(kind: StaticPropKind) {
  if (kind === "wall" || kind === "pit-corridor") {
    return new RoundedBoxGeometry(1, 1, 1, 2, kind === "wall" ? 0.16 : 0.09);
  }
  if (kind === "mound") {
    return new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  }
  if (kind === "tent") return new THREE.ConeGeometry(1, 1, 4, 1);
  return new THREE.BoxGeometry(1, 1, 1);
}

function StaticPropInstances({
  castShadow,
  kind,
  placements,
}: {
  castShadow: boolean;
  kind: StaticPropKind;
  placements: readonly DioramaPropPlacement[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => makePropGeometry(kind), [kind]);

  useLayoutEffect(() => {
    writeMatrices(meshRef.current, placements, (transform, placement) => {
      transform.position.set(...placement.position);
      transform.rotation.set(0, placement.rotation, 0);
      transform.scale.set(...placement.scale);
    });
  }, [placements]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  const color = kind === "pit-corridor"
    ? QIN_DIORAMA_THEME.materials.firedClayShadow
    : kind === "mound"
      ? QIN_DIORAMA_THEME.materials.firedClay
      : QIN_DIORAMA_THEME.materials.firedClayLight;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, placements.length]}
      castShadow={castShadow}
      name={`qin-diorama-${kind}s`}
      raycast={() => null}
      receiveShadow
    >
      <meshStandardMaterial color={color} metalness={0.01} roughness={0.9} />
    </instancedMesh>
  );
}

function writeMatrices<T>(
  mesh: THREE.InstancedMesh | null,
  placements: readonly T[],
  transformPlacement: (target: THREE.Object3D, placement: T, index: number) => void,
  transform = new THREE.Object3D(),
) {
  if (!mesh) return;
  placements.forEach((placement, index) => {
    transformPlacement(transform, placement, index);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function GateDetails({ placements }: { placements: readonly DioramaPropPlacement[] }) {
  const parts = useMemo(() => placements.flatMap((placement) => {
    const [x, y, z] = placement.position;
    const [width, height, depth] = placement.scale;
    return [
      { position: [x - width * 0.38, y + height * 0.38, z] as const, scale: [width * 0.17, height, depth] as const },
      { position: [x + width * 0.38, y + height * 0.38, z] as const, scale: [width * 0.17, height, depth] as const },
      { position: [x, y + height * 0.78, z] as const, scale: [width, height * 0.18, depth * 1.2] as const },
    ];
  }), [placements]);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    writeMatrices(meshRef.current, parts, (transform, part) => {
      transform.position.set(...part.position);
      transform.scale.set(...part.scale);
    });
  }, [parts]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, parts.length]} name="qin-gate-cues" raycast={() => null}>
      <boxGeometry />
      <meshStandardMaterial color={QIN_DIORAMA_THEME.materials.blackLacquer} roughness={0.78} />
    </instancedMesh>
  );
}

function CampDetails({
  animateFlags,
  animateLights,
  dynamicLightStrategy,
  placements,
}: {
  animateFlags: boolean;
  animateLights: boolean;
  dynamicLightStrategy: QualityProfile["environment"]["dynamicLightStrategy"];
  placements: readonly DioramaPropPlacement[];
}) {
  const flames = useMemo(() => placements.filter((placement) => placement.kind === "brazier"), [placements]);
  const banners = useMemo(() => placements.filter((placement) => placement.kind === "banner"), [placements]);
  const racks = useMemo(() => placements.filter((placement) => placement.kind === "weapon-rack"), [placements]);
  const brazierRef = useRef<THREE.InstancedMesh>(null);
  const flameRef = useRef<THREE.InstancedMesh>(null);
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const flagRef = useRef<THREE.InstancedMesh>(null);
  const lightGroupRef = useRef<THREE.Group>(null);
  const matrixTransform = useMemo(() => new THREE.Object3D(), []);

  const updateFlames = useCallback((elapsed: number) => {
    writeMatrices(flameRef.current, flames, (transform, placement, index) => {
      const pulse = 1 + Math.sin(elapsed * 5.1 + index * 1.7) * 0.09;
      transform.position.set(placement.position[0], placement.position[1] + 0.52, placement.position[2]);
      transform.rotation.set(0, elapsed * 0.35 + index, 0);
      transform.scale.set(0.17 / pulse, 0.58 * pulse, 0.17 / pulse);
    }, matrixTransform);
  }, [flames, matrixTransform]);
  const updateFlags = useCallback((elapsed: number) => {
    writeMatrices(flagRef.current, banners, (transform, placement, index) => {
      const flutter = Math.sin(elapsed * 1.35 + index * 2.1) * 0.08;
      transform.position.set(placement.position[0] + 0.36, placement.position[1] + 1.65, placement.position[2]);
      transform.rotation.set(0, placement.rotation + flutter, 0);
      transform.scale.set(0.72, 1.08, 0.05);
    }, matrixTransform);
  }, [banners, matrixTransform]);

  useLayoutEffect(() => {
    writeMatrices(brazierRef.current, flames, (transform, placement) => {
      transform.position.set(placement.position[0], placement.position[1] + 0.19, placement.position[2]);
      transform.scale.set(1, 1, 1);
    });
    writeMatrices(poleRef.current, banners, (transform, placement) => {
      transform.position.set(placement.position[0], placement.position[1] + 1.32, placement.position[2]);
      transform.rotation.set(0, placement.rotation, 0);
      transform.scale.set(1, 1, 1);
    });
    updateFlames(0);
    updateFlags(0);
  }, [banners, flames, updateFlags, updateFlames]);
  useScheduledFrame(updateFlames, animateLights && flames.length > 0);
  useScheduledFrame(updateFlags, animateFlags && banners.length > 0);
  useScheduledFrame((elapsed) => {
    lightGroupRef.current?.children.forEach((child, index) => {
      if (child instanceof THREE.PointLight) child.intensity = 10 + Math.sin(elapsed * 4.4 + index * 1.8) * 1.8;
    });
  }, animateLights && dynamicLightStrategy === "animated");

  return (
    <group name="qin-diorama-camp-details">
      {flames.length > 0 ? (
        <>
          <instancedMesh ref={brazierRef} args={[undefined, undefined, flames.length]} raycast={() => null}>
            <cylinderGeometry args={[0.19, 0.27, 0.42, 8]} />
            <meshStandardMaterial color={QIN_DIORAMA_THEME.materials.blackLacquer} metalness={0.22} roughness={0.68} />
          </instancedMesh>
          <instancedMesh ref={flameRef} args={[undefined, undefined, flames.length]} raycast={() => null}>
            <coneGeometry args={[1, 1, 7]} />
            <meshBasicMaterial color={0xffa247} toneMapped={false} />
          </instancedMesh>
          {dynamicLightStrategy !== "none" ? (
            <group ref={lightGroupRef}>
              {flames.slice(0, 2).map((placement, index) => (
                <pointLight key={`${placement.position.join(":")}:${index}`} color={0xff9a55} decay={2} distance={4.4} intensity={10} position={[placement.position[0], 1.25, placement.position[2]]} />
              ))}
            </group>
          ) : null}
        </>
      ) : null}
      {banners.length > 0 ? (
        <>
          <instancedMesh ref={poleRef} args={[undefined, undefined, banners.length]} raycast={() => null}>
            <cylinderGeometry args={[0.035, 0.055, 3.1, 7]} />
            <meshStandardMaterial color={QIN_DIORAMA_THEME.materials.agedBronze} metalness={0.26} roughness={0.67} />
          </instancedMesh>
          <instancedMesh ref={flagRef} args={[undefined, undefined, banners.length]} raycast={() => null}>
            <boxGeometry />
            <meshStandardMaterial color={QIN_DIORAMA_THEME.accents.cinnabar} roughness={0.9} />
          </instancedMesh>
        </>
      ) : null}
      {racks.map((placement, index) => (
        <group key={`${placement.position.join(":")}:${index}`} position={placement.position} rotation={[0, placement.rotation, 0]}>
          <mesh raycast={() => null} position={[0, 0.5, 0]}>
            <boxGeometry args={[1.1, 0.1, 0.1]} />
            <meshStandardMaterial color={QIN_DIORAMA_THEME.materials.agedBronze} roughness={0.72} />
          </mesh>
          {[-0.42, 0, 0.42].map((x) => (
            <mesh key={x} raycast={() => null} position={[x, 0.72, 0]} rotation={[0, 0, x === 0 ? 0 : x * 0.28]}>
              <cylinderGeometry args={[0.025, 0.035, 1.4, 6]} />
              <meshStandardMaterial color={QIN_DIORAMA_THEME.materials.blackLacquer} metalness={0.12} roughness={0.68} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function DustMotes({ animate, density }: { animate: boolean; density: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const values = new Float32Array(density * 3);
    for (let index = 0; index < density; index += 1) {
      const angle = index * 2.399963;
      const radius = 7.2 + (index % 11) * 0.42;
      values[index * 3] = Math.cos(angle) * radius;
      values[index * 3 + 1] = 0.8 + (index % 9) * 0.31;
      values[index * 3 + 2] = Math.sin(angle) * radius;
    }
    return values;
  }, [density]);

  useScheduledFrame((elapsed) => {
    const points = pointsRef.current;
    if (!points) return;
    points.rotation.y = elapsed * 0.018;
    points.position.y = Math.sin(elapsed * 0.24) * 0.08;
  }, animate && density > 0);

  if (density === 0) return null;
  return (
    <points ref={pointsRef} raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color={QIN_DIORAMA_THEME.materials.chalk} depthWrite={false} opacity={0.2} size={0.045} transparent />
    </points>
  );
}

function DioramaPropLayer({
  animate,
  onStatus,
  quality,
}: {
  animate: boolean;
  onStatus: (status: EnvironmentLayerStatus) => void;
  quality: QualityProfile;
}) {
  const placements = useMemo(
    () => getDioramaPropPlacements(quality.environment.detailLevel),
    [quality.environment.detailLevel],
  );
  const byKind = useMemo(() => {
    const grouped = new Map<DioramaPropKind, DioramaPropPlacement[]>();
    placements.forEach((placement) => {
      const group = grouped.get(placement.kind) ?? [];
      group.push(placement);
      grouped.set(placement.kind, group);
    });
    return grouped;
  }, [placements]);
  const castShadow = quality.environment.shadowStrategy !== "none";

  useEffect(() => onStatus("ready"), [onStatus]);
  return (
    <group name={`qin-diorama-props-detail-${quality.environment.detailLevel}`}>
      {(["wall", "pit-corridor", "mound", "tent"] as const).map((kind) => {
        const kindPlacements = byKind.get(kind) ?? [];
        return kindPlacements.length > 0 ? (
          <StaticPropInstances key={kind} castShadow={castShadow} kind={kind} placements={kindPlacements} />
        ) : null;
      })}
      <GateDetails placements={byKind.get("gate") ?? []} />
      <CampDetails
        animateFlags={animate && quality.environment.motion.flags}
        animateLights={animate && quality.environment.motion.dynamicLightUpdates}
        dynamicLightStrategy={quality.environment.dynamicLightStrategy}
        placements={placements}
      />
      <DustMotes
        animate={animate && quality.environment.motion.dust}
        density={quality.environment.motion.dust ? quality.environment.detailLevel * 12 : 0}
      />
    </group>
  );
}

export function DioramaEnvironment({
  animate,
  onStatusChange,
  quality,
}: {
  animate: boolean;
  onStatusChange?: (status: EnvironmentStatus) => void;
  quality: QualityProfile;
}) {
  const panoramaUrl = getPanoramaUrl(quality.environment.panorama);
  const [panoramaStatus, setPanoramaStatus] = useState<EnvironmentLayerStatus>("loading");
  const [propStatus, setPropStatus] = useState<EnvironmentLayerStatus>("loading");
  const status = resolveEnvironmentStatus([panoramaStatus, propStatus]);

  useEffect(() => onStatusChange?.(status), [onStatusChange, status]);
  return (
    <>
      <QinSceneAtmosphere />
      <hemisphereLight args={[QIN_DIORAMA_THEME.environment.keyLight, QIN_DIORAMA_THEME.environment.background, 2.7]} />
      <directionalLight
        castShadow={quality.environment.shadowStrategy !== "none"}
        color={QIN_DIORAMA_THEME.environment.keyLight}
        intensity={3.4}
        position={[-9, 15, 8]}
        shadow-bias={-0.0004}
        shadow-camera-bottom={-13}
        shadow-camera-far={44}
        shadow-camera-left={-13}
        shadow-camera-near={1}
        shadow-camera-right={13}
        shadow-camera-top={13}
        shadow-mapSize-height={quality.shadowMapSize}
        shadow-mapSize-width={quality.shadowMapSize}
      />
      <directionalLight color={QIN_DIORAMA_THEME.environment.fillLight} intensity={1.1} position={[10, 7, -10]} />

      <EnvironmentLayerBoundary
        fallback={<LayerStatusSignal onStatus={setPanoramaStatus} status="degraded" />}
        layer="panorama"
      >
        <Suspense fallback={<LayerStatusSignal onStatus={setPanoramaStatus} status="loading" />}>
          <QinPanorama onStatus={setPanoramaStatus} url={panoramaUrl} />
        </Suspense>
      </EnvironmentLayerBoundary>
      <group name="qin-hybrid-diorama-environment">
        <EnvironmentLayerBoundary
          fallback={<LayerStatusSignal onStatus={setPropStatus} status="degraded" />}
          layer="props"
        >
          <DioramaPropLayer animate={animate} onStatus={setPropStatus} quality={quality} />
        </EnvironmentLayerBoundary>
      </group>
    </>
  );
}
