import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("./audio.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(voices: { lang: string; name: string }[] = []) {
  const ducks: boolean[] = [];
  const sounds: Audio[] = [];
  const spoken: Utterance[] = [];
  class Audio {
    onended: (() => void) | null = null;
    onpause: (() => void) | null = null;
    onerror: (() => void) | null = null;
    playbackRate = 1;
    constructor(public url: string) { sounds.push(this); }
    play() { return Promise.resolve(); }
    pause() { this.onpause?.(); }
  }
  class Utterance {
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    lang = "";
    rate = 1;
    voice?: { lang: string; name: string };
    constructor(public text: string) {}
  }
  const speechSynthesis = { getVoices: () => voices, speak: (u: Utterance) => spoken.push(u), cancel() {} };
  const exports = {} as typeof import("./audio");
  runInNewContext(source, { exports, require: () => ({ duck: (on: boolean) => ducks.push(on) }), window: { speechSynthesis }, speechSynthesis, SpeechSynthesisUtterance: Utterance, Audio });
  return { audio: exports, sounds, spoken, ducks, Audio };
}

test("a recording error after play starts falls back to TTS and releases duck", async () => {
  const { audio, sounds, spoken, ducks } = setup();
  const result = audio.play("broken.mp3", "word");
  await tick();
  sounds[0].onerror?.();
  await tick();
  assert.equal(spoken.length, 1);
  assert.equal(ducks.at(-1), true);
  spoken[0].onend?.();
  assert.equal(await result, "device");
  assert.equal(ducks.at(-1), false);
  assert.equal(sounds[0].onerror, null);
});

test("stopping the old recording cannot unduck the new recording", async () => {
  const { audio, sounds, ducks } = setup();
  const first = audio.play("first.mp3", "first");
  await tick();
  const second = audio.play("second.mp3", "second");
  await tick();
  await first;
  assert.equal(ducks.at(-1), true);
  sounds[1].onended?.();
  assert.equal(await second, "recorded");
  assert.equal(ducks.at(-1), false);
});

test("stop settles playback even while Audio.play is pending", async () => {
  const { audio, Audio, ducks, spoken } = setup();
  let reject!: (reason: Error) => void;
  Audio.prototype.play = () => new Promise<void>((_, fail) => { reject = fail; });
  let settled = false;
  const result = audio.play("loading.mp3", "loading").then((value) => { settled = true; return value; });
  audio.stopAudio();
  await tick();
  assert.equal(settled, true);
  assert.equal(await result, "stopped");
  reject(new Error("late network error"));
  await tick();
  assert.equal(spoken.length, 0);
  assert.equal(ducks.at(-1), false);
});

test("stop settles cancelled TTS even if the browser emits no end event", async () => {
  const { audio, ducks } = setup();
  let settled = false;
  const result = audio.play(null, "word").then((value) => { settled = true; return value; });
  audio.stopAudio();
  await tick();
  assert.equal(settled, true);
  assert.equal(await result, "stopped");
  assert.equal(ducks.at(-1), false);
});

test("Russian voice lines stay silent when only an English voice is available", async () => {
  const { audio, spoken, ducks } = setup([{ lang: "en-US", name: "English" }]);
  const result = audio.play(null, "Добро пожаловать", "ru");
  await tick();
  assert.equal(spoken.length, 0);
  assert.equal(await result, "unsupported");
  assert.equal(ducks.at(-1), false);
});

test("Russian voice lines select an available Russian voice", async () => {
  const ru = { lang: "ru_RU", name: "Russian" };
  const { audio, spoken } = setup([{ lang: "en-US", name: "English" }, ru]);
  const result = audio.play(null, "Добро пожаловать", "ru");
  assert.equal(spoken[0].voice, ru);
  spoken[0].onend?.();
  assert.equal(await result, "device");
});

test("English TTS still uses the device default without a matching voice", async () => {
  const { audio, spoken } = setup();
  const result = audio.play(null, "word", "uk", 0.7);
  assert.equal(spoken[0].lang, "en-GB");
  assert.equal(spoken[0].rate, 0.7 * 0.95);
  spoken[0].onend?.();
  assert.equal(await result, "device");
});
