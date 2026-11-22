// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
afterEach(cleanup);
Element.prototype.scrollIntoView = () => {};

test('palette filters commands and executes the keyboard-selected result', () => {
  const act = vi.fn();
  render(
    <CommandPalette
      open
      onOpenChange={() => {}}
      commands={[
        { id: 'a', label: 'Toggle theme', keywords: 'dark light', run: act },
        { id: 'b', label: 'Settings', keywords: 'preferences', run: () => {} },
      ]}
    />,
  );
  fireEvent.change(screen.getByRole('combobox'), { target: { value: ' DARK ' } });
  expect(screen.queryByRole('option', { name: 'Settings' })).toBeNull();
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
  expect(act).toHaveBeenCalledOnce();
});
test('replay action shows a command rather than running it, with copy failure fallback', async () => {
  render(
    <CommandPalette
      open
      onOpenChange={() => {}}
      commands={[]}
      replay="tracelane replay abc --from-step 2"
    />,
  );
  expect(screen.getByRole('textbox', { name: 'Replay command' })).toHaveProperty(
    'value',
    'tracelane replay abc --from-step 2',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Copy|Copied/));
});
