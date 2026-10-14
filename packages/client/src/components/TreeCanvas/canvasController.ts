import { createContext } from 'react';
import type { Selection } from '@owlbt/shared';
import type { Size } from './layout';

/** A pointer drag of at least this many pixels is a pan and suppresses the following click. */
export const PAN_THRESHOLD = 10;

export type ContextMenuHandler = (
  selection: Selection | undefined,
  clientX: number,
  clientY: number,
) => void;

/**
 * Shared, non-React state of a tree canvas: DOM elements of the rendered nodes (for measuring),
 * pan detection (so clicks that end a drag are ignored) and the context menu callback.
 * Provided to node views through TreeCanvasContext so that node props stay primitive and memoizable.
 */
export class CanvasController {
  private readonly elements = new Map<string, HTMLDivElement>();
  private observer: ResizeObserver | undefined;
  private pressOrigin: { x: number; y: number } | undefined;
  private panned = false;

  private contextMenuHandler: ContextMenuHandler | undefined;
  private resizeHandler: (() => void) | undefined;

  /**
   * Sets the canvas callbacks. `onContextMenu` receives `undefined` when the background is
   * right-clicked; `onResize` is called when a node element changes its size.
   */
  bind(callbacks: { onContextMenu?: ContextMenuHandler; onResize?: () => void }): void {
    this.contextMenuHandler = callbacks.onContextMenu;
    this.resizeHandler = callbacks.onResize;
  }

  registerNode(id: string, element: HTMLDivElement | null): void {
    const previous = this.elements.get(id);
    if (previous && previous !== element) {
      this.observer?.unobserve(previous);
    }
    if (element) {
      this.elements.set(id, element);
      if (previous !== element) {
        this.observer?.observe(element);
      }
    } else {
      this.elements.delete(id);
    }
  }

  /** Current offset sizes of all rendered nodes. Layout values are 0 outside a browser. */
  measure(): Map<string, Size> {
    const sizes = new Map<string, Size>();
    for (const [id, element] of this.elements) {
      sizes.set(id, { width: element.offsetWidth, height: element.offsetHeight });
    }
    return sizes;
  }

  /** Starts observing node sizes. Safe to call repeatedly (e.g. in StrictMode). */
  startObserving(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    if (!this.observer) {
      this.observer = new ResizeObserver(() => this.resizeHandler?.());
    }
    for (const element of this.elements.values()) {
      this.observer.observe(element);
    }
  }

  stopObserving(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  beginPress(x: number, y: number): void {
    this.pressOrigin = { x, y };
    this.panned = false;
  }

  movePress(x: number, y: number): void {
    const origin = this.pressOrigin;
    if (origin && Math.hypot(x - origin.x, y - origin.y) >= PAN_THRESHOLD) {
      this.panned = true;
    }
  }

  /** Marks the current press as moved (e.g. a drag started), so the following click is ignored. */
  markMoved(): void {
    this.panned = true;
  }

  endPress(): void {
    this.pressOrigin = undefined;
  }

  /** True when the last press turned into a pan. Cleared by the next press. */
  isPanned(): boolean {
    return this.panned;
  }

  openContextMenu(selection: Selection | undefined, clientX: number, clientY: number): void {
    this.contextMenuHandler?.(selection, clientX, clientY);
  }
}

/** Default value is a detached controller so node views also render outside a canvas (tests). */
export const TreeCanvasContext = createContext<CanvasController>(new CanvasController());
