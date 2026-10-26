import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useAtlas } from "../atlas/context";
import { store } from "../store/store";

const LEVELS = [
  ["A2", "Базовый", "Хочу увереннее владеть повседневными словами"],
  ["B1", "Средний", "Цель IELTS: 5,5–6 баллов"],
  ["B2", "Выше среднего", "Цель IELTS: 6,5–7 баллов"],
  ["C1", "Продвинутый", "Цель IELTS: от 7,5 балла"],
];

export function Onboarding() {
  const atlas = useAtlas();
  const [level, setLevel] = useState(1);
  const [goal, setGoal] = useState(10);
  const finish = () => store.settings({ onboarded: true, startLevel: atlas.cefr.indexOf(LEVELS[level][0]), dailyNew: goal });
  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-label="Добро пожаловать">
      <div className="onboard-card">
        <img className="onboard-art" src={`${import.meta.env.BASE_URL}brand/hero.webp`} alt="" />
        <div className="onboard-body">
          <p className="eyebrow">Добро пожаловать в Word Atlas</p>
          <h1 className="display">
            {atlas.count.toLocaleString("ru-RU")} звёзд.
            <br />
            Открывайте их по одной.
          </h1>
          <fieldset>
            <legend>С какого уровня начнём?</legend>
            <div className="choice-grid">
              {LEVELS.map(([code, name, desc], i) => (
                <button key={code} className={`choice ${level === i ? "is-on" : ""}`} onClick={() => setLevel(i)} aria-pressed={level === i}>
                  <span className={`chip chip-level lv-${code}`}>{code}</span>
                  <b>{name}</b>
                  <small>{desc}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Сколько новых слов в день?</legend>
            <div className="segmented segmented-wide">
              {[5, 10, 15, 20].map((n) => (
                <button key={n} className={goal === n ? "is-on" : ""} onClick={() => setGoal(n)} aria-pressed={goal === n}>
                  {n}{n === 10 ? " · советуем" : ""}
                </button>
              ))}
            </div>
          </fieldset>
          <button className="btn btn-primary btn-xl" onClick={finish}>
            Начать <ArrowRight size={20} />
          </button>
          <p className="muted">Регистрация не нужна. Прогресс хранится на этом устройстве. Настройки можно изменить в разделе «Мой прогресс».</p>
        </div>
      </div>
    </div>
  );
}
