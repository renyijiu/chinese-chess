"use client";

import { useLoader, useThree } from "@react-three/fiber";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { WebGLRenderer } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

const BASIS_TRANSCODER_PATH = "/basis/";
type ConfigureLoader = (loader: GLTFLoader) => void;

const PieceLoaderContext = createContext<ConfigureLoader | null>(null);

function createKtx2Loader(gl: WebGLRenderer) {
  const loader = new KTX2Loader();
  loader.setTranscoderPath(BASIS_TRANSCODER_PATH);
  // This must happen after R3F has created and initialized its renderer.
  // GLTFLoader will reject KTX2 payloads if support detection was skipped.
  loader.detectSupport(gl);
  return loader;
}

export function PieceAssetLoaderProvider({ children }: { children: ReactNode }) {
  const gl = useThree((state) => state.gl);
  const ktx2Loader = useMemo(() => createKtx2Loader(gl), [gl]);
  const configureLoader = useMemo<ConfigureLoader>(
    () => (loader) => {
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.setKTX2Loader(ktx2Loader);
    },
    [ktx2Loader],
  );

  useEffect(() => () => ktx2Loader.dispose(), [ktx2Loader]);

  return (
    <PieceLoaderContext.Provider value={configureLoader}>{children}</PieceLoaderContext.Provider>
  );
}

/**
 * Loads both today's texture-free GLBs and future Meshopt/KTX2 piece builds.
 * Preloading is deliberately deferred until a renderer exists, because KTX2
 * capability detection cannot be performed safely at module evaluation time.
 */
export function usePieceAsset(url: string): GLTF {
  const configureLoader = useContext(PieceLoaderContext);
  if (!configureLoader) {
    throw new Error("usePieceAsset must be used within PieceAssetLoaderProvider");
  }
  return useLoader(GLTFLoader, url, configureLoader);
}
