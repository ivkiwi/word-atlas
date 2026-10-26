import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import type { Atlas, IndexRow, WordRef } from "../atlas/types";
import { answer, advance, distractors } from "./session";
import { Rating } from "./srs";
import { emptyProgress, store, type Step, type QuizKind } from "./store";

const originalWindow = globalThis.window;
Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: () => 0, clearTimeout: () => {} } });
after(() => Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }));

function atlasOf(meanings: string[]) {
  const words: WordRef[] = meanings.map((ru, order) => ({ id: `w${order}`, word: `word${order}`, ru, ipa: "", cefr: 0, topic: 0, media: 0, order }));
  return { words, byId: new Map(words.map((w) => [w.id, w])) } as Atlas;
}

const overlaps = [
  ["сущ. общежитие; общая спальня", "сущ. общая спальня"],
  ["нареч. скоро; вскоре", "нареч. быстро, вскоре"],
  ["межд. эй; привет", "межд. привет"],
  ["прил. иной; другой", "мест. другой, ещё один"],
  ["прил. удивительный; потрясающий", "прил. фантастический; потрясающий"],
  ["сущ. свет; гл. зажигать", "гл. ЗАЖИГАТЬ!"],
];
for (const [left, right] of overlaps) {
  test(`distractors exclude all shared meaning segments: ${left}`, () => {
    for (const pair of [[left, right], [right, left]]) {
      const atlas = atlasOf([...pair, "сущ. стол", "гл. бежать", "прил. высокий"]);
      for (const kind of ["meaning", "picture", "listen"] as const) {
        for (let seed = 1; seed <= 20; seed++) {
          const options = distractors(atlas, atlas.words[0], kind, seed);
          assert.ok(!options.includes("w1"), `${kind}: ${options}`);
          assert.equal(options.length, 4);
          assert.ok(options.includes("w0"));
        }
      }
    }
  });
}

test("meaning distractors do not repeat each other's secondary meanings", () => {
  const atlas = atlasOf(["сущ. окно", "нареч. скоро; вскоре", "нареч. быстро; вскоре", "сущ. стол", "гл. бежать"]);
  for (let seed = 0; seed < 30; seed++) {
    const options = distractors(atlas, atlas.words[0], "meaning", seed);
    assert.ok(!(options.includes("w1") && options.includes("w2")));
    assert.equal(options.length, 4);
  }
});

for (const [targetId, otherId, shared] of [["too", "also", "тоже"], ["see", "understand", "понимать"]]) {
  test(`distractors use secondary senses from the real index: ${targetId}/${otherId}`, () => {
    const index = JSON.parse(readFileSync(new URL("../../public/atlas/index.json", import.meta.url), "utf8")) as { words: IndexRow[] };
    const words: WordRef[] = [targetId, otherId, "library", "table", "tall"].map((id, order) => {
      const row = index.words.find((r) => r[0] === id);
      assert.ok(row, id);
      return { id: row[0], word: row[1], ru: row[2], ipa: row[3], cefr: row[4], topic: row[5], media: row[6], search: row[7], order };
    });
    const atlas = { words, byId: new Map(words.map((w) => [w.id, w])) } as Atlas;
    assert.ok(!words[0].ru.includes(shared));
    assert.ok(words[0].search?.includes(shared));
    assert.ok(words[1].ru.includes(shared));
    for (let seed = 0; seed < 20; seed++) {
      const options = distractors(atlas, words[0], "meaning", seed);
      assert.ok(!options.includes(otherId), `${targetId}: ${options}`);
      assert.equal(options.length, 4);
      assert.ok(options.includes(targetId));
    }
  });
}

function sessionFixture() {
  const atlas = atlasOf(["сущ. окно", "сущ. стол", "гл. бежать", "прил. высокий"]);
  const step: Step & { kind: QuizKind } = { id: "w0", kind: "meaning", options: ["w0", "w1", "w2", "w3"] };
  store.progress(() => ({ ...emptyProgress("test"), session: { id: "test", started: Date.now(), steps: [step, { id: "w1", kind: "meaning" }], index: 0, graded: {}, newIds: ["w0"], reviewIds: [] } }));
  return { atlas, step };
}

test("answer ignores a second submit while feedback is pending", () => {
  const { atlas, step } = sessionFixture();
  answer(atlas, step, false, Rating.Again, "w1");
  const first = store.get().progress;
  answer(atlas, step, true, Rating.Good, "w0");
  assert.strictEqual(store.get().progress, first);
  answer(atlas, step, false, Rating.Again, "w2");
  assert.strictEqual(store.get().progress, first);
  assert.equal(first.session!.steps.filter((s) => "retry" in s && s.retry).length, 1);
});

test("answer ignores a step from an earlier index or a replaced session", () => {
  const { atlas, step } = sessionFixture();
  advance(1);
  const current = store.get().progress;
  answer(atlas, step, false, Rating.Again, "w1");
  assert.strictEqual(store.get().progress, current);
  sessionFixture();
  const replacement = store.get().progress;
  answer(atlas, step, false, Rating.Again, "w1");
  assert.strictEqual(store.get().progress, replacement);
});

test("a retry accepts feedback without regrading the original answer", () => {
  const { atlas, step } = sessionFixture();
  answer(atlas, step, false, Rating.Again, "w1");
  const first = store.get().progress;
  advance(1);
  advance(1);
  const retry = store.get().progress.session!.steps[2] as Step & { kind: QuizKind };
  answer(atlas, retry, true, Rating.Good, "w0");
  assert.deepEqual(store.get().progress.cards, first.cards);
  assert.deepEqual(store.get().progress.session!.graded, first.session!.graded);
  assert.deepEqual(store.get().progress.session!.pending, { correct: true, value: "w0" });
});
