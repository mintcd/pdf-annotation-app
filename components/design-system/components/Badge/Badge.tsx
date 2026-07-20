import type { HTMLAttributes } from 'react';
import { mergeClassNames } from '../../internal/mergeClassNames';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'blue' | 'success' | 'warning' | 'danger';
export type BadgeSize = 'small' | 'medium';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
}

export function Badge({
  tone = 'neutral',
  size = 'medium',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={mergeClassNames(
        styles.badge,
        styles[tone],
        styles[size],
        className,
      )}
    >
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
