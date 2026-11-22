import { expect, test } from 'vitest';
import { selectionFromHash } from './hash';

const runs = [{ id: 'first' }, { id: 'run two' }];
for (const hash of ['#%ZZ/2', '#%/2', '#%E0%A4/2']) {
  test(`malformed hash ${hash} falls back to the first run and step`, () => {
    expect(selectionFromHash(hash, runs)).toEqual({ run: 'first' });
  });
}
test('encoded hashes preserve requested runs and steps', () => {
  expect(selectionFromHash('#run%20two/2', runs)).toEqual({ run: 'run two', step: 2 });
});
test('unknown runs and empty run lists fall back safely', () => {
  expect(selectionFromHash('#missing/2', runs)?.run).toBe('first');
  expect(selectionFromHash('#%ZZ/2', [])).toBeNull();
});
