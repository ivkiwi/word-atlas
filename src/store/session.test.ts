import assert from "node:assert/strict";
import { test } from "node:test";
import type { Atlas, WordRef } from "../atlas/types";
import { distractors } from "./session";

const ref = (id: string, ru: string, order: number): WordRef => ({ id, word: id, ru, order, ipa: "", cefr: 2, topic: 0, media: 15 });

test("meaning options exclude the answer's Russian meaning across case and punctuation", () => {
  const words = [
    ref("extraordinary", "прил. выдающийся; необыкновенный", 0),
    ref("remarkable", "прил. Выдающийся; примечательный; поразительный", 1),
    ref("notable", "прил. выдающийся.", 2),
    ref("ordinary", "прил. обычный", 3),
    ref("simple", "прил. простой", 4),
    ref("difficult", "прил. сложный", 5),
  ];
  const atlas = { words } as Atlas;
  assert.deepEqual(new Set(distractors(atlas, words[0], "meaning", 2)), new Set(["extraordinary", "ordinary", "simple", "difficult"]));
});

test("meaning distractors with the same primary translation appear only once", () => {
  const words = [ref("fast", "прил. быстрый", 0), ref("simple", "прил. простой", 1), ref("easy", "прил. Простой.", 2), ref("slow", "прил. медленный", 3), ref("heavy", "прил. тяжёлый", 4)];
  const choices = distractors({ words } as Atlas, words[0], "meaning", 7);
  assert.equal(choices.length, 4);
  assert.equal(choices.filter((id) => id === "simple" || id === "easy").length, 1);
});
