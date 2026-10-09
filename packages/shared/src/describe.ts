import { getEffectiveValue } from './validation';
import type { CompiledItemType } from './types';

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Renders the item description by replacing `{{ PropName }}` placeholders with the effective property values.
 * Plain property lookup only (no expression evaluation). Returns undefined when the type has no description.
 */
export function describeItem(
  type: CompiledItemType,
  properties: Record<string, unknown>,
): string | undefined {
  if (!type.description) {
    return undefined;
  }
  return type.description.replace(PLACEHOLDER, (_match, name: string) => {
    const prop = type.properties.find((p) => p.name === name);
    let value: unknown;
    if (prop) {
      value = getEffectiveValue(prop, properties);
    } else if (Object.hasOwn(properties, name)) {
      value = properties[name];
    }
    return value === undefined || value === null ? '' : String(value);
  });
}
