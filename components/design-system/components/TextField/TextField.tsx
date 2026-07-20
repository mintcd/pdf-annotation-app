"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { mergeClassNames } from '../../internal/mergeClassNames';
import styles from './TextField.module.css';

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  description?: string;
  error?: string;
  leadingIcon?: ReactNode;
  trailingElement?: ReactNode;
  containerClassName?: string;
  inputClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      id: providedId,
      label,
      description,
      error,
      leadingIcon,
      trailingElement,
      containerClassName,
      inputClassName,
      required,
      disabled,
      'aria-describedby': ariaDescribedBy,
      'aria-invalid': ariaInvalid,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const descriptionId = description ? `${id}-description` : undefined;
    const errorId = error ? `${id}-error` : undefined;
    const describedBy = [ariaDescribedBy, descriptionId, errorId]
      .filter(Boolean)
      .join(' ') || undefined;

    return (
      <div className={mergeClassNames(styles.container, containerClassName)}>
        {label && (
          <label className={styles.label} htmlFor={id}>
            {label}
            {required && <span className={styles.required} aria-hidden="true">*</span>}
          </label>
        )}

        <div
          className={mergeClassNames(
            styles.control,
            error && styles.invalid,
            disabled && styles.disabled,
          )}
        >
          {leadingIcon && <span className={styles.leading}>{leadingIcon}</span>}
          <input
            {...props}
            ref={ref}
            id={id}
            required={required}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={error ? true : ariaInvalid}
            className={mergeClassNames(styles.input, inputClassName)}
          />
          {trailingElement && <span className={styles.trailing}>{trailingElement}</span>}
        </div>

        {description && (
          <p id={descriptionId} className={styles.description}>{description}</p>
        )}
        {error && (
          <p id={errorId} className={styles.error} role="alert">{error}</p>
        )}
      </div>
    );
  },
);
