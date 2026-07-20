import type { HTMLAttributes, ReactNode } from 'react';
import { mergeClassNames } from '../../internal/mergeClassNames';
import styles from './Panel.module.css';

export type PanelVariant = 'default' | 'glass';
export type PanelElement = 'div' | 'aside' | 'section';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: PanelElement;
  variant?: PanelVariant;
}

export function Panel({
  as: Element = 'div',
  variant = 'default',
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <Element
      {...props}
      className={mergeClassNames(styles.panel, styles[variant], className)}
    >
      {children}
    </Element>
  );
}

export interface PanelSectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function PanelHeader({ className, ...props }: PanelSectionProps) {
  return <div {...props} className={mergeClassNames(styles.header, className)} />;
}

export function PanelBody({ className, ...props }: PanelSectionProps) {
  return <div {...props} className={mergeClassNames(styles.body, className)} />;
}

export function PanelFooter({ className, ...props }: PanelSectionProps) {
  return <div {...props} className={mergeClassNames(styles.footer, className)} />;
}
