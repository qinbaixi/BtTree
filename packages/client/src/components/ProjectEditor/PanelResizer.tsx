import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { getJson, setJson } from '../../lib/storage';
import styles from './ProjectEditor.module.css';

export const PREVIEW_WIDTH_STORAGE_KEY = 'owlbt.previewWidth';
export const PREVIEW_MIN_WIDTH = 260;
export const PREVIEW_MAX_WIDTH = 900;
export const PREVIEW_DEFAULT_WIDTH = 360;

export function clampPreviewWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return PREVIEW_DEFAULT_WIDTH;
  }
  return Math.round(Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, width)));
}

/** Width of the preview panel, persisted in localStorage. */
export function usePreviewWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(() =>
    clampPreviewWidth(getJson<number>(PREVIEW_WIDTH_STORAGE_KEY, PREVIEW_DEFAULT_WIDTH)),
  );
  const update = (next: number) => {
    const clamped = clampPreviewWidth(next);
    setWidth(clamped);
    setJson(PREVIEW_WIDTH_STORAGE_KEY, clamped);
  };
  return [width, update];
}

interface PanelResizerProps {
  width: number;
  onResize(width: number): void;
}

/**
 * Vertical drag handle on the left edge of the preview panel. Dragging left widens the preview;
 * arrow keys resize in 20px steps.
 */
export function PanelResizer({ width, onResize }: PanelResizerProps) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    const move = (moveEvent: globalThis.PointerEvent) => {
      onResize(startWidth + (startX - moveEvent.clientX));
    };
    const up = () => {
      setDragging(false);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onResize(width + 20);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onResize(width - 20);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize preview"
      aria-valuenow={width}
      aria-valuemin={PREVIEW_MIN_WIDTH}
      aria-valuemax={PREVIEW_MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize the preview"
      className={`${styles.resizer} ${dragging ? styles.resizerActive : ''}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(PREVIEW_DEFAULT_WIDTH)}
    />
  );
}
