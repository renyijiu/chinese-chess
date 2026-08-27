export interface OnlineRuntimeConfig {
  readonly enabled: boolean;
  readonly rtcConfiguration: RTCConfiguration;
  readonly ignoredStunEntries: number;
}

const MAX_STUN_SERVERS = 8;
const MAX_STUN_URL_LENGTH = 512;

export function parseStunUrls(value: string | undefined): ReadonlyArray<string> {
  if (!value) return [];
  const unique = new Set<string>();
  for (const candidate of value.split(",")) {
    const url = candidate.trim();
    if (
      unique.size >= MAX_STUN_SERVERS
      || url.length === 0
      || url.length > MAX_STUN_URL_LENGTH
      || !url.toLowerCase().startsWith("stun:")
      || /\s/.test(url)
    ) continue;
    unique.add(url);
  }
  return [...unique];
}

export function resolveOnlineRuntimeConfig(
  enabledValue: string | undefined,
  stunValue: string | undefined,
): OnlineRuntimeConfig {
  const stunUrls = parseStunUrls(stunValue);
  const candidates = stunValue?.split(",").filter((value) => value.trim().length > 0) ?? [];
  return {
    enabled: enabledValue === "1" || enabledValue === "true",
    rtcConfiguration: { iceServers: stunUrls.length > 0 ? [{ urls: [...stunUrls] }] : [] },
    ignoredStunEntries: Math.max(0, candidates.length - stunUrls.length),
  };
}
