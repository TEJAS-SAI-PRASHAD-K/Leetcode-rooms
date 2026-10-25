import React, { useEffect, useMemo, useState } from "react";
import type { BrowseProblem, Difficulty, WarningCode } from "@lcr/shared";
import { api, ApiError } from "../lib/api.js";
import { Banner, DifficultyTag, Spinner, WarningList } from "./components.js";

const DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard"];

/**
 * The curator's pick screen.
 *
 * Blocked problems stay visible but disabled, with the reason attached. Hiding
 * them would leave the curator wondering why a problem they remember is gone —
 * and the reason ("used 12 days ago by Sam") is the useful part.
 */
export function PickPanel({
  roomId,
  onPicked,
}: {
  roomId: string;
  onPicked: () => void;
}) {
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty[]>([]);
  const [problems, setProblems] = useState<BrowseProblem[] | null>(null);
  const [selected, setSelected] = useState<BrowseProblem | null>(null);
  const [acked, setAcked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProblems(null);
    const t = setTimeout(() => {
      api
        .browse(roomId, { query, difficulty })
        .then((r) => !cancelled && setProblems(r.problems))
        .catch((e) => !cancelled && setError((e as Error).message));
    }, 250); // debounce typing
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [roomId, query, difficulty]);

  const needsAck = useMemo(
    () => (selected?.verdict.warnings ?? []).some((w) => w.code === "repeat_old"),
    [selected],
  );

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);

    const acknowledge: WarningCode[] = needsAck && acked ? ["repeat_old"] : [];
    try {
      const res = await api.pick(roomId, { slug: selected.slug, acknowledge });
      if (res.ok) {
        onPicked();
        return;
      }
      setError(res.verdict.blocked?.message ?? "That pick was refused.");
    } catch (e) {
      const err = e as ApiError;
      // 428 means an overridable warning still needs confirming; the server
      // re-sends the verdict so the UI can show exactly what to tick.
      const verdict = (err.body as { verdict?: BrowseProblem["verdict"] } | undefined)?.verdict;
      setError(verdict?.blocked?.message ?? err.message);
      if (verdict) setSelected({ ...selected, verdict });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="space-y-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search problems…"
          className="w-full rounded bg-neutral-900 px-2 py-1.5 text-[13px] outline-none ring-1 ring-neutral-800 focus:ring-brand/60"
        />
        <div className="flex gap-1">
          {DIFFICULTIES.map((d) => {
            const on = difficulty.includes(d);
            return (
              <button
                key={d}
                onClick={() =>
                  setDifficulty((cur) =>
                    cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d],
                  )
                }
                className={`rounded px-2 py-1 text-[11px] ring-1 transition ${
                  on
                    ? "bg-brand/20 text-brand ring-brand/40"
                    : "bg-neutral-900 text-neutral-400 ring-neutral-800 hover:text-neutral-200"
                }`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {problems === null ? (
        <Spinner label="Loading problems…" />
      ) : problems.length === 0 ? (
        <Banner>No problems matched. Try a different search.</Banner>
      ) : (
        <div className="max-h-56 space-y-0.5 overflow-y-auto pr-0.5">
          {problems.map((p) => {
            const blocked = p.verdict.blocked;
            const isRevisit = p.verdict.warnings.some((w) => w.code === "repeat_old");
            const isSelected = selected?.slug === p.slug;

            return (
              <button
                key={p.slug}
                disabled={!!blocked}
                title={blocked?.message ?? undefined}
                onClick={() => {
                  setSelected(p);
                  setAcked(false);
                  setError(null);
                }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${
                  blocked
                    ? "cursor-not-allowed opacity-40"
                    : isSelected
                      ? "bg-brand/15 ring-1 ring-brand/40"
                      : "hover:bg-neutral-900"
                }`}
              >
                <span className="w-8 shrink-0 text-[11px] text-neutral-500">
                  {p.frontendId}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                {isRevisit && !blocked && (
                  <span className="shrink-0 rounded bg-medium/15 px-1 py-0.5 text-[10px] text-medium">
                    Revisit
                  </span>
                )}
                {blocked && (
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

      {selected && (
        <div className="space-y-2 border-t border-neutral-800 pt-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{selected.title}</span>
            <DifficultyTag difficulty={selected.difficulty} />
          </div>

          <WarningList
            warnings={selected.verdict.warnings}
            needsAck={needsAck}
            acked={acked}
            onToggleAck={setAcked}
          />

          <button
            onClick={submit}
            disabled={submitting || (needsAck && !acked)}
            className="w-full rounded bg-brand py-1.5 font-medium text-neutral-950 transition hover:bg-brand-dim disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Setting…" : "Set as today's problem"}
          </button>
        </div>
      )}
    </div>
  );
}
