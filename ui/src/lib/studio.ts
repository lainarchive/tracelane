import type { Diff, Run, RunDetail, Step } from './types';

export function runTree(runs: Run[], query: string) {
  const search = query.trim().toLowerCase();
  const byId = new Map(runs.map((run) => [run.id, run]));
  const matches = runs.filter((run) =>
    `${run.id} ${run.command} ${run.target} ${run.parent_run_id ?? ''}`
      .toLowerCase()
      .includes(search),
  );
  const visible = new Set<string>();
  for (const match of matches) {
    let run: Run | undefined = match;
    const ancestors = new Set<string>();
    while (run && !ancestors.has(run.id)) {
      ancestors.add(run.id);
      visible.add(run.id);
      run = byId.get(run.parent_run_id ?? '');
    }
  }
  const ordered: { run: Run; depth: number }[] = [];
  const visited = new Set<string>();
  function append(run: Run, depth: number) {
    if (visited.has(run.id) || !visible.has(run.id)) return;
    visited.add(run.id);
    ordered.push({ run, depth });
    runs
      .filter((child) => child.parent_run_id === run.id)
      .forEach((child) => append(child, depth + 1));
  }
  runs.filter((run) => !byId.has(run.parent_run_id ?? '')).forEach((run) => append(run, 0));
  runs.forEach((run) => append(run, 0));
  return { ordered, matches: matches.length };
}

export interface RailClip {
  step: Step;
  start: number;
  end: number;
  row: number;
}
export interface RailLane {
  run: Run;
  clips: RailClip[];
  parent: string | null;
  top: number;
  height: number;
}
export function railLayout(details: RunDetail[], selected: string, showAll = false) {
  const byId = new Map(details.map((detail) => [detail.run.id, detail]));
  function root(id: string) {
    const seen = new Set<string>();
    while (byId.get(id)?.run.parent_run_id && !seen.has(id)) {
      seen.add(id);
      id = byId.get(id)!.run.parent_run_id!;
    }
    return seen.has(id) ? [...seen].sort()[0] : id;
  }
  const family = showAll
    ? details
    : details.filter((detail) => root(detail.run.id) === root(selected));
  const ordered = runTree(
    family.map((detail) => detail.run),
    '',
  ).ordered;
  const cache = new Map<string, RailClip[]>();
  function clips(id: string, visiting = new Set<string>()): RailClip[] {
    if (cache.has(id)) return cache.get(id)!;
    if (visiting.has(id)) return [];
    visiting.add(id);
    const data = byId.get(id);
    const parent = data?.run.parent_run_id ? clips(data.run.parent_run_id, visiting) : [];
    let cursor = 0;
    let live = false;
    const result = [...(data?.steps ?? [])]
      .sort((a, b) => a.step_index - b.step_index)
      .map((step) => {
        const original = parent.find((clip) => clip.step.step_index === step.step_index);
        if (step.cached && original) {
          cursor = Math.max(cursor, original.end);
          return { step, start: original.start, end: original.end, row: 0 };
        }
        if (!live && !step.cached) {
          cursor = original?.start ?? cursor;
          live = true;
        }
        const start = cursor;
        const latency = Number.isFinite(step.latency_ms) ? Math.max(0, step.latency_ms) : 0;
        cursor += step.cached ? 0 : latency;
        return { step, start, end: cursor, row: 0 };
      });
    cache.set(id, result);
    visiting.delete(id);
    return result;
  }
  ordered.forEach(({ run }) => clips(run.id));
  const total = Math.max(
    0,
    ...[...cache.values()].flatMap((clips) => clips.map((clip) => clip.end)),
  );
  const unit = 10 ** Math.floor(Math.log10((total || 1) / 4));
  const tick = [1, 2, 5, 10].map((n) => n * unit).find((n) => n >= (total || 1) / 4)!;
  const maximum = Math.ceil((total || 1) / tick) * tick;
  let top = 0;
  const lanes: RailLane[] = ordered.map(({ run }) => {
    const rowEnds: number[] = [];
    const positioned = clips(run.id).map((clip) => {
      const x = (clip.start / maximum) * 1000;
      let row = rowEnds.findIndex((end) => end <= x);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = Math.max(x + 30, (clip.end / maximum) * 1000 - 1);
      return { ...clip, row };
    });
    const height = Math.max(1, rowEnds.length) * 34 + 18;
    const lane = { run, clips: positioned, parent: run.parent_run_id, top, height };
    top += height;
    return lane;
  });
  return {
    lanes,
    maximum,
    ticks: Array.from({ length: Math.round(maximum / tick) + 1 }, (_, i) => i * tick),
    height: top,
  };
}

export interface FileNode {
  name: string;
  path: string;
  children: FileNode[];
  changes: number;
  file?: Diff;
}
export function fileTree(files: Diff[]): FileNode[] {
  const roots: FileNode[] = [];
  for (const file of files) {
    let nodes = roots;
    const parts = file.path.split('/');
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let node = nodes.find((node) => node.path === path);
      if (!node) {
        node = { name, path, children: [], changes: 0 };
        nodes.push(node);
      }
      node.changes += Math.max(0, file.added_lines) + Math.max(0, file.deleted_lines);
      if (index === parts.length - 1) node.file = file;
      nodes = node.children;
    });
  }
  function sort(nodes: FileNode[]) {
    nodes.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
    nodes.forEach((node) => sort(node.children));
  }
  sort(roots);
  return roots;
}

export interface PaletteEntry {
  id: string;
  label: string;
  keywords: string;
}
export function filterCommands<T extends PaletteEntry>(commands: T[], query: string): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((command) =>
    terms.every((term) => `${command.label} ${command.keywords}`.toLowerCase().includes(term)),
  );
}
export function replayCommand(id: string, step: number) {
  const safe = /^[\w.-]+$/.test(id) ? id : `'${id.replace(/'/g, `'"'"'`)}'`;
  return `tracelane replay ${safe} --from-step ${step}`;
}
