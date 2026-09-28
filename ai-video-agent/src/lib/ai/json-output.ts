/**
 * Parses a model JSON response, repairing only control characters that JSON
 * forbids inside quoted strings. Some compatible Responses relays pass through
 * literal newlines from the model instead of the required `\\n` escape.
 */
export function parseModelJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (initialError) {
    const repaired = insertMissingJsonCommas(escapeUnescapedStringControls(value));
    if (repaired === value) throw initialError;
    return JSON.parse(repaired) as T;
  }
}

export function escapeUnescapedStringControls(value: string): string {
  let inString = false;
  let escaped = false;
  let changed = false;
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;

    if (!inString) {
      result += character;
      if (character === '"') inString = true;
      continue;
    }

    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      result += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      result += character;
      inString = false;
      continue;
    }

    const code = character.charCodeAt(0);
    if (code > 0x1f) {
      result += character;
      continue;
    }

    changed = true;
    result += character === '\n'
      ? '\\n'
      : character === '\r'
        ? '\\r'
        : character === '\t'
          ? '\\t'
          : `\\u${code.toString(16).padStart(4, '0')}`;
  }

  return changed ? result : value;
}

/**
 * Restores the one JSON separator error models commonly make: a completed
 * value immediately followed by the next object field or array value. The
 * scanner never edits quoted text and never guesses missing keys or values.
 */
export function insertMissingJsonCommas(value: string): string {
  let previous: 'value' | 'close' | 'open' | 'colon' | 'comma' | undefined;
  let changed = false;
  let result = '';

  const needsComma = () => previous === 'value' || previous === 'close';
  const appendCommaIfNeeded = () => {
    if (!needsComma()) return;
    result += ',';
    previous = 'comma';
    changed = true;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (/\s/.test(character)) {
      result += character;
      continue;
    }

    if (character === '"') {
      appendCommaIfNeeded();
      const start = index;
      index += 1;
      let escaped = false;
      for (; index < value.length; index += 1) {
        const current = value[index]!;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === '\\') {
          escaped = true;
          continue;
        }
        if (current === '"') break;
      }
      result += value.slice(start, Math.min(index + 1, value.length));
      previous = 'value';
      continue;
    }

    if (character === '{' || character === '[') {
      appendCommaIfNeeded();
      result += character;
      previous = 'open';
      continue;
    }
    if (character === '}' || character === ']') {
      result += character;
      previous = 'close';
      continue;
    }
    if (character === ':') {
      result += character;
      previous = 'colon';
      continue;
    }
    if (character === ',') {
      result += character;
      previous = 'comma';
      continue;
    }
    if (/[-0-9tfn]/.test(character)) {
      appendCommaIfNeeded();
      const start = index;
      while (index + 1 < value.length && !/[\s,}\]\[{:]/.test(value[index + 1]!)) index += 1;
      result += value.slice(start, index + 1);
      previous = 'value';
      continue;
    }

    result += character;
    previous = undefined;
  }

  return changed ? result : value;
}
