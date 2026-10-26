import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("./sound.ts", import.meta.url), "utf8").replace("import.meta.env.BASE_URL", '"/"'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function setup() {
  const requests: { file: string; resolve: (value: unknown) => void; reject: (reason: Error) => void }[] = [];
  const started: unknown[] = [];
  class AudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createGain() { return { connect() {}, gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } }; }
    createBufferSource() {
      return { buffer: null, connect(g: unknown) { return g; }, start() { started.push(this.buffer); }, stop() {} };
    }
    async decodeAudioData(b: unknown) { return b; }
  }
  const exports = {} as typeof import("./sound");
  runInNewContext(source, {
    exports, window: { AudioContext },
    fetch: (file: string) => new Promise((resolve, reject) => requests.push({ file, resolve, reject })),
  });
  const load = (i: number) => requests[i].resolve({ ok: true, arrayBuffer: async () => ({ duration: 10, file: requests[i].file }) });
  return { sound: exports, requests, started, load };
}

test("silence cancels an ambience that is still loading", async () => {
  const { sound, load, started } = setup();
  const rain = sound.setAmbience("rain");
  await sound.setAmbience(null);
  load(0);
  await rain;
  assert.equal(sound.ambienceId(), null);
  assert.equal(started.length, 0);
});

for (const order of [[0, 1], [1, 0]]) test(`last ambience wins when loads finish ${order}`, async () => {
  const { sound, load, started } = setup();
  const pending = [sound.setAmbience("rain"), sound.setAmbience("sea")];
  for (const i of order) { load(i); await pending[i]; }
  assert.equal(sound.ambienceId(), "sea");
  assert.equal(started.length, 1);
});

test("failed sound loads are retried on the next request", async () => {
  const { sound, requests, load, started } = setup();
  const failed = sound.setAmbience("rain");
  requests[0].reject(new Error("offline"));
  await failed;
  const retry = sound.setAmbience("rain");
  assert.equal(requests.length, 2);
  load(1);
  await retry;
  assert.equal(sound.ambienceId(), "rain");
  assert.equal(started.length, 1);
});

test("concurrent requests share a successful sound buffer", async () => {
  const { sound, requests, load, started } = setup();
  const pending = [sound.cue("tap"), sound.cue("tap")];
  assert.equal(requests.length, 1);
  load(0);
  await Promise.all(pending);
  await sound.cue("tap");
  assert.equal(requests.length, 1);
  assert.equal(started.length, 3);
});
