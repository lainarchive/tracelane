import { expect, test } from 'vitest';
import { railLayout, fileTree, filterCommands, runTree, replayCommand } from './studio';
import type { Run, RunDetail, Step, Diff } from './types';

const run = (id: string, parent: string | null = null): Run => ({
  id,
  parent_run_id: parent,
  forked_from_step: parent ? 2 : null,
  command: 'mock_agent',
  display_command: 'mock_agent',
  started_at: '',
  finished_at: null,
  exit_code: 0,
  step_count: 3,
  target: 'http://localhost',
});
const step = (i: number, ms: number, cached = false): Step => ({
  step_index: i,
  latency_ms: ms,
  cached,
  endpoint: 'POST /v1/messages',
  status: 200,
  files: { added: 0, modified: 1, deleted: 0 },
  pre_snapshot_id: 'before',
  post_snapshot_id: 'after',
});
const detail = (id: string, parent: string | null, steps: Step[]): RunDetail => ({
  run: run(id, parent),
  steps,
});

test('rail reuses parent context for cached clips and aligns the real live continuation', () => {
  const layout = railLayout(
    [
      detail('parent', null, [step(1, 250), step(2, 250), step(3, 250)]),
      detail('fork', 'parent', [step(1, 0, true), step(2, 260), step(3, 240)]),
    ],
    'fork',
  );
  expect(layout.lanes.map((l) => l.run.id)).toEqual(['parent', 'fork']);
  expect(layout.lanes.map((l) => l.height)).toEqual([52, 52]);
  expect(layout.lanes[1].clips.map((c) => [c.start, c.end])).toEqual([
    [0, 250],
    [250, 510],
    [510, 750],
  ]);
  expect(layout.lanes[1].clips[0].step.latency_ms).toBe(0);
  expect(layout.maximum).toBeGreaterThanOrEqual(750);
});
test('rail keeps early cache misses, nested forks and independent zero-time hit rows', () => {
  const parent = detail('parent', null, [step(1, 0), step(2, 0), step(3, 0)]);
  const fork = detail('fork', 'parent', [step(1, 20), step(2, 0), step(3, 0)]);
  fork.run.forked_from_step = 3;
  const layout = railLayout(
    [parent, fork, detail('child', 'fork', [step(1, 0, true), step(2, 10)])],
    'fork',
  );
  expect(layout.lanes[1].clips[0].start).toBe(0);
  expect(new Set(layout.lanes[0].clips.map((c) => c.row)).size).toBe(3);
  expect(layout.lanes[2].clips[1].start).toBe(20);
});
test('rail tolerates missing parents, invalid latency, cycles and empty data', () => {
  expect(railLayout([], '').lanes).toEqual([]);
  const broken = detail('a', 'missing', [step(1, NaN), step(2, -20)]);
  expect(railLayout([broken], 'a').lanes[0].clips.map((c) => c.end)).toEqual([0, 0]);
  expect(
    railLayout([detail('a', 'b', []), detail('b', 'a', [])], 'a').lanes.length,
  ).toBeLessThanOrEqual(2);
});
test('file tree groups paths and aggregates real changes without inventing files', () => {
  const files = [
    { path: 'src/lib.rs', added_lines: 5, deleted_lines: 1 },
    { path: 'README.md', added_lines: 6, deleted_lines: 0 },
  ] as Diff[];
  const nodes = fileTree(files);
  expect(nodes.map((n) => n.path)).toEqual(['src', 'README.md']);
  expect(nodes[0].children[0].file?.path).toBe('src/lib.rs');
  expect(nodes[0].changes).toBe(6);
  expect(fileTree([])).toEqual([]);
});
test('run tree keeps ancestors when filtering and terminates corrupt cycles', () => {
  expect(
    runTree([run('parent'), run('fork', 'parent')], ' FORK ').ordered.map((r) => r.run.id),
  ).toEqual(['parent', 'fork']);
  expect(runTree([run('a', 'b'), run('b', 'a')], '').ordered).toHaveLength(2);
  expect(runTree([], '').matches).toBe(0);
});
test('palette matches all terms case-insensitively and returns no unrelated results', () => {
  const commands = [
    { id: 'file', label: 'Jump to src/lib.rs', keywords: 'file rust' },
    { id: 'theme', label: 'Toggle theme', keywords: 'light dark' },
  ];
  expect(filterCommands(commands, ' RUST  lib ').map((c) => c.id)).toEqual(['file']);
  expect(filterCommands(commands, 'absent')).toEqual([]);
  expect(filterCommands(commands, '')).toEqual(commands);
  expect(filterCommands([], 'x')).toEqual([]);
  expect(replayCommand('abc', 2)).toBe('tracelane replay abc --from-step 2');
  expect(replayCommand('untrusted;id', 2)).toBe("tracelane replay 'untrusted;id' --from-step 2");
});
