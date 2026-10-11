import { useState, type KeyboardEvent, type Ref } from 'react';

export interface TextInputProps {
  value: string;
  /**
   * Called with the new text. In commit mode this is on blur or Enter (Escape reverts).
   * In live mode it is called on every change; the store merges consecutive edits into one undo step.
   */
  onCommit(value: string): void;
  live?: boolean;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  invalid?: boolean;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** Text field for the project editor. Commit mode keeps the typed text until blur or Enter. */
export function TextInput({
  value,
  onCommit,
  live = false,
  multiline = false,
  placeholder,
  ariaLabel,
  className,
  invalid = false,
  id,
  inputRef,
}: TextInputProps) {
  const [text, setText] = useState(value);
  // Follow the value from the store: adjust during render rather than in an effect.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }

  if (multiline) {
    return (
      <textarea
        id={id}
        className={className}
        value={live ? value : text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onChange={(event) => (live ? onCommit(event.target.value) : setText(event.target.value))}
        onBlur={live ? undefined : () => text !== value && onCommit(text)}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === 'Escape' && !live) {
            setText(value);
            (event.target as HTMLElement).blur();
          }
        }}
      />
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setText(value);
      event.currentTarget.blur();
    } else if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  };

  return (
    <input
      id={id}
      ref={inputRef}
      type="text"
      className={className}
      value={live ? value : text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      onChange={(event) => (live ? onCommit(event.target.value) : setText(event.target.value))}
      onBlur={live ? undefined : () => text !== value && onCommit(text)}
      onKeyDown={live ? undefined : onKeyDown}
    />
  );
}
