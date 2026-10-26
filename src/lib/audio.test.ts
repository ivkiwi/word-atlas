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
  const listeners = new Set<() => void>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
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
  const speechSynthesis = {
    getVoices: () => voices, speak: (u: Utterance) => { spoken.push(u); }, cancel() {},
    addEventListener: (_name: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: () => void) => listeners.delete(listener),
  };
  const exports = {} as typeof import("./audio");
  runInNewContext(source, {
    exports, require: () => ({ duck: (on: boolean) => ducks.push(on) }), window: { speechSynthesis }, speechSynthesis, SpeechSynthesisUtterance: Utterance, Audio,
    setTimeout: (callback: () => void, delay: number) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  return { audio: exports, sounds, spoken, ducks, Audio, listeners, timers, speechSynthesis };
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

test("Russian speech waits for asynchronous voices and removes its wait handlers", async () => {
  const { audio, spoken, listeners, timers, speechSynthesis } = setup();
  const result = audio.play(null, "Добро пожаловать", "ru");
  assert.equal(listeners.size, 1);
  assert.equal(spoken.length, 0);
  listeners.forEach((listener) => listener());
  assert.equal(listeners.size, 1, "an empty voiceschanged event must not end the wait");
  const ru = { lang: "ru-RU", name: "Russian" };
  speechSynthesis.getVoices = () => [ru];
  listeners.forEach((listener) => listener());
  await tick();
  assert.equal(spoken[0].voice, ru);
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  spoken[0].onend?.();
  assert.equal(await result, "device");
});

for (const loaded of [false, true]) test(`Russian voice timeout rechecks the list (loaded=${loaded})`, async () => {
  const { audio, spoken, ducks, listeners, timers, speechSynthesis } = setup();
  const result = audio.play(null, "Добро пожаловать", "ru");
  const timer = [...timers.values()][0];
  assert.ok(timer);
  assert.equal(timer.delay, 1000);
  if (loaded) speechSynthesis.getVoices = () => [{ lang: "ru-RU", name: "Russian" }];
  timer.callback();
  await tick();
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(spoken.length, loaded ? 1 : 0);
  spoken[0]?.onend?.();
  assert.equal(await result, loaded ? "device" : "unsupported");
  assert.equal(ducks.at(-1), false);
});

test("replacing speech while waiting for voices cannot start a stale Russian line", async () => {
  const { audio, spoken, ducks, listeners, timers, speechSynthesis } = setup();
  const first = audio.play(null, "Добро пожаловать", "ru");
  const second = audio.play(null, "word", "uk");
  assert.equal(await first, "stopped");
  speechSynthesis.getVoices = () => [{ lang: "ru-RU", name: "Russian" }];
  listeners.forEach((listener) => listener());
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, "word");
  assert.equal(ducks.at(-1), true);
  spoken[0].onend?.();
  assert.equal(await second, "device");
});

for (const failure of ["event", "throw"]) test(`failed TTS is not reported as spoken (${failure})`, async () => {
  const { audio, spoken, ducks, speechSynthesis } = setup([{ lang: "ru-RU", name: "Russian" }]);
  if (failure === "throw") speechSynthesis.speak = () => { throw new Error("speech blocked"); };
  const result = audio.play(null, "Добро пожаловать", "ru");
  if (failure === "event") spoken[0].onerror?.();
  assert.equal(await result, "unsupported");
  assert.equal(ducks.at(-1), false);
});
