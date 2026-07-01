export const keys: Record<string, boolean> = {};

globalThis.addEventListener("keydown", (e) => keys[e.key] = true);
globalThis.addEventListener("keyup", (e) => keys[e.key] = false);
