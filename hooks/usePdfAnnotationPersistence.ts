import type { PdfAnnotationObject } from '@embedpdf/models'
import { useAnnotation } from '@embedpdf/plugin-annotation/react'
import { useEffect, useRef, useState } from 'react'

export const PDF_ANNOTATION_SOURCE = 'mintcd-pdf-annotator'

type StoredAnnotations = {
  version: 1;
  annotations: PdfAnnotationObject[];
}

export type PersistenceStatus = 'loading' | 'saved' | 'error'

function storageKey(documentKey: string): string {
  return `pdf-annotator:${documentKey}:annotations:v1`
}

function reviveAnnotation(annotation: PdfAnnotationObject): PdfAnnotationObject {
  const created = annotation.created
  const modified = annotation.modified

  return {
    ...annotation,
    ...(typeof created === 'string' ? { created: new Date(created) } : {}),
    ...(typeof modified === 'string' ? { modified: new Date(modified) } : {}),
  } as PdfAnnotationObject
}

function isManagedAnnotation(annotation: PdfAnnotationObject, documentKey: string): boolean {
  if (!annotation.custom || typeof annotation.custom !== 'object') return false
  const custom = annotation.custom as Record<string, unknown>
  return custom.source === PDF_ANNOTATION_SOURCE && custom.documentKey === documentKey
}

export function usePdfAnnotationPersistence(documentId: string, documentKey: string) {
  const { provides: annotationScope, state } = useAnnotation(documentId)
  const pendingImportIds = useRef<Set<string>>(new Set())
  const [isHydrated, setIsHydrated] = useState(false)
  const [status, setStatus] = useState<PersistenceStatus>('loading')

  useEffect(() => {
    pendingImportIds.current = new Set()
    setIsHydrated(false)
    setStatus('loading')
  }, [documentId, documentKey])

  useEffect(() => {
    if (!annotationScope || isHydrated) return

    try {
      const raw = localStorage.getItem(storageKey(documentKey))
      const stored = raw ? JSON.parse(raw) as StoredAnnotations : null
      const annotations = stored?.version === 1 && Array.isArray(stored.annotations)
        ? stored.annotations.map(reviveAnnotation)
        : []

      pendingImportIds.current = new Set(annotations.map((annotation) => annotation.id))
      if (annotations.length > 0) {
        annotationScope.importAnnotations(annotations.map((annotation) => ({ annotation })))
      }
      setIsHydrated(true)
      setStatus('saved')
    } catch (error) {
      console.error('Failed to restore PDF annotations', error)
      setIsHydrated(true)
      setStatus('error')
    }
  }, [annotationScope, documentKey, isHydrated])

  useEffect(() => {
    if (!isHydrated) return

    const annotations = Object.values(state.byUid)
      .map((tracked) => tracked.object)
      .filter((annotation) => isManagedAnnotation(annotation, documentKey))

    if (
      pendingImportIds.current.size > 0
      && Array.from(pendingImportIds.current).some((id) => !state.byUid[id])
    ) {
      return
    }
    pendingImportIds.current.clear()

    try {
      const payload: StoredAnnotations = { version: 1, annotations }
      localStorage.setItem(storageKey(documentKey), JSON.stringify(payload))
      setStatus('saved')
    } catch (error) {
      console.error('Failed to persist PDF annotations', error)
      setStatus('error')
    }
  }, [documentKey, isHydrated, state.byUid])

  return { status }
}
