"""Build the Russian atlas from the original data and authored translation parts."""
import copy
import csv
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOPICS = {
    "education": "Образование", "work": "Работа", "technology": "Технологии",
    "science": "Наука", "environment": "Окружающая среда", "health": "Здоровье",
    "society": "Общество", "government": "Государство и право", "economy": "Экономика",
    "media": "СМИ", "arts": "Искусство", "travel": "Путешествия", "city": "Город",
    "nature": "Природа", "daily": "Повседневная жизнь", "emotion": "Эмоции",
    "thinking": "Мышление", "sport": "Спорт", "history": "История",
}
POS = {
    "n.": "сущ.", "v.": "гл.", "adj.": "прил.", "adv.": "нареч.",
    "prep.": "предл.", "pron.": "мест.", "conj.": "союз", "det.": "опред.",
    "num.": "числ.", "int.": "межд.", "phr.": "выраж.",
}
HAN = re.compile(r"[\u3400-\u9fff]")


def merge_entry(source, translation):
    if translation.get("id") != source["id"]:
        raise ValueError(f"Translation ID mismatch: {source['id']}")
    for field in ("senses", "ex", "col"):
        values = translation.get(field)
        if not isinstance(values, list) or len(values) != len(source[field]):
            raise ValueError(f"Translation count mismatch: {source['id']}.{field}")
        if any(not isinstance(value, str) or not value.strip() for value in values):
            raise ValueError(f"Empty translation: {source['id']}.{field}")
    for field in ("tip", "note"):
        value = translation.get(field)
        if not isinstance(value, str) or (source[field] and not value.strip()):
            raise ValueError(f"Missing translation: {source['id']}.{field}")
    if HAN.search(json.dumps(translation, ensure_ascii=False)):
        raise ValueError(f"Untranslated Chinese: {source['id']}")

    entry = copy.deepcopy(source)
    for field in ("senses", "ex"):
        for original, russian in zip(entry[field], translation[field]):
            del original["zh"]
            original["ru"] = russian.strip()
    for sense in entry["senses"]:
        sense["pos"] = POS[sense["pos"]]
    entry["col"] = [
        re.split(r"[｜|]", original, maxsplit=1)[0].strip() + "｜" + russian.strip()
        for original, russian in zip(source["col"], translation["col"])
    ]
    entry["fam"] = [re.sub(r"\b(?:n|v|adj|adv|prep|pron|conj|det|num|int|phr)\.", lambda m: POS[m[0]], word) for word in entry["fam"]]
    # The original glutinous article has a Chinese synonym in an English-only list.
    if entry["id"] == "glutinous":
        entry["syn"] = ["viscous" if HAN.search(word) else word for word in entry["syn"]]
    entry["tip"] = translation["tip"].strip()
    entry["note"] = translation["note"].strip()
    if HAN.search(json.dumps(entry, ensure_ascii=False)):
        raise ValueError(f"Untranslated field: {source['id']}")
    return entry


def merge_parts(source, directory):
    translations = {}
    for part in sorted(directory.glob("part-*.jsonl")):
        for line in part.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            translation = json.loads(line)
            word_id = translation["id"]
            if word_id in translations:
                raise ValueError(f"Duplicate translation: {word_id}")
            translations[word_id] = translation
    expected = {entry["id"] for entry in source}
    if set(translations) != expected:
        missing, extra = expected - translations.keys(), translations.keys() - expected
        raise ValueError(f"Incomplete Russian atlas: {len(missing)} missing, {len(extra)} unexpected IDs")
    return [merge_entry(entry, translations[entry["id"]]) for entry in source]


def write_json(path, value, pretty=False):
    text = json.dumps(value, ensure_ascii=False, indent=1 if pretty else None, separators=None if pretty else (",", ":")) + "\n"
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def main():
    data, public = ROOT / "data", ROOT / "public/atlas"
    source = json.loads((data / "word-atlas.json").read_text())
    entries = merge_parts(source, data / "ru")
    index = json.loads((public / "index.json").read_text())
    if [entry["id"] for entry in entries] != [row[0] for row in index["words"]]:
        raise ValueError("Index order changed; preserve IDs/order to retain learning progress and media")
    for entry, row in zip(entries, index["words"]):
        first = entry["senses"][0]
        row[2] = f"{first['pos']} {first['ru']}"
        row[7:] = ["; ".join(sense["ru"] for sense in entry["senses"])]
    index.update(locale="ru-RU", version=2, name="Word Atlas — Атлас слов")
    index["fields"][2] = "ru"
    index["fields"][7:] = ["search"]
    index["topics"] = [[key, TOPICS[key]] for key, _ in index["topics"]]

    write_json(data / "word-atlas.ru.json", entries, pretty=True)
    with (data / "word-atlas.ru.csv").open("w", encoding="utf-8-sig", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(["id", "word", "ipa_uk", "ipa_us", "cefr", "topic", "topic_ru", "meanings_ru", "definition_en", "example1_en", "example1_ru", "example2_en", "example2_ru", "collocations", "word_family", "synonyms", "antonyms", "tip_ru", "note_ru"])
        for entry in entries:
            examples = entry["ex"] + [{"en": "", "ru": ""}] * (2 - len(entry["ex"]))
            writer.writerow([entry["id"], entry["w"], entry["uk"], entry["us"], entry["cefr"], entry["topic"], TOPICS[entry["topic"]], " | ".join(f"{sense['pos']} {sense['ru']}" for sense in entry["senses"]), " | ".join(sense["en"] for sense in entry["senses"]), examples[0]["en"], examples[0]["ru"], examples[1]["en"], examples[1]["ru"], " ; ".join(entry["col"]), " ; ".join(entry["fam"]), ", ".join(entry["syn"]), ", ".join(entry["ant"]), entry["tip"], entry["note"]])
    revision = hashlib.sha256()
    for start in range(0, len(entries), index["chunk"]):
        chunk = [dict(entry, m=index["words"][start + i][6]) for i, entry in enumerate(entries[start:start + index["chunk"]])]
        path = public / "entries" / f"{start // index['chunk']}.json"
        write_json(path, chunk)
        revision.update(path.read_bytes())
    index["rev"] = revision.hexdigest()
    write_json(public / "index.json", index)
    print(f"Russian atlas: {len(entries)} entries, {sum(len(entry['ex']) for entry in entries)} examples")


if __name__ == "__main__":
    main()
