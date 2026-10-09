/**
 * Scores how well `query` matches `text`. Port of string_score 0.1.22 (non-fuzzy mode):
 * https://github.com/joshaven/string_score
 * Returns 0 when the query characters do not all occur in order (case-insensitive).
 */
export function scoreMatch(text: string, query: string): number {
  if (text === query) {
    return 1;
  }
  if (query === '') {
    return 0;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let runningScore = 0;
  let startAt = 0;

  for (let i = 0; i < query.length; i++) {
    const idx = lowerText.indexOf(lowerQuery[i], startAt);
    if (idx === -1) {
      return 0;
    }

    let charScore: number;
    if (startAt === idx) {
      // consecutive letter / start of string bonus
      charScore = 0.7;
    } else {
      charScore = 0.1;
      // acronym bonus: first character of a word
      if (text[idx - 1] === ' ') {
        charScore += 0.8;
      }
    }

    // same case bonus
    if (text[idx] === query[i]) {
      charScore += 0.1;
    }

    runningScore += charScore;
    startAt = idx + 1;
  }

  // reduce penalty for longer strings
  // (string_score divides by the fuzzy count, which is always 1 in non-fuzzy mode)
  let finalScore = 0.5 * (runningScore / text.length + runningScore / query.length);

  // start of string bonus (only applied when below 0.85)
  if (lowerQuery[0] === lowerText[0] && finalScore < 0.85) {
    finalScore += 0.15;
  }

  return finalScore;
}

/**
 * Filters items by fuzzy score (> 0), sorted by score descending (stable).
 * An empty query returns all items in their original order.
 */
export function fuzzyFilter<T>(items: T[], query: string, getText: (item: T) => string): T[] {
  if (query === '') {
    return [...items];
  }
  return items
    .map((item) => ({ item, score: scoreMatch(getText(item), query) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((scored) => scored.item);
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into matching and non-matching parts for `query`.
 * Matching is greedy and case-insensitive (each query character is matched once, in order).
 * When the whole query cannot be matched the text is returned as a single non-matching part.
 */
export function highlightMatches(text: string, query: string): HighlightPart[] {
  const lowerQuery = query.toLowerCase();
  const parts: HighlightPart[] = [];
  let queryIndex = 0;
  let inMatch: boolean | undefined;
  let buffer = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isMatched = ch.toLowerCase() === lowerQuery[queryIndex];
    if (isMatched) {
      queryIndex++;
    }
    if (inMatch === undefined || isMatched !== inMatch) {
      if (buffer.length > 0 && inMatch !== undefined) {
        parts.push({ text: buffer, match: inMatch });
      }
      inMatch = isMatched;
      buffer = '';
    }
    buffer += ch;
  }

  if (queryIndex < lowerQuery.length) {
    return [{ text, match: false }];
  }

  if (buffer.length > 0 && inMatch !== undefined) {
    parts.push({ text: buffer, match: inMatch });
  }
  return parts;
}
