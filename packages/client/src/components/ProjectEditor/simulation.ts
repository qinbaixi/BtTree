import { findType, type ItemKind, type ProjectFile, type SimulateJson } from '@owlbt/shared';

/** Text of a duration / count / ticks field: a number when it is one, otherwise an expression string. */
export function parseNumberOrTemplate(text: string): number | string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') {
    return undefined;
  }
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
}

export function formatNumberOrTemplate(value: number | string | undefined): string {
  return value === undefined ? '' : String(value);
}

/**
 * Changes the simulate settings of a type. Undefined fields and an empty effects list are removed,
 * and an empty `simulate` object is removed from the type again. Unknown simulate keys are kept.
 */
export function editSimulate(
  draft: ProjectFile,
  kind: ItemKind,
  name: string,
  mutate: (sim: SimulateJson) => void,
): void {
  const desc = findType(draft, kind, name);
  if (!desc) {
    return;
  }
  const sim: SimulateJson = { ...(desc.simulate ?? {}) };
  mutate(sim);
  for (const key of Object.keys(sim)) {
    if (sim[key] === undefined) {
      delete sim[key];
    }
  }
  if (Array.isArray(sim.effects) && sim.effects.length === 0) {
    delete sim.effects;
  }
  if (Object.keys(sim).length === 0) {
    delete desc.simulate;
  } else {
    desc.simulate = sim;
  }
}
