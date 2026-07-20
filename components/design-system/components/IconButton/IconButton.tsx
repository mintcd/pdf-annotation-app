import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { mergeClassNames } from '../../internal/mergeClassNames';
import styles from './IconButton.module.css';

export type IconButtonTone = 'neutral' | 'primary' | 'danger';
export type IconButtonSize = 'small' | 'medium' | 'large';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      tone = 'neutral',
      size = 'medium',
      className,
      children,
      type = 'button',
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        aria-label={label}
        className={mergeClassNames(
          styles.button,
          styles[tone],
          styles[size],
          className,
        )}
      >
        {children}
      </button>
    );
  },
);
