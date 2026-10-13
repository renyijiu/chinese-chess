import { CompressedTexture } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DeferredKtx2Loader,
  type Ktx2TextureLoader,
} from "../../../components/xiangqi/pieces/deferred-ktx2-loader";

const TEXTURE_FREE_GLTF = { asset: { version: "2.0" } };
const KTX2_GLTF = {
  asset: { version: "2.0" },
  extensionsRequired: ["KHR_texture_basisu"],
  extensionsUsed: ["KHR_texture_basisu"],
  images: [{ uri: "piece-albedo.ktx2" }],
  textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
};

function parse(loader: GLTFLoader, gltf: object): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.parse(JSON.stringify(gltf), "/models/pieces/v1/", resolve, reject);
  });
}

function fakeKtx2Loader() {
  const texture = new CompressedTexture([], 4, 4);
  const loader = {
    dispose: vi.fn(),
    load: vi.fn<Ktx2TextureLoader["load"]>((_url, onLoad) => onLoad(texture)),
  };
  return { loader, texture };
}

describe("deferred KTX2 loader", () => {
  beforeEach(() => {
    // GLTFLoader reads `self.URL` while resolving image sources.
    vi.stubGlobal("self", globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never creates the KTX2 loader for a texture-free GLB", async () => {
    const createLoader = vi.fn(async () => fakeKtx2Loader().loader);
    const deferred = new DeferredKtx2Loader(createLoader);
    await parse(new GLTFLoader().setKTX2Loader(deferred.asKtx2Loader()), TEXTURE_FREE_GLTF);
    deferred.dispose();
    expect(createLoader).not.toHaveBeenCalled();
  });

  it("creates the KTX2 loader once when GLTFLoader meets a KTX2 texture", async () => {
    const { loader, texture } = fakeKtx2Loader();
    const createLoader = vi.fn(async () => loader);
    const deferred = new DeferredKtx2Loader(createLoader);
    const gltfLoader = new GLTFLoader().setKTX2Loader(deferred.asKtx2Loader());

    const first = await parse(gltfLoader, KTX2_GLTF);
    await expect(first.parser.getDependency("texture", 0)).resolves.toBe(texture);
    const second = await parse(gltfLoader, KTX2_GLTF);
    await expect(second.parser.getDependency("texture", 0)).resolves.toBe(texture);

    expect(createLoader).toHaveBeenCalledTimes(1);
    expect(loader.load).toHaveBeenCalledTimes(2);
    expect(loader.load.mock.calls[0]?.[0]).toBe("/models/pieces/v1/piece-albedo.ktx2");

    deferred.dispose();
    await vi.waitFor(() => expect(loader.dispose).toHaveBeenCalledTimes(1));
  });

  it("reports a failed loader download and retries on the next texture", async () => {
    const { loader, texture } = fakeKtx2Loader();
    const createLoader = vi
      .fn<() => Promise<Ktx2TextureLoader>>()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce(loader);
    const deferred = new DeferredKtx2Loader(createLoader);

    await expect(deferred.loadAsync("first.ktx2")).rejects.toThrow("chunk unavailable");
    await expect(deferred.loadAsync("second.ktx2")).resolves.toBe(texture);
    expect(createLoader).toHaveBeenCalledTimes(2);
  });
});
