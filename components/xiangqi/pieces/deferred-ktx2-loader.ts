import { Loader, type CompressedTexture } from "three";
import type { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

export type Ktx2TextureLoader = Pick<KTX2Loader, "dispose" | "load">;

/**
 * Stands in for KTX2Loader on a GLTFLoader and creates the real one only when a
 * GLB references a KTX2 texture. Today's pieces are texture-free, so the loader
 * and its Zstandard decoder stay out of the initial bundle until an asset needs them.
 */
export class DeferredKtx2Loader extends Loader<CompressedTexture> {
  private loader: Promise<Ktx2TextureLoader> | null = null;

  constructor(private readonly createLoader: () => Promise<Ktx2TextureLoader>) {
    super();
  }

  override load(
    url: string,
    onLoad: (texture: CompressedTexture) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    const pending = (this.loader ??= this.createLoader());
    pending.then(
      (loader) => loader.load(url, onLoad, onProgress, onError),
      (error: unknown) => {
        // Let a later texture retry instead of reusing a failed download.
        if (this.loader === pending) this.loader = null;
        onError?.(error);
      },
    );
  }

  /** GLTFLoader types its texture loader as KTX2Loader but only calls `load` on it. */
  asKtx2Loader(): KTX2Loader {
    return this as unknown as KTX2Loader;
  }

  dispose(): void {
    const pending = this.loader;
    this.loader = null;
    pending?.then(
      (loader) => loader.dispose(),
      () => undefined,
    );
  }
}
