import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MotionConfig, motion, useReducedMotion } from 'motion/react';
import { Box, Search, GitCommitHorizontal, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SettingsDialog } from '@/components/SettingsDialog';
import {
  ForkGraph,
  MetroTimeline,
  RunMetrics,
  RunSummary,
  WaterfallBar,
} from '@/components/RunCharts';
import { forkLanes, waterfall } from '@/lib/charts';
import { PaneResizer } from '@/components/PaneResizer';
import { DiffPanel } from '@/components/DiffPanel';
import { Transcript } from '@/components/Transcript';
import { selectionFromHash } from '@/lib/hash';
import { clampSizes, parseSizes, saveSizes, type Sizes } from '@/lib/resize';
import { parseSettings, resolvedTheme, saveSettings, type Settings } from '@/lib/settings';
import { duration, relativeTime } from '@/lib/format';
import type { Run, RunDetail, StepDetail } from '@/lib/types';

async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw Error(error?.error || `Request failed (${response.status})`);
  }
  return response.json();
}
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="empty">{children}</div>
);

function runTree(runs: Run[], query: string) {
  const search = query.trim().toLowerCase();
  const visible = new Set<string>();
  const matches = runs.filter((run) =>
    `${run.id} ${run.command} ${run.target} ${run.parent_run_id ?? ''}`
      .toLowerCase()
      .includes(search),
  );
  for (const run of matches) {
    let current: Run | undefined = run;
    const ancestors = new Set<string>();
    while (current && !ancestors.has(current.id)) {
      ancestors.add(current.id);
      visible.add(current.id);
      current = runs.find((parent) => parent.id === current?.parent_run_id);
    }
  }
  const visited = new Set<string>();
  const ordered: { run: Run; depth: number }[] = [];
  function append(run: Run, depth: number) {
    if (visited.has(run.id) || !visible.has(run.id)) return;
    visited.add(run.id);
    ordered.push({ run, depth });
    runs
      .filter((child) => child.parent_run_id === run.id)
      .forEach((child) => append(child, depth + 1));
  }
  runs
    .filter((run) => !runs.some((parent) => parent.id === run.parent_run_id))
    .forEach((run) => append(run, 0));
  runs.forEach((run) => append(run, 0));
  return { ordered, matches: matches.length };
}

function RunHeader({ data, timestamps }: { data: RunDetail; timestamps: Settings['timestamps'] }) {
  const run = data.run;
  return (
    <>
      <div className="run-title">
        <span className="label">Run</span>
        <h1 className="mono">{run.id}</h1>
        {run.parent_run_id && (
          <a
            className="muted mono"
            href={`#${encodeURIComponent(run.parent_run_id)}/${run.forked_from_step}`}
          >
            forked from {run.parent_run_id} @ step {run.forked_from_step}
          </a>
        )}
      </div>
      <pre className="run-command">{run.command}</pre>
      <RunMetrics steps={data.steps} />
      <div className="run-facts">
        <span title={run.started_at}>
          Started{' '}
          <b className="mono">
            {new Date(run.started_at).toLocaleTimeString()}
            {timestamps === 'relative'
              ? ` · ${relativeTime(run.started_at)}`
              : ` · ${new Date(run.started_at).toLocaleDateString()}`}
          </b>
        </span>
        <span>
          Duration{' '}
          <b className="mono">
            {duration(
              Math.max(
                0,
                Date.parse(run.finished_at || new Date().toISOString()) -
                  Date.parse(run.started_at),
              ),
            )}
          </b>
        </span>
        <span>
          Exit{' '}
          <b className={`mono ${run.exit_code !== null && run.exit_code !== 0 ? 'error' : ''}`}>
            {run.exit_code ?? 'running'}
          </b>
        </span>
        <span>
          Steps <b className="mono">{run.step_count}</b>
        </span>
        <span>
          Total latency{' '}
          <b className="mono">
            {duration(data.steps.reduce((sum, step) => sum + step.latency_ms, 0))}
          </b>
        </span>
        <span>
          Upstream <b className="mono">{run.target}</b>
        </span>
      </div>
    </>
  );
}

export default function App() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [workspace, setWorkspace] = useState('Loading workspace…');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [runData, setRunData] = useState<RunDetail | null>(null);
  const [related, setRelated] = useState<RunDetail[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const summaryRuns = useRef(new Map<string, RunDetail>());
  const [detail, setDetail] = useState<StepDetail | null>(null);
  const [runError, setRunError] = useState('');
  const [stepError, setStepError] = useState('');
  const [raw, setRaw] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(() => parseSettings(stored('tracelane.settings')));
  const [preferred, setPreferred] = useState(() => parseSizes(stored('tracelane.panes')));
  const [width, setWidth] = useState(window.innerWidth);
  const filter = useRef<HTMLInputElement>(null);
  const sizes = clampSizes(preferred, width);
  const tree = useMemo(() => runTree(runs || [], query), [runs, query]);
  const steps = runData?.run.id === runId ? runData.steps : [];
  const currentStep = steps.find((step) => step.step_index === stepIndex);
  const totalLatency = waterfall(steps.map((step) => step.latency_ms)).total;
  const graph = forkLanes(tree.ordered.map((row) => row.run));
  const reduced = useReducedMotion();
  const entrance = reduced ? false : { opacity: 0, y: 5 };

  function chooseRun(id: string, step?: number) {
    setRunId(id);
    setStepIndex(step ?? (id === runId ? runData?.steps[0]?.step_index : null) ?? null);
  }
  function resize(name: keyof Sizes, value: number) {
    setPreferred((current) => {
      const clamped = clampSizes({ ...current, [name]: value }, window.innerWidth);
      const next = { ...current, [name]: clamped[name] };
      try {
        saveSizes(localStorage, next);
      } catch {}
      return next;
    });
  }
  function updateSettings(next: Settings) {
    setSettings(next);
    try {
      saveSettings(localStorage, next);
    } catch {}
  }

  useEffect(() => {
    const controller = new AbortController();
    api<Run[]>('/api/runs', controller.signal)
      .then(setRuns)
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error.message));
      });
    api<{ path: string }>('/api/workspace', controller.signal)
      .then((data) => setWorkspace(data.path))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setWorkspace('Workspace unavailable');
          setError(error.message);
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!runs) return;
    function fromHash() {
      const selection = selectionFromHash(location.hash, runs!);
      if (selection) {
        setRunId(selection.run);
        setStepIndex(selection.step ?? null);
      }
    }
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [runs]);
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    setRunData(null);
    setDetail(null);
    setRunError('');
    setStepError('');
    api<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`, controller.signal)
      .then((data) => {
        setRunData(data);
        setStepIndex((current) =>
          data.steps.some((step) => step.step_index === current)
            ? current
            : (data.steps[0]?.step_index ?? null),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setRunError(error.message);
      });
    return () => controller.abort();
  }, [runId]);
  useEffect(() => {
    if (runs?.length === 0) {
      setRelated([]);
      setSummaryLoading(false);
      return;
    }
    if (
      !runs ||
      runData?.run.id !== runId ||
      (runData.steps.length > 0 && detail?.step_index !== stepIndex)
    )
      return;
    const controller = new AbortController();
    summaryRuns.current.set(runData.run.id, runData);
    setRelated([...summaryRuns.current.values()]);
    const pending = runs.filter((run) => !summaryRuns.current.has(run.id));
    setSummaryLoading(pending.length > 0);
    const timer = window.setTimeout(async () => {
      for (const run of pending) {
        if (controller.signal.aborted) return;
        try {
          const data = await api<RunDetail>(
            `/api/runs/${encodeURIComponent(run.id)}`,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          if (data.run?.id === run.id && Array.isArray(data.steps)) {
            summaryRuns.current.set(run.id, data);
            setRelated([...summaryRuns.current.values()]);
          }
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      setSummaryLoading(false);
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [runs, runId, runData, detail, stepIndex]);
  useEffect(() => {
    if (!runId || runData?.run.id !== runId) return;
    if (!steps.some((step) => step.step_index === stepIndex)) {
      setStepIndex(steps[0]?.step_index ?? null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setStepError('');
    api<StepDetail>(`/api/runs/${encodeURIComponent(runId)}/steps/${stepIndex}`, controller.signal)
      .then(setDetail)
      .catch((error) => {
        if (!controller.signal.aborted) setStepError(error.message);
      });
    return () => controller.abort();
  }, [runId, stepIndex, runData]);
  useEffect(() => {
    if (runId)
      history.replaceState(
        null,
        '',
        `#${encodeURIComponent(runId)}${stepIndex !== null ? '/' + stepIndex : ''}`,
      );
  }, [runId, stepIndex]);
  useEffect(() => {
    document.querySelector('.step.active')?.scrollIntoView({ block: 'nearest' });
  }, [runId, stepIndex, runData]);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = resolvedTheme(settings.theme, media.matches);
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.classList.add(theme);
      document.documentElement.dataset.density = settings.density;
      document.documentElement.dataset.diffWrap = String(settings.diffWrap);
      document.documentElement.style.setProperty('--selection', settings.accent);
      document.documentElement.style.setProperty('--ring', settings.accent);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        /INPUT|TEXTAREA|SELECT/.test(target.tagName) ||
        target.isContentEditable ||
        settingsOpen ||
        target.closest('[role="dialog"],[role="listbox"]')
      )
        return;
      if (!['j', 'k', '[', ']', '/', 'r', ','].includes(event.key)) return;
      event.preventDefault();
      if (event.key === ',') return setSettingsOpen(true);
      if (event.key === '/') return filter.current?.focus();
      if (event.key === 'r') return setRaw((value) => !value);
      if (['[', ']'].includes(event.key)) {
        const index = tree.ordered.findIndex((item) => item.run.id === runId);
        const next =
          tree.ordered[
            Math.max(0, Math.min(tree.ordered.length - 1, index + (event.key === ']' ? 1 : -1)))
          ];
        if (next) chooseRun(next.run.id);
      } else {
        const index = steps.findIndex((step) => step.step_index === stepIndex);
        const next =
          steps[Math.max(0, Math.min(steps.length - 1, index + (event.key === 'j' ? 1 : -1)))];
        if (next) setStepIndex(next.step_index);
      }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  });

  const message = runError
    ? `Unable to load this run. ${runError}`
    : stepError
      ? `Unable to load this request. ${stepError}`
      : !runId
        ? 'Select a run to inspect requests.'
        : !runData
          ? 'Loading run…'
          : !steps.length
            ? 'This run has no recorded requests.'
            : 'Loading request…';
  const layout = {
    '--sidebar-size': `${sizes.sidebar}px`,
    '--timeline-size': `${sizes.timeline}px`,
    '--diff-size': `${sizes.diff}%`,
  } as CSSProperties;
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: reduced ? 0 : 0.18 }}>
      <TooltipProvider>
        <header className="app-bar">
          <span className="wordmark">
            <Box size={18} aria-hidden="true" />
            tracelane
          </span>
          <span className="workspace-path ellipsis mono" title={workspace}>
            {workspace}
          </span>
          <span className="keyboard-hint muted">
            <span>
              <kbd>j k</kbd> steps
            </span>
            <span>
              <kbd>[ ]</kbd> runs
            </span>
            <span>
              <kbd>/</kbd> filter
            </span>
            <span>
              <kbd>r</kbd> raw
            </span>
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Inspector settings"
                className="settings-button"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon size={15} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings (,)</TooltipContent>
          </Tooltip>
        </header>
        <MetroTimeline
          current={runData?.run.id === runId ? runData : null}
          related={related}
          selectedStep={stepIndex}
          onSelect={chooseRun}
        />
        <div className="workspace" style={layout}>
          <motion.aside className="sidebar" initial={entrance} animate={{ opacity: 1, y: 0 }}>
            <div className="section-head">
              <h2>Runs</h2>
              <span className="end muted mono">
                {query ? `${tree.matches} / ${runs?.length || 0}` : (runs?.length ?? '—')}
              </span>
            </div>
            <div className="filter-wrap">
              <Search size={13} aria-hidden="true" />
              <Input
                ref={filter}
                id="filter"
                aria-label="Filter runs"
                placeholder="Filter runs…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setQuery('');
                    filter.current?.blur();
                  }
                }}
              />
            </div>
            <nav id="runs" className="scroll" aria-label="Recorded runs">
              <ForkGraph
                runs={tree.ordered.map((row) => row.run)}
                selected={runId}
                comfortable={settings.density === 'comfortable'}
              />
              {error && (
                <div role="alert" className="empty error">
                  {error} Reload to try again.
                </div>
              )}
              {!runs ? (
                !error && <Empty>Loading runs…</Empty>
              ) : !tree.ordered.length ? (
                <Empty>
                  {runs.length
                    ? 'No matching runs. Try another command or run id.'
                    : 'No runs yet. Record a command in this workspace to get started.'}
                </Empty>
              ) : (
                tree.ordered.map(({ run }, index) => (
                  <div key={run.id} className="graph-run">
                    <button
                      className={`run ${run.id === runId ? 'active' : ''}`}
                      style={{ paddingLeft: 42 + graph[index].lane * 14 }}
                      aria-current={run.id === runId}
                      onClick={() => chooseRun(run.id)}
                    >
                      {run.id === runId && (
                        <motion.span
                          className="row-highlight"
                          layoutId="selected-run"
                          transition={{ duration: reduced ? 0 : 0.18 }}
                        />
                      )}
                      <div className="run-id">
                        <span className="mono ellipsis">{run.id}</span>
                        <span className="run-time" title={run.started_at}>
                          {settings.timestamps === 'relative'
                            ? relativeTime(run.started_at)
                            : new Date(run.started_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="command ellipsis mono" title={run.command}>
                        {run.display_command}
                      </div>
                      <div className="run-meta">
                        <span className="mono">{run.step_count} steps</span>
                        {run.exit_code !== null && (
                          <span
                            title={`Exit ${run.exit_code}`}
                            aria-label={`Exit ${run.exit_code}`}
                            className={`exit-code mono ${run.exit_code ? 'error' : ''}`}
                          >
                            exit {run.exit_code}
                          </span>
                        )}
                      </div>
                      {run.parent_run_id && (
                        <div className="fork-note">
                          <GitCommitHorizontal size={12} aria-hidden="true" />
                          fork @ step {run.forked_from_step}
                        </div>
                      )}
                    </button>
                  </div>
                ))
              )}
            </nav>
            {runs && <RunSummary runs={runs} details={related} loading={summaryLoading} />}
          </motion.aside>
          <PaneResizer
            name="Resize runs sidebar"
            value={sizes.sidebar}
            onChange={(value) => resize('sidebar', value)}
          />
          <section className="inspector">
            <motion.header className="run-header" initial={entrance} animate={{ opacity: 1, y: 0 }}>
              {runData?.run.id === runId ? (
                <RunHeader data={runData} timestamps={settings.timestamps} />
              ) : (
                <Empty>
                  {runError || (runId ? 'Loading run…' : 'Select a run to inspect its workspace.')}
                </Empty>
              )}
            </motion.header>
            <div className="columns">
              <motion.aside className="timeline" initial={entrance} animate={{ opacity: 1, y: 0 }}>
                <div className="section-head">
                  <h2>Requests</h2>
                  <span className="end muted mono">{steps.length}</span>
                </div>
                <div
                  className="waterfall-axis mono"
                  title="Cumulative request latency, not wall-clock elapsed time"
                >
                  <span>Seq</span>
                  <span>0 ms</span>
                  <span>{totalLatency} ms</span>
                </div>
                <div id="steps" className="scroll" key={runId}>
                  {!steps.length && <Empty>{message}</Empty>}
                  {steps.map((step) => (
                    <Fragment key={step.step_index}>
                      {runData?.run.parent_run_id &&
                        step.step_index === runData.run.forked_from_step && (
                          <div className="live-divider mono">LIVE from step {step.step_index}</div>
                        )}
                      <button
                        className={`step mono ${stepIndex === step.step_index ? 'active' : ''}`}
                        aria-current={stepIndex === step.step_index ? 'step' : false}
                        onClick={() => setStepIndex(step.step_index)}
                      >
                        {stepIndex === step.step_index && (
                          <motion.span
                            className="row-highlight"
                            layoutId={`selected-step-${runId}`}
                            transition={{ duration: reduced ? 0 : 0.18 }}
                          />
                        )}
                        <span className="step-index">
                          {String(step.step_index).padStart(2, '0')}
                        </span>
                        <span className="endpoint ellipsis" title={step.endpoint}>
                          {step.endpoint}
                        </span>
                        <WaterfallBar steps={steps} index={steps.indexOf(step)} />
                        <div className="step-footer">
                          <div className="step-counts">
                            <span className="added">+{step.files.added}</span>
                            <span className="modified">~{step.files.modified}</span>
                            <span className="deleted">-{step.files.deleted}</span>
                          </div>
                          <div className="step-metrics">
                            <span
                              className={`step-status ${step.status >= 400 ? 'error' : step.status >= 300 ? 'warning' : 'muted'}`}
                            >
                              {step.status}
                            </span>
                            <span className="latency muted">{step.latency_ms} ms</span>
                          </div>
                        </div>
                      </button>
                    </Fragment>
                  ))}
                </div>
                {steps.length > 0 && !runData?.run.parent_run_id && (
                  <div className="live-divider mono">LIVE</div>
                )}
              </motion.aside>
              <PaneResizer
                name="Resize request timeline"
                value={sizes.timeline}
                onChange={(value) => resize('timeline', value)}
              />
              <section className="detail">
                <motion.section
                  className="pane"
                  aria-label="File Diff"
                  initial={entrance}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="section-head">
                    <h2>File Diff</h2>
                    <span className="muted mono">
                      {detail ? `${detail.diffs.length} files` : ''}
                    </span>
                    <span className="snapshots end muted mono">
                      {currentStep
                        ? `${currentStep.pre_snapshot_id} → ${currentStep.post_snapshot_id}`
                        : ''}
                    </span>
                  </div>
                  {detail ? (
                    <DiffPanel
                      key={`${runId}/${stepIndex}`}
                      files={detail.diffs}
                      showWhitespace={settings.showWhitespace}
                    />
                  ) : (
                    <Empty>{message}</Empty>
                  )}
                </motion.section>
                <PaneResizer
                  name="Resize diff and model panes"
                  horizontal
                  value={sizes.diff}
                  onChange={(value) => resize('diff', value)}
                />
                <motion.section
                  className="pane"
                  aria-label="Model I/O"
                  initial={entrance}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="section-head">
                    <h2>Model I/O</h2>
                    <span className="muted label">Transcript</span>
                    <Button
                      id="raw-toggle"
                      variant="outline"
                      size="sm"
                      className="toggle end"
                      aria-pressed={raw}
                      onClick={() => setRaw((value) => !value)}
                    >
                      Raw
                    </Button>
                  </div>
                  {detail ? (
                    <Transcript key={`${runId}/${stepIndex}`} detail={detail} raw={raw} />
                  ) : (
                    <Empty>{message}</Empty>
                  )}
                </motion.section>
              </section>
            </div>
          </section>
        </div>
        <footer className="status-bar mono" aria-label="Run totals">
          <span>{steps.filter((step) => step.cached).length} cached</span>
          <span className="status-separator">|</span>
          <span>{steps.filter((step) => !step.cached).length} live</span>
          <span className="status-separator">|</span>
          <span>{steps.reduce((sum, step) => sum + step.latency_ms, 0)} ms total</span>
        </footer>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onChange={updateSettings}
        />
      </TooltipProvider>
    </MotionConfig>
  );
}
