import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Atlas, Entry } from "../atlas/types";
import type { ActiveSession } from "../store/store";

for (const path of ["./share.ts", "./shareSession.ts", "../galaxy/share.ts"]) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const result of ["NotAllowedError", "AbortError", "success", "unsupported"]) test(`${path}: native share ${result}`, async () => {
    const downloads: string[] = [];
    const toasts: string[] = [];
    const ctx = new Proxy({ measureText: () => ({ width: 1 }), createLinearGradient: () => ({ addColorStop() {} }) }, { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
    const canvas = { width: 300, height: 150, getContext: () => ctx, toBlob: (callback: (b: Blob) => void) => callback(new Blob(["png"])) };
    const exports = {} as typeof import("./share") & typeof import("./shareSession") & typeof import("../galaxy/share");
    runInNewContext(source, {
      exports, Blob, File, DOMException,
      require: (id: string) => id.endsWith("/Toast") ? { toast: (text: string) => toasts.push(text) } : id.endsWith("/srs") ? { Rating: { Again: 1 } } : { sessionStats: () => ({ accuracy: 100 }) },
      document: { fonts: { load: async () => [] }, createElement: (tag: string) => tag === "canvas" ? canvas : { download: "", click() { downloads.push(this.download); } } },
      URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, setTimeout() {},
      navigator: { canShare: () => result !== "unsupported", share: async () => { if (result !== "success") throw new DOMException("share failed", result); } },
    });
    const atlas = { img: () => null, byId: new Map() } as unknown as Atlas;
    if (exports.shareWord) await exports.shareWord(atlas, { id: "test", w: "test", senses: [{ pos: "n.", ru: "тест" }], ex: [] } as unknown as Entry);
    if (exports.shareSession) await exports.shareSession(atlas, { steps: [], graded: {}, newIds: [], reviewIds: [] } as unknown as ActiveSession);
    if (exports.shareGalaxy) await exports.shareGalaxy(canvas as unknown as HTMLCanvasElement, 1, 1);
    const fallback = result === "NotAllowedError" || result === "unsupported";
    assert.equal(downloads.length, fallback ? 1 : 0);
    assert.equal(toasts.length, fallback ? 1 : 0);
    if (fallback) assert.match(toasts[0], /сохранена/);
  });
}
