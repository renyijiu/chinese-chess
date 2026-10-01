import type { QinAudioAssetV1 } from "./qin-audio-pack-contract";

export type MusicElement = Pick<
  HTMLAudioElement,
  | "addEventListener"
  | "removeEventListener"
  | "currentTime"
  | "duration"
  | "paused"
  | "preload"
  | "src"
  | "play"
  | "pause"
  | "load"
  | "removeAttribute"
>;

// A 10 ms silent WAV primes media playback during the same gesture as Web Audio.
const SILENCE =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Keeps the verified compressed music in the browser's media pipeline, not a full PCM buffer. */
export class StreamingMusic {
  readonly primed: Promise<void>;
  private finishPriming: (() => void) | null = null;
  private asset: QinAudioAssetV1 | null = null;
  private disposed = false;
  private objectUrl: string | null = null;
  private playbackWanted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingLoad: ((error: Error) => void) | null = null;

  constructor(
    readonly element: MusicElement,
    private readonly onFailure: () => void,
  ) {
    element.preload = "auto";
    element.addEventListener("timeupdate", this.updateLoop);
    element.addEventListener("seeked", this.updateLoop);
    element.addEventListener("ended", this.handleEnded);
    element.addEventListener("error", this.handleError);
    element.src = SILENCE;
    // Media prepares the output device asynchronously before Web Audio opens it.
    // A failed or stalled optional primer must not prevent Web Audio fallback.
    this.primed = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => this.finishPriming?.(), 1_000);
      this.finishPriming = () => {
        clearTimeout(timeout);
        this.finishPriming = null;
        resolve();
      };
      try {
        void element.play().then(
          () => this.finishPriming?.(),
          () => this.finishPriming?.(),
        );
      } catch {
        this.finishPriming?.();
      }
    });
  }

  async load(encoded: ArrayBuffer, asset: QinAudioAssetV1, signal: AbortSignal) {
    if (signal.aborted || this.disposed) throw new Error("Music loading aborted");
    this.pause();
    this.asset = asset;
    this.objectUrl = URL.createObjectURL(new Blob([encoded], { type: asset.mimeType }));
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.pendingLoad = null;
        this.element.removeEventListener("loadedmetadata", loaded);
        signal.removeEventListener("abort", aborted);
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const aborted = () => failed(new Error("Music loading aborted"));
      const loaded = () => {
        const duration = this.element.duration;
        if (
          !Number.isFinite(duration) ||
          Math.abs(duration - asset.durationSeconds) > 0.25 ||
          !asset.loop ||
          asset.loop.endSeconds > duration
        ) {
          failed(new Error("Music duration or loop range mismatch"));
          return;
        }
        this.element.currentTime = asset.loop.startSeconds;
        cleanup();
        resolve();
      };
      this.pendingLoad = failed;
      signal.addEventListener("abort", aborted, { once: true });
      this.element.addEventListener("loadedmetadata", loaded);
      this.element.src = this.objectUrl!;
      this.element.load();
    });
  }

  async play() {
    if (this.disposed) return;
    this.playbackWanted = true;
    await this.element.play();
    if (this.disposed || !this.playbackWanted) {
      this.element.pause();
      return;
    }
    this.updateLoop();
  }

  pause() {
    this.playbackWanted = false;
    this.clearTimer();
    this.element.pause();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.finishPriming?.();
    this.pendingLoad?.(new Error("Music disposed"));
    this.pause();
    this.element.removeEventListener("timeupdate", this.updateLoop);
    this.element.removeEventListener("seeked", this.updateLoop);
    this.element.removeEventListener("ended", this.handleEnded);
    this.element.removeEventListener("error", this.handleError);
    this.element.removeAttribute("src");
    this.element.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private readonly handleError = () => {
    if (!this.asset || this.disposed) return;
    if (this.pendingLoad) this.pendingLoad(new Error("Music media failed"));
    else this.onFailure();
  };

  private readonly handleEnded = () => {
    if (this.disposed || !this.playbackWanted || !this.asset?.loop) return;
    this.element.currentTime = this.asset.loop.startSeconds;
    void this.play().catch(this.onFailure);
  };

  private readonly updateLoop = () => {
    this.clearTimer();
    const loop = this.asset?.loop;
    if (!loop || this.disposed || this.element.paused) return;
    if (this.element.currentTime >= loop.endSeconds) {
      this.element.currentTime =
        loop.startSeconds +
        ((this.element.currentTime - loop.endSeconds) % (loop.endSeconds - loop.startSeconds));
    }
    this.timer = setTimeout(
      this.updateLoop,
      Math.max(20, (loop.endSeconds - this.element.currentTime) * 1_000),
    );
  };

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
