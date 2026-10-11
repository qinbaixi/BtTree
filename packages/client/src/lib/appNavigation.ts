/**
 * Navigation without a component context (commands, the property panel). The mounted page
 * registers its router navigate function; without one the browser location is used.
 */
type Navigator = (url: string) => void;

let navigator: Navigator | undefined;

export function setNavigator(next: Navigator | undefined): void {
  navigator = next;
}

export function navigateTo(url: string): void {
  if (navigator) {
    navigator(url);
  } else {
    window.location.assign(url);
  }
}

export interface ProjectEditorLink {
  /** owl-bt.json or a tree file inside the project. */
  path: string;
  /** Tree to return to ("Back to tree"). */
  from?: string;
  /** Type to select when the editor opens. */
  type?: { kind: 'node' | 'decorator' | 'service'; name: string };
}

/** URL of the project editor: /project?path=...[&from=...][&type=kind:name]. */
export function projectEditorUrl(link: ProjectEditorLink): string {
  const params = new URLSearchParams({ path: link.path });
  if (link.from) {
    params.set('from', link.from);
  }
  if (link.type) {
    params.set('type', `${link.type.kind}:${link.type.name}`);
  }
  return `/project?${params.toString()}`;
}

/** Parses a `type` query value (`kind:name`). Undefined when malformed. */
export function parseTypeParam(
  value: string | null | undefined,
): { kind: 'node' | 'decorator' | 'service'; name: string } | undefined {
  if (!value) {
    return undefined;
  }
  const separator = value.indexOf(':');
  const kind = value.slice(0, separator);
  const name = value.slice(separator + 1);
  if (separator < 0 || name === '') {
    return undefined;
  }
  return kind === 'node' || kind === 'decorator' || kind === 'service' ? { kind, name } : undefined;
}
