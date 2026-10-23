/** Version-1 annotation coordinates: PDF units from the visible page's unrotated top-left. */
export type PdfRect = {
  origin: { x: number; y: number }
  size: { width: number; height: number }
}

export type PdfSelectionGeometry = {
  pageIndex: number
  rect: PdfRect
  segmentRects: PdfRect[]
}

export type PdfOutlineNode = {
  title: string
  pageIndex?: number
  uri?: string
  children: PdfOutlineNode[]
}

/** The subset shared by PDF.js PageViewport versions; no rendering dependency is needed here. */
export type PdfViewportLike = {
  viewBox: readonly number[]
  width: number
  height: number
  convertToPdfPoint(x: number, y: number): number[]
  convertToViewportPoint(x: number, y: number): number[]
}

export type ClientRectLike = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>

export type PdfSelectionPage = {
  pageIndex: number
  viewport: PdfViewportLike
  /** Client-space bounds of the page content (excluding its border and margin). */
  bounds: ClientRectLike
}

export function pdfRectToViewportRect(rect: PdfRect, viewport: PdfViewportLike): PdfRect {
  const [left, bottom, right, top] = pdfRectToPageCoordinates(rect, viewport.viewBox)
  return rectFromPoints([
    viewport.convertToViewportPoint(left, bottom),
    viewport.convertToViewportPoint(right, top),
  ])
}

export function viewportRectToPdfRect(rect: PdfRect, viewport: PdfViewportLike): PdfRect {
  const points = [
    viewport.convertToPdfPoint(rect.origin.x, rect.origin.y),
    viewport.convertToPdfPoint(rect.origin.x + rect.size.width, rect.origin.y + rect.size.height),
  ].map(([x, y]) => [x - viewport.viewBox[0], viewport.viewBox[3] - y])
  return rectFromPoints(points)
}

/** Convert to absolute bottom-left PDF page coordinates, including a nonzero CropBox origin. */
export function pdfRectToPageCoordinates(rect: PdfRect, viewBox: readonly number[]): number[] {
  const left = viewBox[0] + rect.origin.x
  const top = viewBox[3] - rect.origin.y
  return [left, top - rect.size.height, left + rect.size.width, top]
}

export function positionToViewportRects(
  position: Pick<PdfSelectionGeometry, 'rect' | 'segmentRects'>,
  viewport: PdfViewportLike,
): PdfRect[] {
  const rects = position.segmentRects.length > 0 ? position.segmentRects : [position.rect]
  return rects.map((rect) => pdfRectToViewportRect(rect, viewport))
}

/** Clip DOM selection fragments per page, undo CSS scaling, and persist document-space geometry. */
export function geometryFromSelectionRects(
  rects: readonly ClientRectLike[],
  pages: readonly PdfSelectionPage[],
): PdfSelectionGeometry[] {
  const geometry: PdfSelectionGeometry[] = []
  for (const { pageIndex, viewport, bounds } of pages) {
    if (bounds.width <= 0 || bounds.height <= 0) continue
    const segmentRects: PdfRect[] = []
    for (const rect of rects) {
      const left = Math.max(rect.left, bounds.left)
      const top = Math.max(rect.top, bounds.top)
      const right = Math.min(rect.left + rect.width, bounds.left + bounds.width)
      const bottom = Math.min(rect.top + rect.height, bounds.top + bounds.height)
      if (right - left <= 0.5 || bottom - top <= 0.5) continue
      const converted = viewportRectToPdfRect({
        origin: {
          x: (left - bounds.left) * viewport.width / bounds.width,
          y: (top - bounds.top) * viewport.height / bounds.height,
        },
        size: {
          width: (right - left) * viewport.width / bounds.width,
          height: (bottom - top) * viewport.height / bounds.height,
        },
      }, viewport)
      if (!segmentRects.some((existing) => sameRect(existing, converted))) segmentRects.push(converted)
    }
    if (segmentRects.length === 0) continue
    geometry.push({ pageIndex, rect: boundingRect(segmentRects), segmentRects })
  }
  return geometry
}

function sameRect(left: PdfRect, right: PdfRect): boolean {
  return Math.abs(left.origin.x - right.origin.x) < 0.01
    && Math.abs(left.origin.y - right.origin.y) < 0.01
    && Math.abs(left.size.width - right.size.width) < 0.01
    && Math.abs(left.size.height - right.size.height) < 0.01
}

function boundingRect(rects: readonly PdfRect[]): PdfRect {
  return rectFromPoints(rects.flatMap((rect) => [
    [rect.origin.x, rect.origin.y],
    [rect.origin.x + rect.size.width, rect.origin.y + rect.size.height],
  ]))
}

function rectFromPoints(points: readonly number[][]): PdfRect {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    origin: { x, y },
    size: { width: Math.max(...xs) - x, height: Math.max(...ys) - y },
  }
}
