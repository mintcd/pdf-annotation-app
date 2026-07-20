import {
  type FormEvent,
  type KeyboardEvent,
  createElement,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import katex from 'katex'
import TextEditor, {
  escapeHtml,
  mathRegex,
  renderTokenSpan,
  type TextEditorPlugin,
  type TextEditorToken,
} from './text-editor'

const latexCodeStyle = "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Segoe UI Mono', monospace; color: #065f46; background: rgba(16,185,129,0.06); padding: 0 4px; border-radius: 4px;"

const latexMacros = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))
  .reduce<Record<string, string>>((macros, letter) => {
    macros[`\\${letter}${letter}`] = `\\mathbb{${letter}}`
    macros[`\\${letter}`] = `\\mathcal{${letter}}`
    return macros
  }, {
    '\\sc#1': '\\require{html}\\htmlClass{textsc}{\\text{#1}}',
  })

function parseLatexToken(raw: string): { displayMode: boolean; source: string } {
  if (raw.startsWith('$$') && raw.endsWith('$$')) {
    return { displayMode: true, source: raw.slice(2, -2) }
  }

  if (raw.startsWith('\\[') && raw.endsWith('\\]')) {
    return { displayMode: true, source: raw.slice(2, -2) }
  }

  if (raw.startsWith('\\(') && raw.endsWith('\\)')) {
    return { displayMode: false, source: raw.slice(2, -2) }
  }

  if (raw.startsWith('$') && raw.endsWith('$')) {
    return { displayMode: false, source: raw.slice(1, -1) }
  }

  return { displayMode: true, source: raw }
}

function renderLatexToken(raw: string): string {
  const { displayMode, source } = parseLatexToken(raw)

  try {
    return katex.renderToString(source, {
      displayMode,
      macros: latexMacros,
      output: 'html',
      throwOnError: false,
    })
  } catch {
    return escapeHtml(raw)
  }
}

const annotationLatexPlugin: TextEditorPlugin = {
  name: 'annotation-latex',
  match(text) {
    const regex = new RegExp(mathRegex.source, mathRegex.flags)
    const tokens: TextEditorToken[] = []
    let match: RegExpExecArray | null

    while ((match = regex.exec(text))) {
      tokens.push({
        start: match.index,
        end: regex.lastIndex,
        raw: match[0],
        type: 'math',
      })
    }

    return tokens
  },
  renderActive(token) {
    return renderTokenSpan({
      pluginName: 'annotation-latex',
      mode: 'active',
      raw: token.raw,
      html: escapeHtml(token.raw),
      className: 'latex-code',
      style: latexCodeStyle,
    })
  },
  renderInactive(token) {
    return renderTokenSpan({
      pluginName: 'annotation-latex',
      mode: 'inactive',
      raw: token.raw,
      html: renderLatexToken(token.raw),
      className: 'katex-preview',
      style: 'cursor: text; display: inline-block;',
      contentEditable: false,
    })
  },
  renderFloatingPreview(token) {
    return createElement('span', {
      dangerouslySetInnerHTML: { __html: renderLatexToken(token.raw) },
    })
  },
}

const ANNOTATION_NOTE_PLUGINS: TextEditorPlugin[] = [annotationLatexPlugin]

type AnnotationNoteEditorProps = {
  autoFocus?: boolean
  className?: string
  disabled?: boolean
  editing?: boolean
  label?: string
  onBlur?: (value: string) => void
  onChange: (value: string) => void
  onEscape?: () => void
  onStartEditing?: () => void
  placeholder?: string
  value: string
}

export function AnnotationNoteEditor({
  autoFocus = false,
  className,
  disabled = false,
  editing = true,
  label = 'Annotation note',
  onBlur,
  onChange,
  onEscape,
  onStartEditing,
  placeholder = 'Add a note',
  value,
}: AnnotationNoteEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const latestValueRef = useRef(value)
  latestValueRef.current = value

  const rootClassName = useMemo(() => {
    return [
      'annotation-note-editor',
      editing ? 'is-editing' : 'is-preview',
      disabled ? 'is-disabled' : '',
      className ?? '',
    ].filter(Boolean).join(' ')
  }, [className, disabled, editing])

  useEffect(() => {
    if (!editing) return

    const editable = rootRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')
    if (!editable) return

    editable.setAttribute('role', 'textbox')
    editable.setAttribute('aria-label', label)
    editable.setAttribute('aria-multiline', 'true')

    if (disabled) {
      editable.setAttribute('aria-disabled', 'true')
    } else {
      editable.removeAttribute('aria-disabled')
    }

    if (!autoFocus || disabled) return

    const frameId = window.requestAnimationFrame(() => {
      editable.focus()

      const selection = document.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editable)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [autoFocus, disabled, editing, label])

  function handleBeforeInput(event: FormEvent<HTMLDivElement>) {
    if (!disabled) return

    event.preventDefault()
    event.stopPropagation()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (event.key === 'Escape' && onEscape) {
      event.preventDefault()
      event.stopPropagation()
      onEscape()
    }
  }

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-empty={value.trim() ? undefined : 'true'}
      data-disabled={disabled ? 'true' : undefined}
      onBeforeInput={handleBeforeInput}
      onKeyDown={handleKeyDown}
    >
      {editing && placeholder ? (
        <span className="annotation-note-placeholder" aria-hidden="true">
          {placeholder}
        </span>
      ) : null}
      <TextEditor
        value={value}
        onChange={(nextValue) => {
          if (!disabled) onChange(nextValue)
        }}
        onBlur={(nextValue) => {
          if (!disabled) onBlur?.(nextValue)
        }}
        isEditing={editing}
        onStartEditing={disabled ? undefined : onStartEditing}
        plugins={ANNOTATION_NOTE_PLUGINS}
        preserveHeightOnEdit={false}
      >
        <span className="annotation-note-preview-text">
          {latestValueRef.current}
        </span>
      </TextEditor>
    </div>
  )
}
