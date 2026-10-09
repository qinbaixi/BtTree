import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FuzzyItem } from '../../store/dialogStore';
import { FILTER_DEBOUNCE_MS, FuzzyDialog } from './FuzzyDialog';

const ITEMS: FuzzyItem[] = [
  { id: 'wait', name: 'Wait', icon: 'clock', color: '#955cc6', hint: 'ins' },
  { id: 'walk', name: 'Walk' },
  { id: 'sequence', name: 'Sequence' },
];

function renderDialog() {
  const onAccept = vi.fn();
  const onClose = vi.fn();
  render(<FuzzyDialog items={ITEMS} onAccept={onAccept} onClose={onClose} />);
  const input = screen.getByRole('textbox');
  return { onAccept, onClose, input };
}

/** Types a filter and lets the debounce elapse. */
function typeFilter(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } });
  act(() => {
    vi.advanceTimersByTime(FILTER_DEBOUNCE_MS);
  });
}

/** Text of the label part of each option (without the hint). */
function labelOf(option: Element): string {
  return option.querySelector('span')?.textContent ?? '';
}

function optionNames(): string[] {
  return screen.queryAllByRole('option').map(labelOf);
}

function selectedName(): string | undefined {
  const selected = screen.queryAllByRole('option').find((option) => option.getAttribute('data-selected') === 'true');
  return selected ? labelOf(selected) : undefined;
}

describe('FuzzyDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows all items in order with the first one selected and the hint', () => {
    renderDialog();
    expect(optionNames()).toEqual(['Wait', 'Walk', 'Sequence']);
    expect(selectedName()).toBe('Wait');
    expect(screen.getByText('ins')).toBeTruthy();
  });

  it('filters after the debounce delay and highlights the matched characters', () => {
    const { input } = renderDialog();
    fireEvent.change(input, { target: { value: 'wa' } });
    expect(optionNames()).toHaveLength(3);

    act(() => {
      vi.advanceTimersByTime(FILTER_DEBOUNCE_MS);
    });
    expect(optionNames()).toEqual(['Wait', 'Walk']);

    const marks = document.querySelectorAll('mark');
    expect(marks[0].textContent).toBe('Wa');
  });

  it('wraps selection with the arrow keys', () => {
    const { input } = renderDialog();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selectedName()).toBe('Sequence');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selectedName()).toBe('Wait');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selectedName()).toBe('Sequence');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selectedName()).toBe('Wait');
  });

  it('accepts the selected item with Enter', () => {
    const { input, onAccept } = renderDialog();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAccept).toHaveBeenCalledWith('walk');
  });

  it('accepts the first match after filtering', () => {
    const { input, onAccept } = renderDialog();
    typeFilter(input, 'seq');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAccept).toHaveBeenCalledWith('sequence');
  });

  it('accepts an item on click', () => {
    const { onAccept } = renderDialog();
    fireEvent.click(screen.getByText('Sequence'));
    expect(onAccept).toHaveBeenCalledWith('sequence');
  });

  it('closes on Escape and on a backdrop click, but not on a click inside the dialog', () => {
    const { input, onClose } = renderDialog();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows a message and accepts nothing when no item matches', () => {
    const { input, onAccept } = renderDialog();
    typeFilter(input, 'zzz');
    expect(screen.getByText('No matching items')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAccept).not.toHaveBeenCalled();
  });
});
