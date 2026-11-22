import { expect, test } from 'vitest';
import { defaultSettings, parseSettings, saveSettings, resolvedTheme } from './settings';

test('empty and corrupt settings use safe defaults', () => {
  for (const value of [
    null,
    'null',
    'bad',
    '[]',
    '{"theme":"bogus","accent":"url(https://example.com)"}',
  ])
    expect(parseSettings(value)).toEqual(defaultSettings);
});
test('settings round trip and validate each field independently', () => {
  let stored = '';
  const settings = {
    ...defaultSettings,
    theme: 'light' as const,
    density: 'comfortable' as const,
    diffWrap: true,
    timestamps: 'absolute' as const,
    accent: '#aabbcc',
  };
  saveSettings(
    {
      setItem: (_, value) => {
        stored = value;
      },
    },
    settings,
  );
  expect(parseSettings(stored)).toEqual(settings);
  expect(parseSettings('{"theme":"light","diffWrap":"yes"}')).toEqual({
    ...defaultSettings,
    theme: 'light',
  });
  expect(() =>
    saveSettings(
      {
        setItem: () => {
          throw Error('disabled');
        },
      },
      settings,
    ),
  ).not.toThrow();
});
test('system theme follows the operating system without overriding explicit choices', () => {
  expect(resolvedTheme('system', true)).toBe('dark');
  expect(resolvedTheme('system', false)).toBe('light');
  expect(resolvedTheme('dark', false)).toBe('dark');
});
