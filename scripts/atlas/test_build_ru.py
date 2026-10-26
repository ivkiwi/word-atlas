import copy
import json
import tempfile
import unittest
from pathlib import Path

from build_ru import merge_entry, merge_parts


class RussianAtlasTest(unittest.TestCase):
    def setUp(self):
        self.source = {"id": "library", "w": "library", "uk": "/ipa/", "us": "/ipa/", "senses": [{"pos": "n.", "zh": "图书馆", "en": "A place to borrow books."}], "ex": [{"en": "I borrowed a book.", "zh": "我借了一本书。"}], "col": ["library card｜借书证"], "fam": ["librarian (n.)"], "syn": [], "ant": [], "tip": "借书", "note": "", "cefr": "A1", "topic": "education"}
        self.translation = {"id": "library", "senses": ["библиотека"], "ex": ["Я взял книгу в библиотеке."], "col": ["читательский билет"], "tip": "library — библиотека, bookshop — книжный магазин.", "note": ""}

    def test_merges_only_translated_fields_and_preserves_source(self):
        original = copy.deepcopy(self.source)
        result = merge_entry(self.source, self.translation)
        self.assertEqual(self.source, original)
        self.assertEqual(result["senses"], [{"pos": "сущ.", "en": "A place to borrow books.", "ru": "библиотека"}])
        self.assertEqual(result["ex"][0]["en"], original["ex"][0]["en"])
        self.assertEqual(result["col"], ["library card｜читательский билет"])
        self.assertEqual(result["fam"], ["librarian (сущ.)"])
        self.assertEqual(result["tip"], self.translation["tip"])

    def test_rejects_missing_senses_wrong_ids_and_untranslated_chinese(self):
        for patch in ({"id": "wrong"}, {"senses": []}, {"ex": [""]}, {"tip": ""}, {"col": ["借书证"]}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                merge_entry(self.source, {**self.translation, **patch})

    def test_parts_must_cover_every_source_id_exactly_once(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            with self.assertRaisesRegex(ValueError, "1 missing"):
                merge_parts([self.source], directory)
            part = directory / "part-01.jsonl"
            part.write_text(json.dumps(self.translation, ensure_ascii=False) + "\n", encoding="utf-8")
            self.assertEqual(merge_parts([self.source], directory)[0]["id"], "library")
            part.write_text(part.read_text() * 2, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                merge_parts([self.source], directory)


if __name__ == "__main__":
    unittest.main()
