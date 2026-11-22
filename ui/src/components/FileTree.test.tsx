// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileTree } from './FileTree';
import type { Diff } from '@/lib/types';
afterEach(cleanup);
const file = (path: string, change: 'A' | 'D'): Diff => ({
  path,
  change,
  added_lines: change === 'A' ? 1 : 0,
  deleted_lines: change === 'D' ? 1 : 0,
  hunks: [],
  note: null,
});
for (const change of ['A', 'D'] as const) {
  test(`file/directory replacements keep both paths selectable (${change})`, () => {
    const select = vi.fn();
    render(
      <FileTree
        files={[file('asset', change), file('asset/image.png', change === 'A' ? 'D' : 'A')]}
        onSelect={select}
      />,
    );
    fireEvent.click(screen.getByTitle('asset'));
    fireEvent.click(screen.getByTitle('asset/image.png'));
    expect(select.mock.calls).toEqual([['asset'], ['asset/image.png']]);
  });
}
test('a previously collapsed folder does not hide nested replacement changes', () => {
  const { rerender } = render(
    <FileTree files={[file('asset/image.png', 'A')]} onSelect={() => {}} />,
  );
  fireEvent.click(screen.getByTitle('asset'));
  expect(screen.queryByTitle('asset/image.png')).toBeNull();
  rerender(
    <FileTree files={[file('asset', 'D'), file('asset/image.png', 'A')]} onSelect={() => {}} />,
  );
  expect(screen.getByTitle('asset/image.png')).toBeTruthy();
});
test('the file tree has a useful empty state', () => {
  render(<FileTree files={[]} onSelect={() => {}} />);
  expect(screen.getByText('No file changes in this step.')).toBeTruthy();
});
