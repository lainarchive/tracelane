import { expect, test } from 'vitest';
import { visibleWhitespace } from './whitespace';

test('whitespace markers preserve indentation columns and leave newlines intact', () => {
  expect(visibleWhitespace('  let\tvalue = "a b";\n')).toBe('··let→  value·=·"a·b";\n');
  expect(visibleWhitespace('\t \t')).toBe('→   ·→  ');
});
test('empty and non-whitespace content is unchanged', () => {
  expect(visibleWhitespace('')).toBe('');
  expect(visibleWhitespace('λ<&>')).toBe('λ<&>');
});
