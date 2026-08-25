export type XiangqiTestFault = "ambientTask" | "riverRender";

declare global {
  interface Window {
    __XIANGQI_TEST_FAULTS__?: Partial<Record<XiangqiTestFault, boolean>>;
  }
}

/** Development-only fault injection used by browser resilience coverage. */
export function isTestFaultEnabled(fault: XiangqiTestFault) {
  return process.env.NODE_ENV !== "production"
    && typeof window !== "undefined"
    && window.__XIANGQI_TEST_FAULTS__?.[fault] === true;
}
