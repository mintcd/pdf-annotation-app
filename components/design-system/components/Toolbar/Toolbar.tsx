import type { HTMLAttributes } from 'react';
import { mergeClassNames } from '../../internal/mergeClassNames';
import styles from './Toolbar.module.css';

export type ToolbarVariant = 'default' | 'subtle' | 'floating';
export type ToolbarSize = 'small' | 'medium';

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  variant?: ToolbarVariant;
  size?: ToolbarSize;
}

export function Toolbar({
  variant = 'default',
  size = 'medium',
  className,
  role = 'toolbar',
  ...props
}: ToolbarProps) {
  return (
    <div
      {...props}
      role={role}
      className={mergeClassNames(styles.toolbar, styles[variant], styles[size], className)}
    />
  );
}

export function ToolbarGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={mergeClassNames(styles.group, className)} />;
}

export function ToolbarSeparator({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={mergeClassNames(styles.separator, className)}
    />
  );
}

export function ToolbarSpacer({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} aria-hidden="true" className={mergeClassNames(styles.spacer, className)} />;
}
