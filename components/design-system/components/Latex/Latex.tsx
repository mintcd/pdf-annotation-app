"use client";

import type { CSSProperties } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { mergeClassNames } from '../../internal/mergeClassNames';
import styles from './Latex.module.css';

export interface LatexDelimiter {
  left: string;
  right: string;
  display: boolean;
}

export type LatexMacros = Record<string, string>;

export interface LatexProps {
  children: string;
  className?: string;
  style?: CSSProperties;
  delimiters?: ReadonlyArray<LatexDelimiter>;
  strict?: boolean;
  macros?: LatexMacros;
}

interface LatexFragment {
  data: string;
  type: 'math' | 'text';
  rawData?: string;
  display?: boolean;
}

export const defaultLatexDelimiters: ReadonlyArray<LatexDelimiter> = [
  { left: '$$', right: '$$', display: true },
  { left: '\\(', right: '\\)', display: false },
  { left: '$', right: '$', display: false },
  { left: '\\[', right: '\\]', display: true },
];

function createDefaultMacros(smallCapsClassName: string): LatexMacros {
  const macros: LatexMacros = {};

  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    macros[`\\${letter}${letter}`] = `\\mathbb{${letter}}`;
    macros[`\\${letter}`] = `\\mathcal{${letter}}`;
  }

  macros['\\sc#1'] = `\\require{html}\\htmlClass{${smallCapsClassName}}{\\text{#1}}`;
  return macros;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findEndOfMath(
  delimiterValue: string,
  text: string,
  startIndex: number,
): number {
  let index = startIndex;
  let braceLevel = 0;

  while (index < text.length) {
    const character = text[index];

    if (
      braceLevel <= 0
      && text.slice(index, index + delimiterValue.length) === delimiterValue
    ) {
      return index;
    }

    if (character === '\\') {
      index += 1;
    } else if (character === '{') {
      braceLevel += 1;
    } else if (character === '}') {
      braceLevel -= 1;
    }

    index += 1;
  }

  return -1;
}

function escapeRegex(text: string): string {
  return text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

const amsRegex = /^\\begin{/;

function splitAtDelimiters(
  text: string,
  delimiters: ReadonlyArray<LatexDelimiter>,
): LatexFragment[] {
  if (delimiters.length === 0) return [{ type: 'text', data: text }];

  const data: LatexFragment[] = [];
  const regexLeft = new RegExp(
    `(${delimiters.map((delimiter) => escapeRegex(delimiter.left)).join('|')})`,
  );

  while (true) {
    let index = text.search(regexLeft);
    if (index === -1) break;

    if (index > 0) {
      data.push({ type: 'text', data: text.slice(0, index) });
      text = text.slice(index);
    }

    const delimiter = delimiters.find(({ left }) => text.startsWith(left));
    if (!delimiter) break;

    index = findEndOfMath(delimiter.right, text, delimiter.left.length);
    if (index === -1) break;

    const rawData = text.slice(0, index + delimiter.right.length);
    data.push({
      type: 'math',
      data: amsRegex.test(rawData)
        ? rawData
        : text.slice(delimiter.left.length, index),
      rawData,
      display: delimiter.display,
    });
    text = text.slice(index + delimiter.right.length);
  }

  if (text !== '') data.push({ type: 'text', data: text });
  return data;
}

function renderLatexInText(
  text: string,
  delimiters: ReadonlyArray<LatexDelimiter>,
  strict: boolean,
  macros: LatexMacros,
): string {
  return splitAtDelimiters(text, delimiters)
    .map((fragment) => {
      if (fragment.type === 'text') return fragment.data;

      const containsSmallCaps = /\\sc\{[^}]*\}/.test(fragment.data);
      const otherCommands = (fragment.data.match(/\\([a-zA-Z]+)/g) ?? [])
        .map((command) => command.slice(1))
        .filter((command) => command !== 'sc');

      if (containsSmallCaps && otherCommands.length === 0) {
        return fragment.data.replace(
          /\\sc\{([^}]*)\}(\\\s*)?/g,
          (_match, content: string, trailingSpace: string | undefined) => (
            `<span class="${styles.smallCaps}">${escapeHtml(content)}${trailingSpace ? '~' : ''}</span>`
          ),
        );
      }

      try {
        return katex.renderToString(fragment.data, {
          displayMode: fragment.display,
          macros,
          output: 'html',
        });
      } catch (error) {
        if (strict) throw error;
        return fragment.data;
      }
    })
    .join('');
}

export function Latex({
  children,
  className,
  style,
  delimiters = defaultLatexDelimiters,
  strict = false,
  macros,
}: LatexProps) {
  const allMacros = {
    ...createDefaultMacros(styles.smallCaps),
    ...macros,
  };
  const preprocessedChildren = children.replace(/\\\s+/g, ' ');
  const renderedLatex = renderLatexInText(
    preprocessedChildren,
    delimiters,
    strict,
    allMacros,
  );
  const shouldTruncate = style?.width !== undefined && style.height !== undefined;

  return (
    <span
      className={mergeClassNames(
        styles.root,
        shouldTruncate && styles.truncated,
        className,
      )}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderedLatex }}
    />
  );
}
