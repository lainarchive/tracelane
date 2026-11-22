// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('selected run and step load before sequential background summary requests', async () => {
  mockInspector();
  const original = fetch;
  const [run] = await (await original('/api/runs')).json();
  const calls: string[] = [];
  let releaseRun!: () => void, releaseStep!: () => void, releaseOther!: () => void;
  const runGate = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  const stepGate = new Promise<void>((resolve) => {
    releaseStep = resolve;
  });
  const otherGate = new Promise<void>((resolve) => {
    releaseOther = resolve;
  });
  vi.stubGlobal('fetch', async (path: string) => {
    calls.push(path);
    if (path === '/api/runs')
      return { ok: true, json: async () => [run, { ...run, id: 'other' }, { ...run, id: 'last' }] };
    if (path === '/api/runs/run') await runGate;
    if (path.includes('/steps/')) await stepGate;
    if (path === '/api/runs/other') await otherGate;
    if (path === '/api/runs/other' || path === '/api/runs/last')
      return {
        ok: true,
        json: async () => ({ run: { ...run, id: path.split('/').at(-1) }, steps: [] }),
      };
    return original(path);
  });
  history.replaceState(null, '', '#run/2');
  render(<App />);
  await waitFor(() => expect(calls).toContain('/api/runs/run'));
  expect(calls).not.toContain('/api/runs/other');
  releaseRun();
  await waitFor(() => expect(calls).toContain('/api/runs/run/steps/2'));
  expect(calls).not.toContain('/api/runs/other');
  releaseStep();
  await waitFor(() => expect(calls).toContain('/api/runs/other'));
  expect(calls).not.toContain('/api/runs/last');
  releaseOther();
  await waitFor(() => expect(calls).toContain('/api/runs/last'));
});

test('deep-linked requests scroll into view after the timeline has loaded', async () => {
  mockInspector();
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  history.replaceState(null, '', '#run/2');
  render(<App />);
  const selected = (await screen.findByText('02')).closest('button')!;
  await waitFor(() => expect(selected.getAttribute('aria-current')).toBe('step'));
  await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'nearest' }));
  expect(scroll.mock.instances).toContain(selected);
});

function mockInspector(parentId: string | null = null) {
  const run = {
    id: 'run',
    parent_run_id: parentId,
    forked_from_step: null,
    command: 'true',
    display_command: 'true',
    started_at: '2026-11-22T00:00:00Z',
    finished_at: '2026-11-22T00:00:01Z',
    exit_code: 0,
    step_count: 2,
    target: 'http://localhost',
  };
  const steps = [1, 2].map((step_index) => ({
    step_index,
    endpoint: 'POST /v1/messages',
    status: 200,
    latency_ms: 1,
    cached: false,
    files: { added: 0, modified: 0, deleted: 0 },
    pre_snapshot_id: 'before',
    post_snapshot_id: 'after',
  }));
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal('fetch', async (path: string) => {
    const data =
      path === '/api/runs'
        ? [run]
        : path === '/api/workspace'
          ? { path: '/workspace' }
          : path === '/api/runs/run'
            ? { run, steps }
            : {
                step_index: Number(path.split('/').at(-1)),
                diffs: [],
                request: {},
                response: 'Answer',
                response_content_type: 'text/plain',
              };
    return { ok: true, json: async () => data };
  });
}

test('malformed and unknown step hashes reset the current run to its first request', async () => {
  mockInspector();
  history.replaceState(null, '', '#run/2');
  render(<App />);
  const second = (await screen.findByText('02')).closest('button')!;
  await waitFor(() => expect(second.getAttribute('aria-current')).toBe('step'));
  for (const hash of ['#%ZZ/2', '#run/99']) {
    window.location.hash = hash;
    fireEvent(window, new HashChangeEvent('hashchange'));
    await waitFor(() =>
      expect(screen.getByText('01').closest('button')!.getAttribute('aria-current')).toBe('step'),
    );
    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => expect(second.getAttribute('aria-current')).toBe('step'));
  }
});

test('run filter trims whitespace and matches commands, ids, upstreams and parents', async () => {
  mockInspector('parent-id');
  history.replaceState(null, '', '#run/1');
  const { container } = render(<App />);
  await screen.findByText('02');
  const filter = screen.getByRole('textbox', { name: 'Filter runs' });
  for (const query of ['  TRUE  ', '  run  ', '  LOCALHOST  ', '  parent-id  ', '   ', '']) {
    fireEvent.change(filter, { target: { value: query } });
    expect(container.querySelectorAll('#runs .run')).toHaveLength(1);
  }
  fireEvent.change(filter, { target: { value: 'missing' } });
  expect(container.querySelectorAll('#runs .run')).toHaveLength(0);
  expect(container.querySelector('#runs')?.textContent).toContain('No matching runs');
});

test('settings segments and swatches apply and persist appearance and diff preferences', async () => {
  mockInspector();
  history.replaceState(null, '', '#run/1');
  render(<App />);
  await screen.findByText('02');
  fireEvent.keyDown(document.body, { key: ',' });
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.click(dialog.getByRole('radio', { name: /^Light$/ }));
  expect(document.documentElement.className).toBe('light');
  fireEvent.click(dialog.getByRole('button', { name: 'Blue accent' }));
  expect(document.documentElement.style.getPropertyValue('--selection')).toBe('#3b82f6');
  fireEvent.click(dialog.getByRole('radio', { name: 'Comfortable' }));
  fireEvent.click(dialog.getByRole('radio', { name: 'Absolute' }));
  fireEvent.click(dialog.getByRole('switch', { name: 'Wrap long lines' }));
  fireEvent.click(dialog.getByRole('switch', { name: 'Show whitespace characters' }));
  expect(JSON.parse(localStorage.getItem('tracelane.settings')!)).toMatchObject({
    theme: 'light',
    density: 'comfortable',
    accent: '#3b82f6',
    timestamps: 'absolute',
    diffWrap: true,
    showWhitespace: true,
  });
});
