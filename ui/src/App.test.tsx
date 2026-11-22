// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
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
      expect(screen.getByText('01').closest('button')!.getAttribute('aria-current')).toBe(
        'step',
      ),
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
