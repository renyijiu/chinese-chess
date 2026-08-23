export function detectWebGL2(): boolean {
  if (typeof document === "undefined") return false;

  const probe = document.createElement("canvas");
  const context = probe.getContext("webgl2");
  const available = Boolean(context);
  context?.getExtension("WEBGL_lose_context")?.loseContext();
  return available;
}
