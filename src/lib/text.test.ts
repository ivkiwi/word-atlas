import assert from "node:assert/strict";
import { test } from "node:test";
import { gap, hashSeed, normalize, plural, shuffle, splitHighlight, splitPair } from "./text";

test("highlights the headword and common inflections", () => {
  assert.deepEqual(splitHighlight("Training with a friend motivates me.", "motivate")?.[1], "motivates");
  assert.deepEqual(splitHighlight("She studied hard.", "study")?.[1], "studied");
  assert.deepEqual(splitHighlight("We got a day off today.", "day off")?.[1], "day off");
  assert.equal(splitHighlight("Nothing here.", "salt"), null);
});

test("does not match inside longer unrelated words", () => {
  assert.equal(splitHighlight("The cartoon was funny.", "art"), null);
});

test("gaps the sentence for cloze questions", () => {
  const g = gap("I refused the extra money as a matter of principle.", "principle");
  assert.equal(g?.hidden, "principle");
  assert.equal(g?.after, ".");
});

test("normalizes typography from mobile keyboards", () => {
  assert.equal(normalize("  Don’t  "), "don't");
  assert.deepEqual(splitPair("in principle｜в принципе"), { en: "in principle", ru: "в принципе" });
});

test("Russian counts distinguish one, few, many and teen endings", () => {
  for (const [count, expected] of [[0, "0 слов"], [1, "1 слово"], [2, "2 слова"], [5, "5 слов"], [11, "11 слов"], [21, "21 слово"], [22, "22 слова"], [111, "111 слов"], [1.5, "1,5 слова"]] as const) {
    assert.equal(plural(count, "слово", "слова", "слов"), expected);
  }
});

test("shuffle distributes every answer evenly across four positions", () => {
  const counts = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const values = [0, 1, 2, 3];
  for (let seed = 0; seed < 40000; seed++) {
    shuffle(values, hashSeed(String(seed))).forEach((value, position) => counts[value][position]++);
  }
  for (const row of counts) for (const count of row) assert.ok(count > 9500 && count < 10500, String(count));
  assert.deepEqual(values, [0, 1, 2, 3]);
  assert.deepEqual(shuffle(values, 42), shuffle(values, 42));
});
