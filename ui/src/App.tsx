import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MotionConfig, motion, useReducedMotion } from 'motion/react';
import {
  Box,
  Search,
  GitFork,
  Camera,
  Command as CommandIcon,
  ChevronLeft,
  ChevronRight,
  Settings as SettingsIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SettingsDialog } from '@/components/SettingsDialog';
import { RunMetrics, RunSummary } from '@/components/RunCharts';
import { waterfall } from '@/lib/charts';
import { ReplayRail } from '@/components/ReplayRail';
import { FileTree } from '@/components/FileTree';
import { CommandPalette, type Command } from '@/components/CommandPalette';
import { runTree, replayCommand } from '@/lib/studio';
import { PaneResizer } from '@/components/PaneResizer';
import { DiffPanel } from '@/components/DiffPanel';
import { Transcript } from '@/components/Transcript';
import { selectionFromHash } from '@/lib/hash';
import { clampSizes, parseSizes, saveSizes, type Sizes } from '@/lib/resize';
import {
  parseSettings,
  resolvedTheme,
  saveSettings,
  themeAccent,
  type Settings,
} from '@/lib/settings';
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [replay, setReplay] = useState('');
  const [ioTab, setIoTab] = useState<'conversation' | 'request' | 'response'>('conversation');
  const [fileTarget, setFileTarget] = useState<{ path: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>();
  const [settings, setSettings] = useState(() => parseSettings(stored('tracelane.settings')));
  const [preferred, setPreferred] = useState(() => parseSizes(stored('tracelane.panes')));
  const [width, setWidth] = useState(window.innerWidth);
  const filter = useRef<HTMLInputElement>(null);
  const sizes = clampSizes(
    {
      ...preferred,
      sidebar: preferred.sidebar ?? (width <= 1300 ? 224 : 236),
      timeline: preferred.timeline ?? (width <= 1300 ? 380 : 440),
    },
    width,
  );
  const tree = useMemo(() => runTree(runs || [], query), [runs, query]);
  const steps = runData?.run.id === runId ? runData.steps : [];
  const currentStep = steps.find((step) => step.step_index === stepIndex);
  const totalLatency = waterfall(steps.map((step) => step.latency_ms)).total;
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
  function showReplay() {
    if (!runId || stepIndex === null) return;
    setReplay(replayCommand(runId, stepIndex));
    setPaletteOpen(true);
  }
  function focusFile(path: string) {
    setSelectedFile(path);
    setFileTarget({ path });
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
    setFileTarget(null);
    setSelectedFile(undefined);
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
      document.documentElement.style.setProperty(
        '--selection',
        themeAccent(settings.accent, theme),
      );
      document.documentElement.style.setProperty('--ring', themeAccent(settings.accent, theme));
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !settingsOpen) {
        event.preventDefault();
        setReplay('');
        setPaletteOpen((value) => !value);
        return;
      }
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        /INPUT|TEXTAREA|SELECT/.test(target.tagName) ||
        target.isContentEditable ||
        settingsOpen ||
        paletteOpen ||
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
  const laneDetails =
    runData?.run.id === runId
      ? [...related.filter((item) => item.run.id !== runId), runData]
      : related;
  const commands: Command[] = [
    ...(runId && stepIndex !== null
      ? [
          {
            id: 'replay',
            label: `Replay from step ${stepIndex}…`,
            keywords: 'copy command terminal fork',
            run: showReplay,
          },
        ]
      : []),
    {
      id: 'theme',
      label: 'Toggle theme',
      keywords: 'light dark appearance',
      run: () =>
        updateSettings({
          ...settings,
          theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark',
        }),
    },
    {
      id: 'settings',
      label: 'Open settings',
      keywords: 'preferences density accent whitespace',
      run: () => setSettingsOpen(true),
    },
    {
      id: 'raw',
      label: 'Toggle raw payload',
      keywords: 'json model request response',
      run: () => setRaw((value) => !value),
    },
    ...(runs ?? []).map((run) => ({
      id: `run-${run.id}`,
      label: `Jump to run ${run.id.slice(0, 8)} · ${run.display_command}`,
      keywords: `${run.id} ${run.command} ${run.parent_run_id ?? ''}`,
      run: () => chooseRun(run.id),
    })),
    ...laneDetails.flatMap((data) =>
      data.steps.map((step) => ({
        id: `step-${data.run.id}-${step.step_index}`,
        label: `Jump to ${data.run.id.slice(0, 8)} / step ${String(step.step_index).padStart(2, '0')} · ${step.endpoint}`,
        keywords: `${data.run.id} request ${step.cached ? 'cached' : 'live'} ${step.status}`,
        run: () => chooseRun(data.run.id, step.step_index),
      })),
    ),
    ...(detail?.diffs ?? []).map((file) => ({
      id: `file-${file.path}`,
      label: `Jump to ${file.path}`,
      keywords: `file diff ${file.change}`,
      run: () => focusFile(file.path),
    })),
  ];
  const layout = {
    '--sidebar-size': `${sizes.sidebar}px`,
    '--model-size': `${sizes.timeline}px`,
  } as CSSProperties;
  const selectedPosition = steps.findIndex((step) => step.step_index === stepIndex);
  function adjacent(delta: number) {
    const next = steps[Math.max(0, Math.min(steps.length - 1, selectedPosition + delta))];
    if (next) setStepIndex(next.step_index);
  }
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: reduced ? 0 : 0.18 }}>
      <TooltipProvider>
        <div className="studio-app" style={layout}>
          <header className="app-bar">
            <span className="wordmark">
              <Box size={18} aria-hidden="true" />
              tracelane
            </span>
            <span className="app-slash">/</span>
            <span className="workspace-path ellipsis mono" title={workspace}>
              {workspace}
            </span>
            <span className="app-slash">/</span>
            <span className="studio-name">Replay Studio</span>
            {runData?.run.id === runId && (
              <details className="run-info">
                <summary className="mono" title="Run metadata">
                  {runId?.slice(0, 8)}
                  <span className="muted"> · {runData.run.display_command}</span>
                </summary>
                <div className="run-info-content">
                  <RunHeader data={runData} timestamps={settings.timestamps} />
                </div>
              </details>
            )}
            <span className="keyboard-hint muted">
              <kbd>j k</kbd> steps <kbd>[ ]</kbd> runs
            </span>
            <button
              className="studio-button command-trigger"
              aria-label="Open command menu"
              onClick={() => {
                setReplay('');
                setPaletteOpen(true);
              }}
            >
              <CommandIcon size={13} />
              <kbd>Ctrl K</kbd>
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="settings-button"
                  aria-label="Inspector settings"
                  onClick={() => setSettingsOpen(true)}
                >
                  <SettingsIcon size={15} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings (,)</TooltipContent>
            </Tooltip>
          </header>
          <ReplayRail
            details={laneDetails}
            runId={runId}
            stepIndex={stepIndex}
            onSelect={chooseRun}
            onReplay={showReplay}
          />
          <main className="workspace studio-workspace">
            <motion.aside
              className="sidebar studio-sidebar"
              initial={entrance}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="section-head">
                <h2>Runs</h2>
                <span className="end muted mono">
                  {query ? `${tree.matches} / ${runs?.length ?? 0}` : (runs?.length ?? '—')}
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
                  tree.ordered.map(({ run, depth }) => (
                    <div
                      key={run.id}
                      className="graph-run"
                      style={{ '--run-depth': Math.min(depth, 4) } as CSSProperties}
                    >
                      <button
                        className={`run ${run.id === runId ? 'active' : ''}`}
                        aria-current={run.id === runId}
                        onClick={() => chooseRun(run.id)}
                      >
                        <div className="run-id mono">
                          <span className="run-tree-node" />
                          <span>{run.id.slice(0, 8)}</span>
                          <time className="muted" dateTime={run.started_at} title={run.started_at}>
                            {settings.timestamps === 'relative'
                              ? relativeTime(run.started_at)
                              : new Date(run.started_at).toLocaleTimeString()}
                          </time>
                        </div>
                        <div className="command mono ellipsis" title={run.command}>
                          {run.display_command}
                        </div>
                        <div className="run-meta">
                          <span>
                            {run.parent_run_id ? (
                              <span className="fork-note">fork @ step {run.forked_from_step}</span>
                            ) : (
                              `${run.step_count} requests`
                            )}
                          </span>
                          {run.exit_code !== null && (
                            <span
                              className={`exit-badge mono ${run.exit_code !== 0 ? 'error' : 'muted'}`}
                            >
                              exit {run.exit_code}
                            </span>
                          )}
                        </div>
                      </button>
                    </div>
                  ))
                )}
              </nav>
              <section className="files-block">
                <div className="section-head">
                  <h2>Changed files</h2>
                  <span className="end mono muted">{detail?.diffs.length ?? '—'}</span>
                </div>
                {detail ? (
                  <FileTree
                    files={detail.diffs}
                    selected={selectedFile ?? detail.diffs[0]?.path}
                    onSelect={focusFile}
                  />
                ) : (
                  <Empty>{message}</Empty>
                )}
                {detail && detail.diffs.length > 0 && (
                  <div className="tree-totals mono">
                    <span className="added">
                      +{detail.diffs.reduce((n, f) => n + f.added_lines, 0)}
                    </span>
                    <span className="deleted">
                      −{detail.diffs.reduce((n, f) => n + f.deleted_lines, 0)}
                    </span>
                    <span className="muted">across {detail.diffs.length} files</span>
                  </div>
                )}
              </section>
              {currentStep && (
                <section className="snapshot-pair">
                  <h3>Snapshot pair</h3>
                  <div>
                    <Camera size={12} />
                    <span>Before</span>
                    <code title={currentStep.pre_snapshot_id}>
                      {currentStep.pre_snapshot_id.slice(0, 10)}
                    </code>
                  </div>
                  <div>
                    <Camera size={12} />
                    <span>After</span>
                    <code title={currentStep.post_snapshot_id}>
                      {currentStep.post_snapshot_id.slice(0, 10)}
                    </code>
                  </div>
                </section>
              )}
              {runs && (
                <details className="sidebar-summary" open={runs.length === 0 ? true : undefined}>
                  <summary>
                    Run summary <span className="muted mono">{runs.length} runs</span>
                  </summary>
                  <RunSummary runs={runs} details={related} loading={summaryLoading} />
                </details>
              )}
            </motion.aside>
            <PaneResizer
              name="Resize runs sidebar"
              value={sizes.sidebar}
              onChange={(value) => resize('sidebar', value)}
            />
            <motion.section
              className="pane studio-diff"
              aria-label="File Diff"
              initial={entrance}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="section-head">
                <h2>File Diff</h2>
                <span className="muted mono">{detail ? `${detail.diffs.length} files` : ''}</span>
                <span className="end mono muted diff-state" title={currentStep?.endpoint}>
                  {currentStep
                    ? `${currentStep.status} · ${currentStep.cached ? 'cached' : `${currentStep.latency_ms} ms`}`
                    : ''}
                </span>
              </div>
              {detail ? (
                <DiffPanel
                  key={`${runId}/${stepIndex}`}
                  files={detail.diffs}
                  showWhitespace={settings.showWhitespace}
                  fileTarget={fileTarget}
                  onSelectFile={setSelectedFile}
                />
              ) : (
                <Empty>{message}</Empty>
              )}
              <div className="editor-status mono">
                <span>
                  {currentStep
                    ? `${currentStep.pre_snapshot_id.slice(0, 8)} → ${currentStep.post_snapshot_id.slice(0, 8)}`
                    : 'Snapshot diff'}
                </span>
                <span className="end">{settings.diffWrap ? 'Wrap' : 'No wrap'} · UTF-8</span>
              </div>
            </motion.section>
            <PaneResizer
              name="Resize model pane"
              reverse
              value={sizes.timeline}
              onChange={(value) => resize('timeline', value)}
            />
            <motion.section
              className="pane studio-io"
              aria-label="Model I/O"
              initial={entrance}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="section-head">
                <h2>Model I/O</h2>
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
              <div className="io-tabs" role="tablist" aria-label="Model payload view">
                {(['conversation', 'request', 'response'] as const).map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={!raw && ioTab === tab}
                    onClick={() => {
                      setIoTab(tab);
                      setRaw(false);
                    }}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              {detail ? (
                <Transcript key={`${runId}/${stepIndex}`} detail={detail} raw={raw} tab={ioTab} />
              ) : (
                <Empty>{message}</Empty>
              )}
            </motion.section>
          </main>
          <nav className="step-scrubber" aria-label="Step scrubber">
            <div className="scrub-position">
              <button
                aria-label="Previous step"
                disabled={selectedPosition <= 0}
                onClick={() => adjacent(-1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="mono">
                Step {stepIndex === null ? '—' : String(stepIndex).padStart(2, '0')}{' '}
                <span className="muted">/ {String(steps.length).padStart(2, '0')}</span>
              </span>
              <button
                aria-label="Next step"
                disabled={selectedPosition < 0 || selectedPosition === steps.length - 1}
                onClick={() => adjacent(1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div id="steps" className="scrubber-steps scroll">
              {!steps.length && <span className="muted">{message}</span>}
              {steps.map((step, index) => (
                <div className="scrub-item" key={step.step_index}>
                  {((index === 0 && !step.cached) ||
                    (index > 0 && steps[index - 1].cached && !step.cached)) && (
                    <span className="live-divider">LIVE</span>
                  )}
                  <button
                    className={`step ${stepIndex === step.step_index ? 'active' : ''} ${step.cached ? 'cached' : 'live'}`}
                    aria-current={stepIndex === step.step_index ? 'step' : undefined}
                    title={`${step.endpoint} · ${step.status} · +${step.files.added} ~${step.files.modified} -${step.files.deleted}`}
                    onClick={() => setStepIndex(step.step_index)}
                  >
                    <i className="scrub-dot" />
                    <span className="step-index mono">
                      {String(step.step_index).padStart(2, '0')}
                    </span>
                    <span className="scrub-metric mono">
                      {step.cached ? 'cached' : `${step.latency_ms} ms`}
                    </span>
                  </button>
                </div>
              ))}
            </div>
            <span className="scrub-hints muted">
              <kbd>J</kbd> <kbd>K</kbd> navigate
            </span>
            <button className="studio-button" onClick={showReplay} disabled={!currentStep}>
              <GitFork size={13} />
              Replay
            </button>
          </nav>
          <footer className="status-bar mono" aria-label="Run totals">
            <span className="live-indicator" />
            <span className="status-workspace">Local workspace</span>
            <span>{runId?.slice(0, 8) ?? 'No run selected'}</span>
            <span className="end">{steps.filter((step) => step.cached).length} cached</span>
            <span className="status-separator">|</span>
            <span>{steps.filter((step) => !step.cached).length} live</span>
            <span className="status-separator">|</span>
            <span>{totalLatency} ms total</span>
          </footer>
        </div>
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onChange={updateSettings}
        />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          commands={commands}
          replay={replay || undefined}
          onReplayClose={() => setReplay('')}
        />
      </TooltipProvider>
    </MotionConfig>
  );
}
