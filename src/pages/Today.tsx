import { ArrowRight, Flame, Keyboard, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { prefetch, useAtlas, useEntry } from "../atlas/context";
import { go, openWord } from "../lib/router";
import { cue } from "../lib/sound";
import { hashSeed, plural } from "../lib/text";
import { buildSession, masteredCount, todayPlan } from "../store/session";
import { isMastered } from "../store/srs";
import { dayKey, store, useStore } from "../store/store";
import { Galaxy } from "../galaxy/Galaxy";
import { Highlight, Pronounce } from "../ui/EntryView";
import { Illustration } from "../ui/Illustration";
import { Ring } from "../ui/Ring";

const BRAND = `${import.meta.env.BASE_URL}brand`;

function greeting(h: number) {
  if (h < 5) return "Доброй ночи";
  if (h < 11) return "Доброе утро";
  if (h < 14) return "Добрый день";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

export function streakOf(days: Record<string, { r: number }>) {
  let n = 0;
  const d = new Date();
  if (!(days[dayKey(d)]?.r > 0)) d.setDate(d.getDate() - 1);
  while (days[dayKey(d)]?.r > 0) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function Today() {
  const atlas = useAtlas();
  const progress = useStore((s) => s.progress);
  const settings = useStore((s) => s.settings);
  const [time, setTime] = useState(Date.now);
  const plan = useMemo(() => todayPlan(atlas, progress, settings), [atlas, progress, settings, time]);
  useEffect(() => {
    const refresh = () => setTime(Date.now());
    const now = Date.now();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const next = Object.values(progress.cards).reduce((at, c) => c.due > now ? Math.min(at, c.due) : at, midnight.getTime());
    const timer = window.setTimeout(refresh, Math.max(1, next - now));
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [progress.cards, time]);
  // Warm the first cards of today's journey so the session opens instantly.
  const firstIds = [...plan.due.slice(0, 4), ...plan.fresh.slice(0, 6)].join(",");
  useEffect(() => {
    const ids = firstIds.split(",").filter(Boolean);
    const t = window.setTimeout(() => void prefetch(atlas, ids), 800);
    return () => window.clearTimeout(t);
  }, [atlas, firstIds]);
  const now = new Date();
  const today = progress.days[dayKey()];
  const streak = streakOf(progress.days);
  const active = progress.session && !progress.session.finished ? progress.session : null;
  const total = plan.due.length + plan.fresh.length;
  const goal = settings.dailyNew + Math.min(plan.due.length, 60);
  const doneToday = today?.r ?? 0;

  const start = (opts?: { reviewOnly?: boolean; extra?: number }) => {
    if (!active) {
      const s = buildSession(atlas, progress, opts?.extra ? { ...settings, dailyNew: (today?.n ?? 0) + opts.extra } : settings, { reviewOnly: opts?.reviewOnly });
      if (!s.steps.length) return;
      store.progress((p) => ({ ...p, session: s }));
    }
    if (settings.sfx) void cue("start");
    go({ page: "learn" });
  };

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const k = dayKey(d);
    return { k, label: d.toLocaleDateString("ru-RU", { weekday: "short" }), v: progress.days[k]?.r ?? 0, today: i === 6 };
  });

  const learned = Object.keys(progress.cards).length;
  const mastered = masteredCount(progress);
  const teaser = (active ? active.newIds : plan.fresh).slice(0, 5).map((id) => atlas.byId.get(id)!).filter(Boolean);

  return (
    <div className="page today">
      <header className="greet">
        <p className="eyebrow">
          {now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" })}
        </p>
        <h1 className="display">{greeting(now.getHours())}, исследователь!</h1>
      </header>

      <section className={`journey ${total === 0 && !active ? "is-clear" : ""}`}>
        <img className="journey-art" src={`${BRAND}/hero.webp`} alt="" fetchPriority="high" />
        <div className="journey-body">
          {active ? (
            <>
              <p className="eyebrow eyebrow-light">Занятие продолжается</p>
              <h2>
                Осталось шагов: <b>{active.steps.length - active.index}</b>
              </h2>
              <p className="journey-lede">Прогресс сохранён. Продолжайте, когда удобно.</p>
            </>
          ) : total > 0 ? (
            <>
              <p className="eyebrow eyebrow-light">План на сегодня</p>
              <h2>
                {plan.due.length > 0 && (
                  <>
                    Повторим <b>{plural(plan.due.length, "слово", "слова", "слов")}</b>
                  </>
                )}
                {plan.due.length > 0 && plan.fresh.length > 0 && <i> · </i>}
                {plan.fresh.length > 0 && (
                  <>
                    Изучим <b>{plural(plan.fresh.length, "новое слово", "новых слова", "новых слов")}</b>
                  </>
                )}
              </h2>
              <p className="journey-lede">Около {plural(plan.minutes, "минуты", "минут", "минут")}. Сначала повторим знакомое, затем изучим новое.</p>
            </>
          ) : (
            <>
              <p className="eyebrow eyebrow-light">На сегодня всё</p>
              <h2>Все звёзды на сегодня зажглись.</h2>
              <p className="journey-lede">Памяти полезен отдых. Но можно открыть ещё несколько слов.</p>
            </>
          )}
          {teaser.length > 0 && (
            <div className="teaser" aria-label="Новые слова на сегодня">
              {teaser.map((w, i) => (
                <Illustration key={w.id} src={atlas.img(w, "thumb")} word={w.word} topic={w.topic} className={`teaser-${i}`} />
              ))}
              <span>Сегодня познакомимся с ними</span>
            </div>
          )}
          <div className="journey-actions">
            {active || total > 0 ? (
              <button className="btn btn-primary btn-xl" onClick={() => start()}>
                {active ? "Продолжить занятие" : "Начать занятие"} <ArrowRight size={20} />
              </button>
            ) : (
              <button className="btn btn-primary btn-xl" onClick={() => start({ extra: 5 })}>
                Ещё 5 новых слов <Sparkles size={18} />
              </button>
            )}
            {!active && plan.due.length > 0 && plan.fresh.length > 0 && (
              <button className="btn btn-glass" onClick={() => start({ reviewOnly: true })}>
                Только повторение
              </button>
            )}
            {!active && total === 0 && (
              <button className="btn btn-glass" onClick={() => go({ page: "practice" })}>
                <Keyboard size={18} /> Практика печати
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="today-grid">
        <WordOfDay />

        <section className="panel streak-panel">
          <div className="panel-head">
            <h3 className="eyebrow">На этой неделе</h3>
            <span className={`streak ${streak ? "is-on" : ""}`}>
              <Flame size={16} /> {plural(streak, "день", "дня", "дней")} подряд
            </span>
          </div>
          <div className="streak-body">
            <Ring value={goal ? doneToday / goal : 0} size={112} stroke={8} tone="terra">
              <b>{doneToday}</b>
              <small>Ответов сегодня</small>
            </Ring>
            <ol className="week">
              {week.map((d) => (
                <li key={d.k} className={`${d.v ? "is-on" : ""} ${d.today ? "is-today" : ""}`} title={`${d.k}: ${plural(d.v, "ответ", "ответа", "ответов")}`}>
                  <span style={{ "--h": Math.min(1, d.v / 40) } as React.CSSProperties} />
                  <small>{d.label}</small>
                </li>
              ))}
            </ol>
          </div>
          <dl className="mini-stats">
            <div>
              <dt>Открыто</dt>
              <dd>{learned.toLocaleString("ru-RU")}</dd>
            </div>
            <div>
              <dt>Освоено</dt>
              <dd>{mastered.toLocaleString("ru-RU")}</dd>
            </div>
            <div>
              <dt>Всего слов</dt>
              <dd>{atlas.count.toLocaleString("ru-RU")}</dd>
            </div>
          </dl>
        </section>

        <LevelPath />
        <GalaxyPanel learned={learned} total={atlas.count} />
        <Topics />
      </div>
    </div>
  );
}

function GalaxyPanel({ learned, total }: { learned: number; total: number }) {
  const today = useStore((s) => s.progress.days[dayKey()]);
  const ids = useStore((s) => s.progress.cards);
  const todayIds = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Object.entries(ids)
      .filter(([, c]) => c.seen >= start.getTime())
      .map(([id]) => id);
  }, [ids]);
  void today;
  return (
    <section className="galaxy-panel" onClick={() => go({ page: "atlas", view: "galaxy" })} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && go({ page: "atlas", view: "galaxy" })}>
      <Galaxy mode="mini" highlight={todayIds} />
      <div className="galaxy-panel-copy">
        <p className="eyebrow eyebrow-light">Ваша звёздная карта слов</p>
        <h3>
          Открыто звёзд: <b>{learned.toLocaleString("ru-RU")}</b>
        </h3>
        <p>{learned ? `На очереди — ещё ${plural(total - learned, "звезда", "звезды", "звёзд")}. Золотым отмечены открытые сегодня.` : `${plural(total, "слово", "слова", "слов")} — целая вселенная. Изучите слово, чтобы зажечь звезду.`}</p>
        <span className="btn btn-glass">
          Открыть карту <ArrowRight size={18} />
        </span>
      </div>
    </section>
  );
}

function WordOfDay() {
  const atlas = useAtlas();
  const pick = useMemo(() => {
    const pool = atlas.words.filter((w) => w.cefr >= 2 && w.media & 1);
    const list = pool.length ? pool : atlas.words;
    return list[hashSeed(dayKey()) % list.length];
  }, [atlas]);
  const { entry } = useEntry(pick?.id);
  if (!pick) return null;
  return (
    <section className="panel wotd" onClick={() => openWord(pick.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && openWord(pick.id)} aria-label={`Слово дня：${pick.word}`}>
      <Illustration src={atlas.img(pick)} word={pick.word} topic={pick.topic} className="wotd-art" />
      <div className="wotd-body">
        <h3 className="eyebrow">Слово дня</h3>
        <p className="wotd-word" lang="en">
          {pick.word}
        </p>
        {entry && (
          <div onClick={(e) => e.stopPropagation()}>
            <Pronounce entry={entry} refw={pick} />
          </div>
        )}
        <p className="wotd-ru">{pick.ru}</p>
        {entry?.ex[0] && (
          <p className="wotd-ex" lang="en">
            <Highlight text={entry.ex[0].en} word={entry.w} />
          </p>
        )}
      </div>
    </section>
  );
}

function LevelPath() {
  const atlas = useAtlas();
  const cards = useStore((s) => s.progress.cards);
  const start = useStore((s) => s.settings.startLevel);
  const levels = useMemo(() => {
    const out = atlas.cefr.map((name) => ({ name, total: 0, seen: 0, mastered: 0 }));
    for (const w of atlas.words) {
      const l = out[w.cefr];
      l.total++;
      const c = cards[w.id];
      if (c) {
        l.seen++;
        if (isMastered(c)) l.mastered++;
      }
    }
    return out;
  }, [atlas, cards]);
  const NAMES = ["Начальный", "Базовый", "Средний", "Выше среднего", "Продвинутый", "Свободное владение"];
  return (
    <section className="panel path-panel">
      <div className="panel-head">
        <h3 className="eyebrow">Путь изучения: от A1 до C2</h3>
        <span className="legend">
          <i className="lg-seen" /> Изучено <i className="lg-done" /> Освоено
        </span>
      </div>
      <ol className="route">
        {levels.map((l, i) => {
          const seen = l.seen / Math.max(1, l.total);
          const done = l.mastered / Math.max(1, l.total);
          return (
            <li key={l.name} className={`${i === start ? "is-start" : ""} ${l.seen ? "is-on" : ""}`}>
              <button onClick={() => go({ page: "atlas", level: l.name })} aria-label={`${l.name}: ${NAMES[i]}, изучено ${l.seen} из ${l.total}`}>
                <span className="station" style={{ "--seen": seen, "--done": done } as React.CSSProperties}>
                  <b>{l.name}</b>
                </span>
                <span className="station-name">{NAMES[i]}</span>
                <span className="station-count">
                  {l.seen}
                  <small>/{l.total}</small>
                </span>
                {i === start && <span className="station-flag">Старт</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Topics() {
  const atlas = useAtlas();
  const counts = useMemo(() => {
    const c = new Array(atlas.topics.length).fill(0);
    atlas.words.forEach((w) => c[w.topic]++);
    return c;
  }, [atlas]);
  return (
    <section className="topics-panel">
      <div className="panel-head">
        <h3 className="eyebrow">Темы IELTS</h3>
        <button className="link" onClick={() => go({ page: "atlas" })}>
          Открыть атлас
        </button>
      </div>
      <ul className="topic-tiles">
        {atlas.topics.map(([key, name], i) => (
          <li key={key}>
            <button onClick={() => go({ page: "atlas", topic: key })}>
              <img src={`${BRAND}/topic-${key}.webp`} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
              <span>
                <b>{name}</b>
                <small>{plural(counts[i], "слово", "слова", "слов")}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
