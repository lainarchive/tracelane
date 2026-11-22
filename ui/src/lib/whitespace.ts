export function visibleWhitespace(text: string): string {
  let column = 0;
  let result = '';
  for (const character of text) {
    if (character === '\t') {
      const width = 4 - (column % 4);
      result += '→' + ' '.repeat(width - 1);
      column += width;
    } else {
      result += character === ' ' ? '·' : character;
      column = character === '\n' || character === '\r' ? 0 : column + 1;
    }
  }
  return result;
}
