"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { mergeClassNames } from '../../internal/mergeClassNames';
import styles from './Select.module.css';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export type SelectAlign = 'start' | 'end';
export type SelectSize = 'small' | 'medium';

export interface SelectProps<T extends string = string> {
  options: ReadonlyArray<SelectOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  ariaLabel?: string;
  triggerContent?: ReactNode;
  placeholder?: string;
  align?: SelectAlign;
  size?: SelectSize;
  disabled?: boolean;
  className?: string;
}

export function Select<T extends string = string>({
  options,
  value,
  onValueChange,
  ariaLabel,
  triggerContent,
  placeholder = 'Select an option',
  align = 'start',
  size = 'medium',
  disabled = false,
  className,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedId = useId();
  const triggerId = `${generatedId}-trigger`;
  const listboxId = `${generatedId}-listbox`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const findEnabledIndex = useCallback((start: number, direction: 1 | -1) => {
    if (options.length === 0) return -1;

    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (start + (offset * direction) + options.length) % options.length;
      if (!options[index]?.disabled) return index;
    }

    return -1;
  }, [options]);

  useEffect(() => {
    if (!open) return;

    const initialIndex = selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : findEnabledIndex(-1, 1);
    setActiveIndex(initialIndex);

    const animationFrame = requestAnimationFrame(() => listRef.current?.focus());
    return () => cancelAnimationFrame(animationFrame);
  }, [findEnabledIndex, open, options, selectedIndex]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
  }, []);

  const closeAndFocusTrigger = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const chooseOption = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onValueChange(option.value);
    closeAndFocusTrigger();
  };

  const runTypeahead = (key: string) => {
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    typeaheadRef.current += key.toLocaleLowerCase();

    const match = options.findIndex((option) =>
      !option.disabled
      && option.label.toLocaleLowerCase().startsWith(typeaheadRef.current),
    );
    if (match >= 0) setActiveIndex(match);

    typeaheadTimerRef.current = setTimeout(() => {
      typeaheadRef.current = '';
      typeaheadTimerRef.current = null;
    }, 500);
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((current) => findEnabledIndex(current, 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((current) => findEnabledIndex(current < 0 ? 0 : current, -1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(findEnabledIndex(options.length - 1, 1));
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(findEnabledIndex(0, -1));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (activeIndex >= 0) chooseOption(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        closeAndFocusTrigger();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          runTypeahead(event.key);
        }
    }
  };

  return (
    <div ref={rootRef} className={mergeClassNames(styles.root, className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={mergeClassNames(styles.trigger, styles[size])}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className={styles.triggerContent}>
          {triggerContent ?? selectedOption?.label ?? placeholder}
        </span>
        <svg className={styles.chevron} aria-hidden="true" viewBox="0 0 20 20">
          <path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={triggerId}
          aria-activedescendant={activeIndex >= 0 ? `${generatedId}-option-${activeIndex}` : undefined}
          className={mergeClassNames(styles.listbox, align === 'end' && styles.alignEnd)}
          onKeyDown={handleListKeyDown}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;

            return (
              <li
                key={option.value}
                id={`${generatedId}-option-${index}`}
                role="option"
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                className={mergeClassNames(
                  styles.option,
                  active && styles.active,
                  selected && styles.selected,
                  option.disabled && styles.optionDisabled,
                )}
                onPointerMove={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => chooseOption(index)}
              >
                <span className={styles.optionLabel}>{option.label}</span>
                {selected && (
                  <svg className={styles.check} aria-hidden="true" viewBox="0 0 20 20">
                    <path d="m5 10 3 3 7-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
