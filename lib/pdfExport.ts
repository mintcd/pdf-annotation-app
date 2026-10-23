import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFPage,
  type PDFRef,
} from 'pdf-lib'
import { normalizePdfPosition, type PdfAnnotationRow } from '../utils/pdfSync'
import { FALLBACK_HIGHLIGHT_COLOR, normalizeHexColor } from '../utils/highlightColors'
import { pdfRectToPageCoordinates, type PdfOutlineNode } from './pdfGeometry'

/** Add app highlights to the source PDF; omit outline to preserve the source bookmark tree. */
export async function exportAnnotatedPdf(
  data: Uint8Array,
  rows: readonly PdfAnnotationRow[],
  outline?: readonly PdfOutlineNode[],
): Promise<Uint8Array> {
  if (rows.length === 0 && outline === undefined) return data.slice()
  const document = await PDFDocument.load(data, { updateMetadata: false })
  const pages = document.getPages()
  const uniqueRows = new Map(rows.map((row) => [row.id, row]))
  const validRows = [...uniqueRows.values()].flatMap((row) => {
    const position = normalizePdfPosition(row.position)
    if (!position || !pages[position.pageIndex]) return []
    return [{ row, position }]
  })
  const replacingIds = new Set(validRows.map(({ row }) => row.id))

  // An exported PDF can be opened again. Replace matching NM values on every page,
  // including a highlight whose page changed, while retaining unrelated annotations.
  for (const page of pages) {
    const annotations = page.node.Annots()
    if (!annotations) continue
    for (let index = annotations.size() - 1; index >= 0; index -= 1) {
      const annotation = document.context.lookup(annotations.get(index))
      if (!(annotation instanceof PDFDict)) continue
      const name = annotation.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString)
      if (name && replacingIds.has(name.decodeText())) annotations.remove(index)
    }
  }

  for (const { row, position } of validRows) {
    const page = pages[position.pageIndex]
    const viewBox = visiblePageBox(page)
    const segments = position.segmentRects.length > 0 ? position.segmentRects : [position.rect]
    const rectangles = segments.map((rect) => pdfRectToPageCoordinates(rect, viewBox))
    const left = Math.min(...rectangles.map((rect) => rect[0]))
    const bottom = Math.min(...rectangles.map((rect) => rect[1]))
    const right = Math.max(...rectangles.map((rect) => rect[2]))
    const top = Math.max(...rectangles.map((rect) => rect[3]))
    const color = colorComponents(row.color)
    const quadPoints = rectangles.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1])
    const context = document.context
    const appearance = context.register(context.flateStream([
      'q /GS0 gs',
      `${color.join(' ')} rg`,
      ...rectangles.map(([x1, y1, x2, y2]) => `${x1} ${y1} ${x2 - x1} ${y2 - y1} re f`),
      'Q',
    ].join('\n'), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [left, bottom, right, top],
      Resources: { ExtGState: { GS0: { Type: 'ExtGState', BM: 'Multiply', ca: 0.35 } } },
    }))
    const annotation = context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      P: page.ref,
      Rect: [left, bottom, right, top],
      QuadPoints: quadPoints,
      NM: PDFHexString.fromText(row.id),
      C: color,
      CA: 0.35,
      Contents: PDFHexString.fromText(row.comment ?? ''),
      T: PDFHexString.fromText('PDF Annotator'),
      Subj: PDFHexString.fromText('Highlight'),
      F: 4, // Print flag, without locking the exported annotation.
      AP: { N: appearance },
    })
    setDate(annotation, 'CreationDate', row.created_at)
    setDate(annotation, 'M', row.updated_at)
    page.node.addAnnot(context.register(annotation))
  }

  if (outline !== undefined) replaceOutline(document, outline)
  return document.save({ updateFieldAppearances: false })
}

/** Match PDF.js: the visible page is the intersection of MediaBox and CropBox. */
function visiblePageBox(page: PDFPage): number[] {
  const media = page.getMediaBox()
  const crop = page.getCropBox()
  const left = Math.max(media.x, crop.x)
  const bottom = Math.max(media.y, crop.y)
  const right = Math.min(media.x + media.width, crop.x + crop.width)
  const top = Math.min(media.y + media.height, crop.y + crop.height)
  return left < right && bottom < top
    ? [left, bottom, right, top]
    : [media.x, media.y, media.x + media.width, media.y + media.height]
}

function colorComponents(value: string): number[] {
  const color = normalizeHexColor(value) ?? FALLBACK_HIGHLIGHT_COLOR
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
}

function setDate(dictionary: PDFDict, key: string, value: string) {
  const date = new Date(value)
  if (Number.isFinite(date.getTime())) dictionary.set(PDFName.of(key), PDFString.fromDate(date))
}

function replaceOutline(document: PDFDocument, nodes: readonly PdfOutlineNode[]) {
  const context = document.context
  if (nodes.length === 0) {
    document.catalog.delete(PDFName.of('Outlines'))
    return
  }
  const root = context.obj({ Type: 'Outlines' })
  const rootRef = context.register(root)
  const pages = document.getPages()

  const writeChildren = (children: readonly PdfOutlineNode[], parent: PDFDict, parentRef: PDFRef): number => {
    const entries = children.map((node) => {
      const dictionary = context.obj({ Title: PDFHexString.fromText(node.title), Parent: parentRef })
      const ref = context.register(dictionary)
      if (Number.isInteger(node.pageIndex) && pages[node.pageIndex]) {
        dictionary.set(PDFName.of('Dest'), context.obj([pages[node.pageIndex].ref, 'Fit']))
      } else if (node.uri) {
        // URI actions use an ASCII byte string; UTF-16 text strings produce invalid links.
        const uri = node.uri.replace(/[^\x00-\x7f]+/g, (value) => encodeURI(value))
        dictionary.set(PDFName.of('A'), context.obj({ S: 'URI', URI: PDFString.of(uri) }))
      }
      return { node, dictionary, ref }
    })
    let count = entries.length
    for (let index = 0; index < entries.length; index += 1) {
      const { node, dictionary, ref } = entries[index]
      if (index > 0) dictionary.set(PDFName.of('Prev'), entries[index - 1].ref)
      if (index + 1 < entries.length) dictionary.set(PDFName.of('Next'), entries[index + 1].ref)
      const descendants = writeChildren(node.children, dictionary, ref)
      if (descendants > 0) dictionary.set(PDFName.of('Count'), PDFNumber.of(descendants))
      count += descendants
    }
    if (entries.length > 0) {
      parent.set(PDFName.of('First'), entries[0].ref)
      parent.set(PDFName.of('Last'), entries[entries.length - 1].ref)
    }
    return count
  }

  root.set(PDFName.of('Count'), PDFNumber.of(writeChildren(nodes, root, rootRef)))
  document.catalog.set(PDFName.of('Outlines'), rootRef)
}
