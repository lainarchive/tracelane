// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Transcript } from './Transcript';
import type { StepDetail } from '@/lib/types';

afterEach(cleanup);
test('malformed transcript rendering never removes diff siblings or the raw view', () => {
  const detail: StepDetail = {
    step_index: 1,
    diffs: [],
    request: {},
    response: { choices: [{ message: { role: { malformed: true }, content: 'answer' } }] },
  };
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { rerender } = render(
    <>
      <div>Existing diff</div>
      <Transcript detail={detail} raw={false} />
    </>,
  );
  expect(screen.getByText('Existing diff')).toBeTruthy();
  expect(screen.getByText(/Unable to render this transcript/)).toBeTruthy();
  rerender(
    <>
      <div>Existing diff</div>
      <Transcript detail={detail} raw />
    </>,
  );
  expect(screen.getByText('Existing diff')).toBeTruthy();
  expect(screen.getByText(/"malformed"/)).toBeTruthy();
  error.mockRestore();
});
test('transcript renders current messages, tools and expandable prior context', () => {
  const detail: StepDetail = {
    step_index: 1,
    diffs: [],
    request: {
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Question' },
      ],
    },
    response: { output: [{ type: 'function_call', name: 'read_file', arguments: '{"path":"a"}' }] },
  };
  render(<Transcript detail={detail} raw={false} />);
  expect(screen.getByText('Question')).toBeTruthy();
  expect(screen.getByText(/Tool call.*read_file/)).toBeTruthy();
  fireEvent.click(screen.getByText(/Earlier context/));
  expect(screen.getByText('System prompt')).toBeTruthy();
});
