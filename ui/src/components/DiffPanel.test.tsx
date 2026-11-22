// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiffPanel } from './DiffPanel';
import type { Diff } from '@/lib/types';

afterEach(cleanup);
test('minimap reports file selection without redirecting its hunk scroll', () => {
  const select = vi.fn();
  const file: Diff = {
    path: 'a.rs',
    change: 'A',
    added_lines: 1,
    deleted_lines: 0,
    note: null,
    hunks: [{ header: '@@', lines: [{ kind: 'insert', old_line: null, new_line: 1, text: 'a' }] }],
  };
  render(<DiffPanel files={[file]} onSelectFile={select} />);
  fireEvent.click(screen.getByRole('button', { name: 'Jump to a.rs hunk 1 insert' }));
  expect(select).toHaveBeenCalledWith('a.rs');
});
test('whitespace display preserves real spaces and tabs in selectable diff text', () => {
  const text = ' \tlet name = " hello ";';
  const file: Diff = {
    path: 'src/lib.rs',
    change: 'M',
    added_lines: 1,
    deleted_lines: 0,
    note: null,
    hunks: [
      {
        header: '@@ -0,0 +1 @@',
        lines: [{ kind: 'insert', old_line: null, new_line: 1, text: text + '\n' }],
      },
    ],
  };
  const { container } = render(<DiffPanel files={[file]} showWhitespace />);
  expect(container.querySelector('.code')!.textContent).toBe(text);
});
