import type { HTMLAttributes } from 'react';
import { mergeClassNames } from '../../internal/mergeClassNames';
import styles from './Card.module.css';

export type CardVariant = 'default' | 'subtle' | 'elevated';
export type CardPadding = 'none' | 'small' | 'medium' | 'large';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  selected?: boolean;
}

export function Card({
  variant = 'default',
  padding = 'medium',
  selected = false,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      {...props}
      className={mergeClassNames(
        styles.card,
        styles[variant],
        styles[padding],
        selected && styles.selected,
        className,
      )}
    >
      {children}
    </div>
  );
}
