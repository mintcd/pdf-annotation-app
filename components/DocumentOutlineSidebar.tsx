'use client'

import type { PdfOutlineNode } from '../lib/pdfGeometry'
import {
  BookOpen,
  CornerDownRight,
  ListTree,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { Badge } from './design-system/badge'
import { Button } from './design-system/button'
import { IconButton } from './design-system/icon-button'
import { Panel, PanelBody, PanelFooter, PanelHeader } from './design-system/panel'

type DocumentOutlineSidebarProps = {
  outline: PdfOutlineNode[]
  loading: boolean
  error?: string
  currentPage: number
  totalPages: number
  onOutlineChange: (next: PdfOutlineNode[]) => void
  onClose: () => void
  onPageJump: (pageNumber: number) => void
}

type BookmarkTarget =
  | { type: 'page'; pageIndex: number }
  | { type: 'uri'; uri: string }

type OutlineDraft = {
  mode: 'sibling' | 'child' | 'edit'
  targetPath: number[] | null
  title: string
  pageDraft: string
  error: string
}

export default function DocumentOutlineSidebar({
  outline: bookmarks,
  loading,
  error,
  currentPage,
  totalPages,
  onOutlineChange,
  onClose,
  onPageJump,
}: DocumentOutlineSidebarProps) {
  const [selectedPath, setSelectedPath] = useState<number[] | null>(null)
  const [draft, setDraft] = useState<OutlineDraft | null>(null)
  const status = loading ? 'loading' : error ? 'error' : 'ready'

  useEffect(() => {
    if (loading) {
      setSelectedPath(null)
      setDraft(null)
    }
  }, [loading])

  const itemCount = useMemo(() => countBookmarks(bookmarks), [bookmarks])
  const selectedBookmark = selectedPath ? getBookmarkAtPath(bookmarks, selectedPath) : null
  const pageCount = Math.max(totalPages, 1)

  const startDraft = (mode: OutlineDraft['mode']) => {
    if ((mode === 'child' || mode === 'edit') && !selectedPath) return

    const bookmark = mode === 'edit' ? selectedBookmark : null
    const pageTarget = bookmark ? getBookmarkTarget(bookmark) : null
    const draftPage = Math.min(Math.max(currentPage || 1, 1), pageCount)

    setDraft({
      mode,
      targetPath: selectedPath ? [...selectedPath] : null,
      title: bookmark?.title || 'New outline',
      pageDraft: String(pageTarget?.type === 'page' ? pageTarget.pageIndex + 1 : draftPage),
      error: '',
    })
  }

  const saveDraft = () => {
    if (!draft) return

    const title = draft.title.trim()
    const pageNumber = Number.parseInt(draft.pageDraft, 10)
    if (!title) {
      setDraft({ ...draft, error: 'Enter an outline name.' })
      return
    }
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      setDraft({ ...draft, error: `Enter a page from 1 to ${pageCount}.` })
      return
    }

    const nextBookmark = createPageBookmark(title, pageNumber - 1)
    const nextBookmarks = updateBookmarkTree(bookmarks, draft, nextBookmark)
    if (!nextBookmarks) {
      setDraft({ ...draft, error: 'Select an outline entry first.' })
      return
    }

    onOutlineChange(nextBookmarks)
    setSelectedPath(resolveNextSelectedPath(draft, bookmarks))
    setDraft(null)
  }

  const deleteSelected = () => {
    if (!selectedPath || !selectedBookmark) return

    const hasChildren = (selectedBookmark.children?.length ?? 0) > 0
    const confirmed = window.confirm(
      hasChildren
        ? 'Delete this outline and its sub-outlines?'
        : 'Delete this outline?',
    )
    if (!confirmed) return

    const nextBookmarks = removeBookmarkAtPath(bookmarks, selectedPath)
    onOutlineChange(nextBookmarks)
    setSelectedPath(null)
    setDraft(null)
  }

  const activateTarget = (target: BookmarkTarget) => {
    if (target.type === 'uri') {
      return
    }

    const pageNumber = target.pageIndex + 1
    onPageJump(pageNumber)
  }

  return (
    <Panel
      as="aside"
      variant="glass"
      className="annotation-sidebar document-outline-sidebar"
      aria-label="PDF table of contents"
    >
      <PanelHeader className="sidebar-header">
        <div>
          <strong>Table of contents</strong>
          <Badge size="small">{status === 'ready' ? itemCount : '...'}</Badge>
        </div>
        <IconButton label="Close table of contents" size="small" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </PanelHeader>

      <PanelBody className="annotation-panel-body">
        <div className="outline-actions" aria-label="Table of contents actions">
          <Button
            variant="secondary"
            size="small"
            leadingIcon={<Plus aria-hidden="true" />}
            disabled={status !== 'ready'}
            onClick={() => startDraft('sibling')}
          >
            Add outline
          </Button>
          <Button
            variant="secondary"
            size="small"
            leadingIcon={<CornerDownRight aria-hidden="true" />}
            disabled={status !== 'ready' || !selectedBookmark}
            onClick={() => startDraft('child')}
          >
            Add sub-outline
          </Button>
          <IconButton
            label="Edit outline"
            size="small"
            disabled={status !== 'ready' || !selectedBookmark}
            onClick={() => startDraft('edit')}
          >
            <Pencil aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Delete outline"
            size="small"
            tone="danger"
            disabled={status !== 'ready' || !selectedBookmark}
            onClick={() => void deleteSelected()}
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
        </div>

        {draft && (
          <form
            className="outline-form"
            onSubmit={(event) => {
              event.preventDefault()
              void saveDraft()
            }}
          >
            <label>
              <span>Name</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value, error: '' })}
              />
            </label>
            <label>
              <span>Page</span>
              <input
                value={draft.pageDraft}
                inputMode="numeric"
                onChange={(event) => setDraft({
                  ...draft,
                  pageDraft: event.target.value.replace(/\D/g, ''),
                  error: '',
                })}
              />
            </label>
            {draft.error && <p className="outline-form-error">{draft.error}</p>}
            <div className="outline-form-actions">
              <Button
                type="submit"
                size="small"
                leadingIcon={<Save aria-hidden="true" />}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                size="small"
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {status === 'loading' && (
          <div className="empty-state">
            <ListTree size={22} aria-hidden="true" />
            <p>Loading table of contents...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="outline-error" role="alert">
            {error}
          </div>
        )}

        {status === 'ready' && bookmarks.length === 0 && (
          <div className="empty-state">
            <BookOpen size={22} aria-hidden="true" />
            <p>This PDF does not include a document outline.</p>
          </div>
        )}

        {status === 'ready' && bookmarks.length > 0 && (
          <OutlineList
            bookmarks={bookmarks}
            level={0}
            onActivate={activateTarget}
            onSelect={setSelectedPath}
            selectedPath={selectedPath}
          />
        )}
      </PanelBody>

      <PanelFooter className="sidebar-footer">
        Outline edits are included when you download this PDF.
      </PanelFooter>
    </Panel>
  )
}

function OutlineList({
  bookmarks,
  level,
  onActivate,
  onSelect,
  parentPath = [],
  selectedPath,
}: {
  bookmarks: PdfOutlineNode[]
  level: number
  onActivate: (target: BookmarkTarget) => void
  onSelect: (path: number[]) => void
  parentPath?: number[]
  selectedPath: number[] | null
}) {
  return (
    <ol className="outline-list">
      {bookmarks.map((bookmark, index) => {
        const path = [...parentPath, index]
        const target = getBookmarkTarget(bookmark)
        const children = bookmark.children ?? []
        const selected = pathsEqual(path, selectedPath)
        const key = `${path.join('.')}-${bookmark.title}`

        return (
          <li key={key} className="outline-item">
            <button
              className={`outline-row${selected ? ' is-selected' : ''}`}
              type="button"
              aria-pressed={selected}
              style={{ '--outline-indent': `${level * 14}px` } as CSSProperties}
              title={target ? getTargetTitle(target) : 'This entry has no page target'}
              onClick={() => {
                onSelect(path)
                if (target) onActivate(target)
              }}
            >
              <span>{bookmark.title || 'Untitled section'}</span>
              {target?.type === 'page' && <small>Page {target.pageIndex + 1}</small>}
              {target?.type === 'uri' && <small>Link</small>}
            </button>

            {children.length > 0 && (
              <OutlineList
                bookmarks={children}
                level={level + 1}
                onActivate={onActivate}
                onSelect={onSelect}
                parentPath={path}
                selectedPath={selectedPath}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

function getBookmarkTarget(bookmark: PdfOutlineNode): BookmarkTarget | null {
  if (bookmark.pageIndex !== undefined) return normalizePageTarget(bookmark.pageIndex)
  if (bookmark.uri) return { type: 'uri', uri: bookmark.uri }
  return null
}

function createPageBookmark(title: string, pageIndex: number): PdfOutlineNode {
  return {
    title,
    pageIndex,
    children: [],
  }
}

function updateBookmarkTree(
  bookmarks: PdfOutlineNode[],
  draft: OutlineDraft,
  bookmark: PdfOutlineNode,
): PdfOutlineNode[] | null {
  if (draft.mode === 'sibling') {
    if (!draft.targetPath) return [...cloneBookmarks(bookmarks), bookmark]
    return insertBookmarkSibling(bookmarks, draft.targetPath, bookmark)
  }

  if (draft.mode === 'child') {
    if (!draft.targetPath) return null
    return insertBookmarkChild(bookmarks, draft.targetPath, bookmark)
  }

  if (!draft.targetPath) return null
  return replaceBookmarkAtPath(bookmarks, draft.targetPath, (current) => ({
    ...current,
    title: bookmark.title,
    pageIndex: bookmark.pageIndex,
    uri: undefined,
  }))
}

function insertBookmarkSibling(
  bookmarks: PdfOutlineNode[],
  path: number[],
  bookmark: PdfOutlineNode,
): PdfOutlineNode[] {
  if (path.length === 1) {
    const next = cloneBookmarks(bookmarks)
    next.splice(path[0] + 1, 0, bookmark)
    return next
  }

  return replaceBookmarkAtPath(bookmarks, path.slice(0, -1), (parent) => {
    const childIndex = path[path.length - 1]
    const children = cloneBookmarks(parent.children ?? [])
    children.splice(childIndex + 1, 0, bookmark)
    return { ...parent, children }
  })
}

function insertBookmarkChild(
  bookmarks: PdfOutlineNode[],
  path: number[],
  bookmark: PdfOutlineNode,
): PdfOutlineNode[] {
  return replaceBookmarkAtPath(bookmarks, path, (parent) => ({
    ...parent,
    children: [...cloneBookmarks(parent.children ?? []), bookmark],
  }))
}

function replaceBookmarkAtPath(
  bookmarks: PdfOutlineNode[],
  path: number[],
  update: (bookmark: PdfOutlineNode) => PdfOutlineNode,
): PdfOutlineNode[] {
  return bookmarks.map((bookmark, index) => {
    if (index !== path[0]) return cloneBookmark(bookmark)
    if (path.length === 1) return update(cloneBookmark(bookmark))

    return {
      ...cloneBookmark(bookmark),
      children: replaceBookmarkAtPath(bookmark.children ?? [], path.slice(1), update),
    }
  })
}

function removeBookmarkAtPath(
  bookmarks: PdfOutlineNode[],
  path: number[],
): PdfOutlineNode[] {
  if (path.length === 1) {
    return cloneBookmarks(bookmarks).filter((_, index) => index !== path[0])
  }

  return replaceBookmarkAtPath(bookmarks, path.slice(0, -1), (parent) => ({
    ...parent,
    children: removeBookmarkAtPath(parent.children ?? [], [path[path.length - 1]]),
  }))
}

function getBookmarkAtPath(
  bookmarks: PdfOutlineNode[],
  path: number[],
): PdfOutlineNode | null {
  let currentList = bookmarks
  let current: PdfOutlineNode | undefined

  for (const index of path) {
    current = currentList[index]
    if (!current) return null
    currentList = current.children ?? []
  }

  return current ?? null
}

function resolveNextSelectedPath(
  draft: OutlineDraft,
  previousBookmarks: PdfOutlineNode[],
): number[] | null {
  if (draft.mode === 'edit') return draft.targetPath ? [...draft.targetPath] : null
  if (!draft.targetPath) return [previousBookmarks.length]
  if (draft.mode === 'child') {
    const target = getBookmarkAtPath(previousBookmarks, draft.targetPath)
    return [...draft.targetPath, target?.children?.length ?? 0]
  }

  return [
    ...draft.targetPath.slice(0, -1),
    draft.targetPath[draft.targetPath.length - 1] + 1,
  ]
}

function cloneBookmarks(bookmarks: PdfOutlineNode[]): PdfOutlineNode[] {
  return bookmarks.map(cloneBookmark)
}

function cloneBookmark(bookmark: PdfOutlineNode): PdfOutlineNode {
  return {
    ...bookmark,
    children: cloneBookmarks(bookmark.children),
  }
}

function normalizePageTarget(pageIndex: number): BookmarkTarget | null {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null
  return { type: 'page', pageIndex }
}

function getTargetTitle(target: BookmarkTarget): string {
  if (target.type === 'uri') return target.uri
  return `Go to page ${target.pageIndex + 1}`
}

function pathsEqual(left: number[], right: number[] | null): boolean {
  return !!right && left.length === right.length && left.every((value, index) => value === right[index])
}

function countBookmarks(bookmarks: PdfOutlineNode[]): number {
  return bookmarks.reduce((count, bookmark) => {
    return count + 1 + countBookmarks(bookmark.children ?? [])
  }, 0)
}
