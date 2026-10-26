import { useEffect, useRef, useState } from "react";
import { playFile, preloadFiles } from "../lib/sound";
import { play } from "../lib/audio";
import { dayKey, store } from "../store/store";
import { Mark } from "./Logo";

const SEEN_KEY = "word-atlas:splash";

export function shouldShowSplash() {
  if (!store.get().settings.splash) return false;
  const h = location.hash.replace(/^#\/?/, "");
  if (h && !h.startsWith("?")) return false;
  try {
    return localStorage.getItem(SEEN_KEY) !== dayKey();
  } catch {
    return true;
  }
}

export function Splash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"ready" | "open">("ready");
  const opening = useRef(false);
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    preloadFiles(["splash-door.mp3", "splash-burst.mp3"]);
  }, []);

  const open = (sound = true) => {
    if (opening.current) return;
    opening.current = true;
    try {
      localStorage.setItem(SEEN_KEY, dayKey());
    } catch {
      /* optional */
    }
    if (sound && store.get().settings.sfx) {
      void playFile("splash-burst.mp3", 0.55);
      void playFile("splash-door.mp3", 0.6, 0.12);
      void play(null, "Добро пожаловать в Атлас слов.", "ru");
    }
    setPhase("open");
    window.setTimeout(onDone, reduce ? 300 : 1900);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Tab") return;
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      open(e.key !== "Escape");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`splash is-${phase} ${reduce ? "is-reduced" : ""}`} onClick={() => open()} role="dialog" aria-modal="true" aria-labelledby="splash-title" aria-describedby="splash-subtitle">
      <div className="door door-l" />
      <div className="door door-r" />
      <div className="splash-light" />
      <div className="splash-static">
        <Mark size={88} />
        <h1 id="splash-title">Атлас слов</h1>
        <p id="splash-subtitle">Английские слова в картинках</p>
        <button className="splash-enter">Открыть атлас</button>
      </div>
      <button
        className="splash-skip"
        onClick={(e) => {
          e.stopPropagation();
          open(false);
        }}
      >
        Пропустить
      </button>
    </div>
  );
}
