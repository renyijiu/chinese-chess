export type EnvironmentDiagnostics = Readonly<{
  activePanoramaUrls: readonly string[];
  disposedPanoramaCount: number;
}>;

declare global {
  interface Window {
    __XIANGQI_ENVIRONMENT_DIAGNOSTICS__?: EnvironmentDiagnostics;
  }
}

const activePanoramaUrls = new Set<string>();
let disposedPanoramaCount = 0;

function publish() {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return;
  window.__XIANGQI_ENVIRONMENT_DIAGNOSTICS__ = Object.freeze({
    activePanoramaUrls: Object.freeze([...activePanoramaUrls].sort()),
    disposedPanoramaCount,
  });
}

export function markPanoramaActive(url: string) {
  if (process.env.NODE_ENV === "production") return;
  activePanoramaUrls.add(url);
  publish();
}

export function markPanoramaDisposed(url: string) {
  if (process.env.NODE_ENV === "production") return;
  activePanoramaUrls.delete(url);
  disposedPanoramaCount += 1;
  publish();
}
