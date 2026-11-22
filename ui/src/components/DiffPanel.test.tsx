// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DiffPanel } from './DiffPanel';
import type { Diff } from '@/lib/types';

afterEach(cleanup);
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
