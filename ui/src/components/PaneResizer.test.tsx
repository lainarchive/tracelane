// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PaneResizer } from './PaneResizer';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
for (const reverse of [false, true]) {
  test(`drag and keyboard resizing stay stable across controlled renders (reverse=${reverse})`, () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => true;
    function Harness() {
      const [value, setValue] = useState(440);
      return <PaneResizer name="pane" value={value} reverse={reverse} onChange={setValue} />;
    }
    render(<Harness />);
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, { button: 0, clientX: 1000 });
    fireEvent.pointerMove(handle, { clientX: reverse ? 980 : 1020 });
    expect(handle.getAttribute('aria-valuenow')).toBe('460');
    fireEvent.pointerMove(handle, { clientX: reverse ? 960 : 1040 });
    expect(handle.getAttribute('aria-valuenow')).toBe('480');
    fireEvent.pointerMove(handle, { clientX: 1000 });
    expect(handle.getAttribute('aria-valuenow')).toBe('440');
    fireEvent.pointerUp(handle);
    fireEvent.keyDown(handle, { key: reverse ? 'ArrowLeft' : 'ArrowRight' });
    expect(handle.getAttribute('aria-valuenow')).toBe('452');
  });
}
