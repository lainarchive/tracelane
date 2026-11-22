// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MetroTimeline } from './RunCharts';
import type { RunDetail } from '@/lib/types';

afterEach(cleanup);
const current: RunDetail = {
  run: {
    id: 'root',
    parent_run_id: null,
    forked_from_step: null,
    command: 'true',
    display_command: 'true',
    started_at: '',
    finished_at: null,
    exit_code: null,
    step_count: 1,
    target: 'http://localhost',
  },
  steps: [
    {
      step_index: 1,
      endpoint: 'POST /v1/messages',
      status: 200,
      latency_ms: 0,
      cached: true,
      files: { added: 0, modified: 0, deleted: 0 },
      pre_snapshot_id: '',
      post_snapshot_id: '',
    },
  ],
};
test('zero-latency timeline never invents a nonzero time axis and nodes select exact requests', () => {
  const select = vi.fn();
  render(<MetroTimeline current={current} related={[]} selectedStep={1} onSelect={select} />);
  expect(screen.getByText('0ms')).toBeTruthy();
  expect(screen.queryByText('1ms')).toBeNull();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Select root step 1' }), { key: 'Enter' });
  expect(select).toHaveBeenCalledWith('root', 1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Select root step 1' }).querySelector('rect')!,
  );
  expect(select).toHaveBeenCalledTimes(2);
});
test('empty timelines have an explicit state instead of an empty chart', () => {
  render(
    <MetroTimeline
      current={{ ...current, steps: [] }}
      related={[]}
      selectedStep={null}
      onSelect={() => {}}
    />,
  );
  expect(screen.getByText(/No requests recorded/)).toBeTruthy();
});
