import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("./Galaxy.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const key = "word-atlas:galaxy-hello";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(sfx = true) {
  const saved = new Map<string, string>();
  const timers = new Map<number, () => unknown>();
  const effects: (() => void | (() => void))[] = [];
  const settings = { sfx };
  const state = { settings, progress: { cards: {} } };
  let calls = 0;
  let resolve!: (result: string) => void;
  const spoken = new Promise<string>((done) => { resolve = done; });
  let timerId = 0;
  const clearTimeout = (id: number) => timers.delete(id);
  const exports = {} as typeof import("./Galaxy");
  const modules: Record<string, unknown> = {
    react: {
      useEffect: (effect: () => void | (() => void)) => effects.push(effect), useMemo: (fn: () => unknown) => fn(),
      useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, () => {}],
    },
    "react/jsx-runtime": { jsx() {}, jsxs() {} },
    "../atlas/context": { useAtlas: () => ({ topics: [], words: [] }) },
    "../config": { VOICE_LINES: true },
    "../store/store": { useStore: (select: (state: unknown) => unknown) => select(state), store: { get: () => state } },
    "../lib/audio": { play: () => { calls++; return spoken; } },
    "./layout": { layoutGalaxy: () => ({ n: 0, ids: [], index: new Map() }) },
  };
  runInNewContext(source, {
    exports, require: (id: string) => modules[id] ?? {}, clearTimeout,
    localStorage: { getItem: (name: string) => saved.get(name) ?? null, setItem: (name: string, value: string) => saved.set(name, value) },
    window: { clearTimeout, setTimeout: (callback: () => unknown) => { timers.set(++timerId, callback); return timerId; } },
  });
  exports.Galaxy({});
  const cleanups = effects.map((effect) => effect());
  const fire = () => { for (const [id, callback] of timers) { timers.delete(id); void callback(); } };
  return { saved, settings, fire, resolve, calls: () => calls, cleanup: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

for (const result of ["device", "recorded", "unsupported", "stopped"]) test(`galaxy greeting is remembered only after successful playback (${result})`, async () => {
  const { saved, fire, resolve, calls, cleanup } = setup();
  assert.equal(saved.has(key), false, "mounting must not consume the greeting");
  fire();
  assert.equal(calls(), 1);
  assert.equal(saved.has(key), false, "starting playback must not consume the greeting");
  resolve(result);
  await tick();
  assert.equal(saved.has(key), result === "device" || result === "recorded");
  cleanup();
});

test("disabled sound leaves the galaxy greeting available for a later visit", () => {
  const { saved, fire, calls, cleanup } = setup(false);
  fire();
  assert.equal(calls(), 0);
  assert.equal(saved.has(key), false);
  cleanup();
});

test("unmounting before the greeting timer does not consume the greeting", () => {
  const { saved, fire, calls, cleanup } = setup();
  cleanup();
  fire();
  assert.equal(calls(), 0);
  assert.equal(saved.has(key), false);
});
