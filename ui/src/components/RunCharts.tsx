import { motion, useReducedMotion } from 'motion/react';
import { forkLanes, sparklinePath, summarizeRuns, waterfall } from '@/lib/charts';
import type { Run, RunDetail, Step } from '@/lib/types';

export function RunSummary({
  runs,
  details,
  loading,
}: {
  runs: Run[];
  details: RunDetail[];
  loading: boolean;
}) {
  const summary = summarizeRuns(runs, details);
  const steps = summary.steps;
  const total = steps ? steps.cached + steps.live : 0;
  return (
    <section className="run-summary" aria-label="Run summary">
      <h3 className="label">Run summary</h3>
      <dl className="summary-counts">
        <div>
          <dt>Total runs</dt>
          <dd className="mono">{summary.runs}</dd>
        </div>
        <div>
          <dt>Forks</dt>
          <dd className="mono">{summary.forks}</dd>
        </div>
      </dl>
      {loading ? (
        <p className="muted">Loading step totals…</p>
      ) : !steps ? (
        <p className="muted">Step totals unavailable</p>
      ) : (
        <>
          <div
            className="summary-bar"
            role="img"
            aria-label={`${steps.cached} cached steps, ${steps.live} live steps`}
          >
            <span
              className="summary-cached"
              style={{ width: `${total ? (steps.cached / total) * 100 : 0}%` }}
            />
            <span
              className="summary-live"
              style={{ width: `${total ? (steps.live / total) * 100 : 0}%` }}
            />
          </div>
          <div className="summary-legend mono">
            <span>{steps.cached} cached</span>
            <span>{steps.live} live</span>
          </div>
          <dl className="summary-counts">
            <div>
              <dt>Total latency</dt>
              <dd className="mono">{steps.latency} ms</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}

export function RunMetrics({ steps }: { steps: Step[] }) {
  const counts = steps.reduce(
    (sum, step) => ({
      added: sum.added + step.files.added,
      modified: sum.modified + step.files.modified,
      deleted: sum.deleted + step.files.deleted,
    }),
    { added: 0, modified: 0, deleted: 0 },
  );
  const total = counts.added + counts.modified + counts.deleted;
  return (
    <div className="run-metrics">
      <div>
        <span className="label">Request latency</span>
        <div className="metric-value">
          <svg
            width="72"
            height="24"
            viewBox="0 0 80 24"
            role="img"
            aria-label={`Per-step latencies: ${steps.map((s) => s.latency_ms).join(', ')} milliseconds`}
          >
            <path
              d={sparklinePath(steps.map((s) => s.latency_ms))}
              fill="none"
              stroke="var(--selection)"
              strokeWidth="1.5"
            />
            {steps.length === 1 && (
              <circle cx="40" cy={steps[0].latency_ms > 0 ? 2 : 22} r="2" fill="var(--selection)" />
            )}
          </svg>
          <strong className="mono">
            {steps.reduce((n, s) => n + s.latency_ms, 0)}
            <small>ms</small>
          </strong>
        </div>
      </div>
      <div>
        <span className="label">File changes</span>
        <div className="metric-value">
          <svg
            width="64"
            height="14"
            viewBox="0 0 100 14"
            role="img"
            aria-label={`${counts.added} added, ${counts.modified} modified, ${counts.deleted} deleted file changes across steps`}
          >
            <rect width="100" height="14" fill="var(--background)" rx="3" />
            <rect
              width={total ? (counts.added / total) * 100 : 0}
              height="14"
              fill="var(--green)"
            />
            <rect
              x={total ? (counts.added / total) * 100 : 0}
              width={total ? (counts.modified / total) * 100 : 0}
              height="14"
              fill="var(--amber)"
            />
            <rect
              x={total ? ((counts.added + counts.modified) / total) * 100 : 0}
              width={total ? (counts.deleted / total) * 100 : 0}
              height="14"
              fill="var(--red)"
            />
          </svg>
          <strong
            className="mono"
            title="File changes summed across requests; a file can appear more than once"
          >
            {total}
          </strong>
        </div>
        <span className="metric-breakdown mono">
          <span className="added">+{counts.added}</span>{' '}
          <span className="modified">~{counts.modified}</span>{' '}
          <span className="deleted">-{counts.deleted}</span>
        </span>
      </div>
    </div>
  );
}

export function ForkGraph({
  runs,
  selected,
  comfortable,
}: {
  runs: Run[];
  selected: string | null;
  comfortable: boolean;
}) {
  const rows = forkLanes(runs);
  const height = comfortable ? 120 : 104;
  const x = (lane: number) => 12 + lane * 14;
  return (
    <svg
      className="fork-graph"
      width={30 + Math.max(0, ...rows.map((r) => r.lane)) * 14}
      height={rows.length * height}
      aria-hidden="true"
    >
      {rows.map((row, i) => (
        <g key={row.id}>
          {row.parentRow !== null && (
            <path
              d={`M${x(rows[row.parentRow].lane)} ${row.parentRow * height + 23} V${i * height + 9} Q${x(rows[row.parentRow].lane)} ${i * height + 23} ${x(row.lane)} ${i * height + 23}`}
              fill="none"
              stroke="var(--selection)"
              strokeWidth="1.5"
              opacity="0.7"
            />
          )}
          <circle
            cx={x(row.lane)}
            cy={i * height + 23}
            r="3.5"
            fill="var(--card)"
            stroke={row.id === selected ? 'var(--selection)' : 'var(--muted-foreground)'}
            strokeWidth="1.5"
          />
        </g>
      ))}
    </svg>
  );
}

export function WaterfallBar({ steps, index }: { steps: Step[]; index: number }) {
  const reduced = useReducedMotion();
  const chart = waterfall(steps.map((s) => s.latency_ms));
  const span = chart.spans[index];
  const start = (span.start / (chart.total || 1)) * 100;
  const width = ((span.end - span.start) / (chart.total || 1)) * 100;
  if (steps[index].cached)
    return (
      <div
        className="waterfall-bar cached-waterfall"
        aria-label={`Cached request at ${span.start} milliseconds`}
      >
        <span className="cached-tick" style={{ left: `${start}%` }} />
        <span
          className="cached-label"
          style={
            start > 80
              ? { right: `calc(${100 - start}% + 8px)` }
              : { left: `calc(${start}% + 8px)` }
          }
        >
          cached
        </span>
      </div>
    );
  return (
    <svg
      className="waterfall-bar"
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d="M0 4 H100 M50 0 V8" stroke="var(--border)" strokeWidth="0.5" />
      <motion.rect
        x={Math.min(start, 99)}
        y="1"
        height="6"
        rx="0.8"
        fill="var(--selection)"
        initial={{ width: reduced ? Math.max(2, width) : 0 }}
        animate={{ width: Math.max(2, width) }}
        transition={{ duration: reduced ? 0 : 0.2 }}
      />
    </svg>
  );
}

function nodeRows(positions: number[]) {
  const ends: number[] = [];
  return positions.map((position) => {
    const available = ends.findIndex((end) => position - end >= 76);
    const row = available < 0 ? ends.length : available;
    ends[row] = position;
    return row;
  });
}

export function MetroTimeline({
  current,
  related,
  selectedStep,
  onSelect,
}: {
  current: RunDetail | null;
  related: RunDetail[];
  selectedStep: number | null;
  onSelect: (run: string, step?: number) => void;
}) {
  if (!current?.steps.length)
    return (
      <div className="metro-empty muted">
        Request timeline · {current ? 'No requests recorded' : 'Select a run'}
      </div>
    );
  const parent = related.find((item) => item.run.id === current.run.parent_run_id) ?? current;
  const branches =
    parent === current
      ? related.filter((item) => item.run.parent_run_id === current.run.id)
      : [current];
  const main = waterfall(parent.steps.map((s) => s.latency_ms));
  const tracks = branches.map((branch) => {
    const live = branch.steps.findIndex((step) => !step.cached);
    const steps = live < 0 ? [] : branch.steps.slice(live);
    const prefix = live < 0 ? branch.steps : branch.steps.slice(0, live);
    const fork = parent.steps.findIndex((step) => step.step_index === steps[0]?.step_index);
    const base = main.spans[fork]?.start ?? main.total;
    return { branch, base, steps, prefix, time: waterfall(steps.map((s) => s.latency_ms)) };
  });
  const total = Math.max(main.total, ...tracks.map((t) => t.base + t.time.total), 0);
  const x = (value: number) => 100 + (value / (total || 1)) * 1020;
  const parentRows = nodeRows(main.spans.map((span) => x(span.end)));
  let nextY = 68 + Math.max(0, ...parentRows) * 32;
  const layout = tracks.map((track) => {
    const nodes = [
      ...track.prefix.map((step) => ({
        step,
        position:
          main.spans[parent.steps.findIndex((original) => original.step_index === step.step_index)]
            ?.end ?? track.base,
      })),
      ...track.steps.map((step, i) => ({ step, position: track.base + track.time.spans[i].end })),
    ];
    const rows = nodeRows(nodes.map((node) => x(node.position)));
    const y = nextY;
    nextY += (Math.max(0, ...rows) + 1) * 32;
    const preceding =
      parent.steps.findIndex((step) => step.step_index === track.steps[0]?.step_index) - 1;
    return { ...track, nodes, rows, y, fromY: 36 + (parentRows[preceding] ?? 0) * 32 };
  });
  const height = Math.max(88, nextY);
  function node(run: RunDetail, step: Step, position: number, y: number, parentTrack = false) {
    const cached = step.cached;
    const selected = run.run.id === current!.run.id && step.step_index === selectedStep;
    return (
      <g
        key={step.step_index}
        role="button"
        tabIndex={0}
        aria-label={`Select ${run.run.id} step ${step.step_index}`}
        onClick={() => onSelect(run.run.id, step.step_index)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(run.run.id, step.step_index);
          }
        }}
        className={`metro-node ${selected ? 'selected' : ''}`}
      >
        <title>
          {run.run.id} · step {step.step_index} · {cached ? 'cached' : `${step.latency_ms} ms`}
        </title>
        <rect
          x={x(position) - 36}
          y={y - 8}
          width="72"
          height="30"
          fill="transparent"
          pointerEvents="all"
        />
        <circle
          cx={x(position)}
          cy={y}
          r={selected ? 7 : 5}
          fill={cached ? 'var(--background)' : 'var(--live)'}
          stroke={selected ? 'var(--foreground)' : 'var(--live)'}
          strokeWidth="2"
        />
        <text
          x={x(position) - (parentTrack ? 12 : 0)}
          y={y + 18}
          textAnchor={parentTrack ? 'end' : 'middle'}
        >
          {step.step_index} · {cached ? 'cached' : `${step.latency_ms}ms`}
        </text>
      </g>
    );
  }
  return (
    <section className="metro-band scroll" aria-label="Run request timeline">
      <svg
        viewBox={`0 0 1200 ${height}`}
        style={{ height }}
        role="group"
        aria-label="Cumulative request latency timeline"
      >
        {(total ? [0, 0.25, 0.5, 0.75, 1] : [0]).map((tick) => (
          <g key={tick}>
            <path d={`M${x(tick * total)} 20 V${height}`} stroke="var(--border)" />
            <text x={x(tick * total)} y="14" textAnchor="middle">
              {Math.round(tick * total)}ms
            </text>
          </g>
        ))}
        <text x="16" y="14">
          Σ latency
        </text>
        <text x="16" y="40">
          {parent.run.id.slice(0, 8)}
        </text>
        <path d={`M100 36 H1120`} stroke="var(--input)" strokeWidth="2" />
        {parent.steps.map((step, index) =>
          node(parent, step, main.spans[index].end, 36 + parentRows[index] * 32, true),
        )}
        {layout.map(({ branch, base, time, nodes, rows, y, fromY }) => {
          return (
            <g key={branch.run.id}>
              <text x="16" y={y + 3} className="metro-fork-label">
                fork {branch.run.id.slice(0, 6)} @{branch.run.forked_from_step}
              </text>
              <path
                d={`M${x(base)} ${fromY} Q${x(base)} ${y} ${x(base) + 16} ${y} H${x(base + time.total)}`}
                stroke="var(--selection)"
                strokeWidth="1.5"
                fill="none"
              />
              {nodes.map(({ step, position }, i) => node(branch, step, position, y + rows[i] * 32))}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
