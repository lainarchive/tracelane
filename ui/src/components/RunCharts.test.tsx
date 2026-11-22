// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MetroTimeline, RunSummary, WaterfallBar } from './RunCharts';
import type { RunDetail } from '@/lib/types';

afterEach(cleanup);
test('cached waterfall requests use a labeled fixed tick at their actual start offset', () => {
  const steps = [
    { ...current.steps[0], cached: false, latency_ms: 10 },
    current.steps[0],
    { ...current.steps[0], cached: false, latency_ms: 10 },
  ];
  const { container } = render(<WaterfallBar steps={steps} index={1} />);
  expect(screen.getByText('cached')).toBeTruthy();
  expect((container.querySelector('.cached-tick') as HTMLElement).style.left).toBe('50%');
  expect(container.querySelector('svg')).toBeNull();
});
test('summary distinguishes empty data, loading and failed step totals', () => {
  const { rerender } = render(<RunSummary runs={[]} details={[]} loading={false} />);
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe('0 cached steps, 0 live steps');
  rerender(<RunSummary runs={[current.run]} details={[]} loading />);
  expect(screen.getByText('Loading step totals…')).toBeTruthy();
  rerender(<RunSummary runs={[current.run]} details={[]} loading={false} />);
  expect(screen.getByText('Step totals unavailable')).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
});
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
  expect(
    screen
      .getByRole('button', { name: 'Select root step 1' })
      .querySelector('text')!
      .getAttribute('text-anchor'),
  ).toBe('end');
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

test('requests with identical end times have separate nonoverlapping hit targets', () => {
  const select = vi.fn();
  const data = {
    ...current,
    steps: [1, 2, 3].map((step_index) => ({ ...current.steps[0], step_index })),
  };
  render(<MetroTimeline current={data} related={[]} selectedStep={2} onSelect={select} />);
  const targets = screen.getAllByRole('button').map((button) => button.querySelector('rect')!);
  const positions = targets.map(
    (target) => `${target.getAttribute('x')}/${target.getAttribute('y')}`,
  );
  expect(new Set(positions).size).toBe(3);
  targets.forEach((target, i) => {
    fireEvent.click(target);
    expect(select).toHaveBeenLastCalledWith('root', i + 1);
  });
});

test('a cache miss before the configured fork retains every live node and its latency', () => {
  const parent = {
    run: { ...current.run, step_count: 3 },
    steps: [1, 2, 3].map((step_index) => ({
      ...current.steps[0],
      step_index,
      cached: false,
      latency_ms: 10,
    })),
  };
  const replay = {
    run: { ...current.run, id: 'fork', parent_run_id: 'root', forked_from_step: 3, step_count: 3 },
    steps: [0, 100, 25].map((latency_ms, i) => ({
      ...current.steps[0],
      step_index: i + 1,
      cached: i === 0,
      latency_ms,
    })),
  };
  render(
    <MetroTimeline current={replay} related={[parent]} selectedStep={2} onSelect={() => {}} />,
  );
  expect(screen.getByRole('button', { name: 'Select fork step 2' })).toBeTruthy();
  expect(screen.getByText('135ms')).toBeTruthy();
});
