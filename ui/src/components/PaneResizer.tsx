import { useRef } from 'react';

export function PaneResizer({
  name,
  horizontal = false,
  reverse = false,
  value,
  onChange,
}: {
  name: string;
  horizontal?: boolean;
  reverse?: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  const initial = useRef({ pointer: 0, value: 0, size: 1 });
  return (
    <div
      className={`resizer ${horizontal ? 'horizontal' : 'vertical'}`}
      role="separator"
      aria-label={name}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        initial.current = {
          pointer: horizontal ? event.clientY : event.clientX,
          value,
          size: event.currentTarget.parentElement?.clientHeight || 1,
        };
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = (horizontal ? event.clientY : event.clientX) - initial.current.pointer;
        onChange(
          initial.current.value +
            (reverse ? -1 : 1) * (horizontal ? (delta / initial.current.size) * 100 : delta),
        );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        onChange(
          value +
            (reverse ? -1 : 1) *
              (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) *
              (horizontal ? 3 : 12),
        );
      }}
    />
  );
}
