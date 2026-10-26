import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WordRef } from "../atlas/types";
import { searchAtlas } from "../atlas/search";
import { useAtlas } from "../atlas/context";
import { openWord } from "../lib/router";
import { Illustration } from "./Illustration";

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const atlas = useAtlas();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchAtlas(atlas, q, 30), [atlas, q]);
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);
  useEffect(() => setSel(0), [q]);
  if (!open) return null;
  const pick = (w: WordRef) => {
    onClose();
    openWord(w.id);
  };
  return (
    <div className="palette-root" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Найти слово">
        <label className="palette-input">
          <Search size={20} />
          <input
            ref={input}
            value={q}
            placeholder="Поиск: serendipity / природа"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              }
              if (e.key === "Enter" && results[sel]) pick(results[sel]);
            }}
            aria-controls="palette-list"
            aria-activedescendant={results[sel] ? `pal-${results[sel].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </label>
        <ul id="palette-list" className="palette-list" role="listbox">
          {results.map((w, i) => (
            <li
              key={w.id}
              id={`pal-${w.id}`}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? "is-sel" : ""}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(w)}
            >
              <Illustration src={atlas.img(w, "thumb")} word={w.word} topic={w.topic} className="palette-thumb" />
              <span className="palette-word" lang="en">
                {w.word}
              </span>
              <span className="palette-ru">{w.ru}</span>
              {i === sel && <CornerDownLeft size={15} className="palette-enter" />}
            </li>
          ))}
          {q && !results.length && <li className="palette-empty">Ничего не найдено: «{q}»</li>}
          {!q && (
            <li className="palette-hint">
              {atlas.count.toLocaleString("ru-RU")} слов · Поиск по английскому слову и русскому переводу · <kbd>↑</kbd>
              <kbd>↓</kbd> выбрать <kbd>↵</kbd> открыть
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
