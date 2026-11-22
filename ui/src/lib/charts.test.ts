import { expect, test } from 'vitest';
import { waterfall, sparklinePath, forkLanes, minimapPositions } from './charts';

test('waterfall uses cumulative request latency, including zero-duration cached requests', () => {
  expect(waterfall([0, 100, 300])).toEqual({
    total: 400,
    spans: [
      { start: 0, end: 0 },
      { start: 0, end: 100 },
      { start: 100, end: 400 },
    ],
  });
  expect(waterfall([])).toEqual({ total: 0, spans: [] });
  expect(waterfall([-5, NaN, Infinity])).toEqual({
    total: 0,
    spans: [
      { start: 0, end: 0 },
      { start: 0, end: 0 },
      { start: 0, end: 0 },
    ],
  });
});
test('sparkline scales every step and handles empty, single and invalid samples', () => {
  expect(sparklinePath([0, 10, 5], 24, 14)).toBe('M2 12 L12 2 L22 7');
  expect(sparklinePath([], 24, 14)).toBe('');
  expect(sparklinePath([0], 24, 14)).toBe('M12 12');
  expect(sparklinePath([NaN, -2], 24, 14)).toBe('M2 12 L22 12');
});
test('fork lanes branch from the actual parent, and malformed cycles stay finite', () => {
  expect(
    forkLanes([
      { id: 'a', parent_run_id: null },
      { id: 'b', parent_run_id: 'a' },
      { id: 'c', parent_run_id: 'b' },
      { id: 'd', parent_run_id: null },
    ]),
  ).toEqual([
    { id: 'a', lane: 0, parentRow: null },
    { id: 'b', lane: 1, parentRow: 0 },
    { id: 'c', lane: 2, parentRow: 1 },
    { id: 'd', lane: 0, parentRow: null },
  ]);
  expect(forkLanes([])).toEqual([]);
  expect(forkLanes([{ id: 'orphan', parent_run_id: 'missing' }])[0].lane).toBe(0);
  expect(
    forkLanes([
      { id: 'a', parent_run_id: 'b' },
      { id: 'b', parent_run_id: 'a' },
    ]).every((row) => Number.isFinite(row.lane)),
  ).toBe(true);
});
test('minimap distributes actual diff rows and groups contiguous changes by hunk', () => {
  expect(
    minimapPositions([
      {
        path: 'a',
        hunks: [
          {
            lines: [
              { kind: 'context' },
              { kind: 'insert' },
              { kind: 'insert' },
              { kind: 'delete' },
            ],
          },
        ],
      },
    ]),
  ).toEqual([
    { path: 'a', hunk: 0, kind: 'insert', start: 0.25, size: 0.5 },
    { path: 'a', hunk: 0, kind: 'delete', start: 0.75, size: 0.25 },
  ]);
  expect(minimapPositions([])).toEqual([]);
  expect(minimapPositions([{ path: 'binary', hunks: [] }])).toEqual([]);
});
