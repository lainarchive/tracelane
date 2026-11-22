import { expect, test } from 'vitest';
import { clampSizes, parseSizes, saveSizes } from './resize';

test('viewport clamping preserves preferred widths and restores them on widening', () => {
  const preferred = { sidebar: 300, timeline: 400, diff: 51 };
  const narrow = clampSizes(preferred, 1000);
  expect(narrow.sidebar).toBe(240);
  expect(narrow.timeline).toBe(334);
  expect(preferred).toEqual({ sidebar: 300, timeline: 400, diff: 51 });
  expect(clampSizes(preferred, 1440)).toEqual(preferred);
});
test('invalid saved sizes fall back and manual changes round trip', () => {
  expect(parseSizes('bad')).toEqual({});
  expect(parseSizes('{"sidebar":null,"timeline":"bad","diff":51}')).toEqual({ diff: 51 });
  let stored = '';
  saveSizes(
    {
      setItem: (_, value) => {
        stored = value;
      },
    },
    { sidebar: 280 },
  );
  expect(parseSizes(stored)).toEqual({ sidebar: 280 });
  expect(() =>
    saveSizes(
      {
        setItem: () => {
          throw Error('disabled');
        },
      },
      {},
    ),
  ).not.toThrow();
});
