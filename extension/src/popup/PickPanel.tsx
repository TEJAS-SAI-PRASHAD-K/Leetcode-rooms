import React, { useEffect, useMemo, useState } from "react";
import type { BrowseProblem, Difficulty, WarningCode } from "@lcr/shared";
import { QUICK_TOPICS } from "@lcr/shared";
import { api, ApiError } from "../lib/api.js";
import { Banner, Chip, DifficultyTag, Spinner, WarningList } from "./components.js";

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];

/**
 * The curator's pick screen.
 *
 * Blocked problems stay visible but disabled with the reason attached. Hiding
 * them would leave the curator wondering why a problem they remember is gone,
 * and the reason ("used 12 days ago by Sam") is the useful part.
 */
export function PickPanel({
  roomId,
  problemsPerRound,
  onPicked,
}: {
  roomId: string;
  problemsPerRound: number;
  onPicked: () => void;
}) {
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [problems, setProblems] = useState<BrowseProblem[] | null>(null);
  const [selected, setSelected] = useState<BrowseProblem[]>([]);
  const [acked, setAcked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSlugs = useMemo(() => selected.map((p) => p.slug), [selected]);

  useEffect(() => {
    let cancelled = false;
    setProblems(null);
    const t = setTimeout(() => {
      api
        .browse(roomId, { query, difficulty, tags: topics, selected: selectedSlugs })
        .then((r) => !cancelled && setProblems(r.problems))
        .catch((e) => !cancelled && setError((e as Error).message));
    }, 250); // debounce typing
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // selectedSlugs is intentionally excluded: re-fetching on every selection
    // would reshuffle the list under the curator's cursor mid-pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, query, difficulty, topics]);

  const needsAck = useMemo(
    () => selected.some((p) => p.verdict.warnings.some((w) => w.code === "repeat_old")),
    [selected],
  );

  const complete = selected.length === problemsPerRound;

  function toggle(p: BrowseProblem) {
    setError(null);
    setSelected((cur) => {
      if (cur.some((x) => x.slug === p.slug)) return cur.filter((x) => x.slug !== p.slug);
      if (cur.length >= problemsPerRound) {
        // Replace the oldest rather than silently ignoring the click, which
        // would feel broken once the set is full.
        return [...cur.slice(1), p];
      }
      return [...cur, p];
    });
  }

  async function submit() {
    if (!complete) return;
    setSubmitting(true);
    setError(null);

    const acknowledge: WarningCode[] = needsAck && acked ? ["repeat_old"] : [];
    try {
      const res = await api.pick(roomId, { slugs: selectedSlugs, acknowledge });
      if (res.ok) {
        onPicked();
        return;
      }
      setError(res.verdict.blocked?.message ?? "That pick was refused.");
    } catch (e) {
      const err = e as ApiError;
      const verdict = (err.body as { verdict?: BrowseProblem["verdict"] } | undefined)?.verdict;
      setError(verdict?.blocked?.message ?? err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search problems…"
        className="w-full rounded bg-neutral-900 px-2 py-1.5 text-[13px] outline-none ring-1 ring-neutral-800 focus:ring-brand/60"
      />

      <div className="flex flex-wrap gap-1">
        {DIFFICULTIES.map((d) => (
          <Chip
            key={d}
            active={difficulty.includes(d)}
            onClick={() =>
              setDifficulty((cur) =>
                cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d],
              )
            }
          >
            {d}
          </Chip>
        ))}
      </div>

      {/* Topic shortcuts, ordered by how common each tag is in the catalog. */}
      <div>
        <div className="mb-1 flex items-center justify-between px-0.5">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">
            Topics
          </span>
          {topics.length > 0 && (
            <button
              onClick={() => setTopics([])}
              className="text-[10px] text-neutral-500 hover:text-neutral-300"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto pr-0.5">
          {QUICK_TOPICS.map((t) => (
            <Chip
              key={t.slug}
              active={topics.includes(t.slug)}
              onClick={() =>
                setTopics((cur) =>
                  cur.includes(t.slug)
                    ? cur.filter((x) => x !== t.slug)
                    : [...cur, t.slug],
                )
              }
            >
              {t.label}
            </Chip>
          ))}
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {problems === null ? (
        <Spinner label="Loading problems…" />
      ) : problems.length === 0 ? (
        <Banner>No problems matched. Try a different search or topic.</Banner>
      ) : (
        <div className="max-h-44 space-y-0.5 overflow-y-auto pr-0.5">
          {problems.map((p) => {
            const blocked = p.verdict.blocked;
            const isRevisit = p.verdict.warnings.some((w) => w.code === "repeat_old");
            const isSelected = selectedSlugs.includes(p.slug);

            return (
              <button
                key={p.slug}
                disabled={!!blocked && !isSelected}
                title={blocked?.message ?? undefined}
                onClick={() => toggle(p)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                  blocked && !isSelected
                    ? "cursor-not-allowed opacity-40"
                    : isSelected
                      ? "bg-brand/15 ring-1 ring-brand/40"
                      : "hover:bg-neutral-900"
                }`}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[9px] ${
                    isSelected ? "bg-brand text-neutral-950" : "ring-1 ring-neutral-700"
                  }`}
                >
                  {isSelected ? "✓" : ""}
                </span>
                <span className="w-7 shrink-0 text-[11px] text-neutral-500">
                  {p.frontendId}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                {isRevisit && !blocked && (
                  <span className="shrink-0 rounded bg-medium/15 px-1 py-0.5 text-[10px] text-medium">
                    Revisit
                  </span>
                )}
                {blocked && !isSelected && (
                  <span className="shrink-0 rounded bg-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400">
                    Used recently
                  </span>
                )}
                <DifficultyTag difficulty={p.difficulty} />
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-2 border-t border-neutral-800 pt-2.5">
        <div className="flex items-center justify-between text-[12px]">
          <span className="text-neutral-400">
            Selected {selected.length} of {problemsPerRound}
          </span>
          {selected.length > 0 && (
            <button
              onClick={() => setSelected([])}
              className="text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              Clear
            </button>
          )}
        </div>

        {selected.length > 0 && (
          <ol className="space-y-0.5">
            {selected.map((p, i) => (
              <li key={p.slug} className="flex items-center gap-2 text-[12px]">
                <span className="w-3 shrink-0 text-neutral-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <DifficultyTag difficulty={p.difficulty} />
                <button
                  onClick={() => toggle(p)}
                  className="shrink-0 px-1 text-neutral-500 hover:text-hard"
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}

        <WarningList
          warnings={selected.flatMap((p) => p.verdict.warnings)}
          needsAck={needsAck}
          acked={acked}
          onToggleAck={setAcked}
        />

        <button
          onClick={submit}
          disabled={submitting || !complete || (needsAck && !acked)}
          className="w-full rounded bg-brand py-1.5 font-medium text-neutral-950 transition hover:bg-brand-dim disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-400"
        >
          {submitting
            ? "Setting…"
            : complete
              ? `Set ${problemsPerRound === 1 ? "today's problem" : `today's ${problemsPerRound} problems`}`
              : `Pick ${problemsPerRound - selected.length} more`}
        </button>
      </div>
    </div>
  );
}
