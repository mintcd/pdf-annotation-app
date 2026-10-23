import assert from 'node:assert/strict'
import test from 'node:test'
import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { exportAnnotatedPdf } from '../lib/pdfExport'
import type { PdfOutlineNode } from '../lib/pdfGeometry'
import { positionFromGeometry, serializePdfPosition, type PdfAnnotationRow } from '../utils/pdfSync'

async function createSource() {
  const document = await PDFDocument.create()
  const page = document.addPage([500, 700])
  document.addPage([500, 700])
  page.setCropBox(45, 60, 300, 500)
  page.setRotation(degrees(90))
  page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2))
  page.node.addAnnot(document.context.register(document.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [60, 80, 80, 100],
    NM: PDFString.of('source-note'), Contents: PDFHexString.fromText('Original note'),
  })))
  const root = document.context.obj({ Type: 'Outlines', Count: 1 })
  const rootRef = document.context.register(root)
  const first = document.context.register(document.context.obj({
    Title: PDFHexString.fromText('Source bookmark'), Parent: rootRef, Dest: [page.ref, 'Fit'],
  }))
  root.set(PDFName.of('First'), first)
  root.set(PDFName.of('Last'), first)
  document.catalog.set(PDFName.of('Outlines'), rootRef)
  return document.save()
}

function row(pageIndex = 0): PdfAnnotationRow {
  const rect = { origin: { x: 19, y: 33 }, size: { width: 64, height: 12 } }
  return {
    id: 'highlight-1', document_id: 'test-document', page_index: pageIndex,
    text: 'Highlighted text', color: '#87ceeb', comment: 'A note with Unicode: café 中文',
    created_at: '2026-10-18T09:10:11.000Z', updated_at: '2026-10-18T10:11:12.000Z',
    position: serializePdfPosition(positionFromGeometry({ pageIndex, rect, segmentRects: [rect] })),
  }
}

function numbers(array: PDFArray): number[] {
  return array.asArray().map((value) => (value as PDFNumber).asNumber())
}

test('an unchanged export preserves the original PDF bytes exactly', async () => {
  const source = await createSource()
  const output = await exportAnnotatedPdf(source, [])
  assert.deepEqual(output, source)
  assert.notEqual(output, source)
})

test('export writes portable highlight coordinates, metadata and appearance while preserving source objects', async () => {
  const output = await exportAnnotatedPdf(await createSource(), [row()])
  const document = await PDFDocument.load(output)
  const annotations = document.getPage(0).node.Annots()
  assert.equal(annotations.size(), 2)
  const original = annotations.lookup(0, PDFDict)
  assert.equal(original.lookup(PDFName.of('Contents'), PDFHexString).decodeText(), 'Original note')
  const annotation = annotations.lookup(1, PDFDict)
  assert.equal(annotation.lookup(PDFName.of('Subtype'), PDFName).asString(), '/Highlight')
  assert.deepEqual(numbers(annotation.lookup(PDFName.of('Rect'), PDFArray)), [64, 515, 128, 527])
  assert.deepEqual(numbers(annotation.lookup(PDFName.of('QuadPoints'), PDFArray)), [64, 527, 128, 527, 64, 515, 128, 515])
  assert.deepEqual(numbers(annotation.lookup(PDFName.of('C'), PDFArray)), [135 / 255, 206 / 255, 235 / 255])
  assert.equal(annotation.lookup(PDFName.of('NM'), PDFHexString).decodeText(), row().id)
  assert.equal(annotation.lookup(PDFName.of('Contents'), PDFHexString).decodeText(), row().comment)
  assert.equal(annotation.lookup(PDFName.of('F'), PDFNumber).asNumber(), 4)
  assert.equal(annotation.lookup(PDFName.of('CreationDate'), PDFString).decodeDate().toISOString(), row().created_at)
  assert.equal(annotation.lookup(PDFName.of('M'), PDFString).decodeDate().toISOString(), row().updated_at)
  assert.ok(annotation.lookup(PDFName.of('AP'), PDFDict).has(PDFName.of('N')))
  const originalOutline = document.catalog.lookup(PDFName.of('Outlines'), PDFDict).lookup(PDFName.of('First'), PDFDict)
  assert.equal(originalOutline.lookup(PDFName.of('Title'), PDFHexString).decodeText(), 'Source bookmark')

  const loading = getDocument({ data: output.slice() })
  try {
    const readback = await loading.promise
    const page = await readback.getPage(1)
    const highlights = (await page.getAnnotations()).filter((annotation) => annotation.subtype === 'Highlight')
    assert.equal(highlights.length, 1)
    assert.equal(highlights[0].contentsObj.str, row().comment)
    assert.deepEqual(highlights[0].rect, [64, 515, 128, 527])
    const viewport = page.getViewport({ scale: 1 })
    const factory = readback.canvasFactory as { create: (width: number, height: number) => { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } }
    const { canvas, context } = factory.create(viewport.width, viewport.height)
    await page.render({ canvas, canvasContext: context, viewport, intent: 'print' }).promise
    const [x, y] = viewport.convertToViewportPoint(96, 521)
    const pixel = context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data
    assert.ok(pixel[0] < 250 && pixel[2] > pixel[0], `Expected blue highlight in print output; got ${Array.from(pixel)}`)
  } finally {
    await loading.destroy()
  }
})

test('re-export replaces an existing row by NM, including page moves, without duplicating unrelated annotations', async () => {
  const first = await exportAnnotatedPdf(await createSource(), [row(), row()])
  const moved = { ...row(1), color: '#fff475' }
  const second = await exportAnnotatedPdf(first, [moved])
  const document = await PDFDocument.load(second)
  assert.equal(document.getPage(0).node.Annots().size(), 1)
  assert.equal(document.getPage(1).node.Annots().size(), 1)
  const annotation = document.getPage(1).node.Annots().lookup(0, PDFDict)
  assert.equal(annotation.lookup(PDFName.of('NM'), PDFHexString).decodeText(), moved.id)
  assert.deepEqual(numbers(annotation.lookup(PDFName.of('C'), PDFArray)), [1, 244 / 255, 117 / 255])
})

test('explicit outline edits produce a nested tree with destinations, sibling links and Unicode titles', async () => {
  const outline: PdfOutlineNode[] = [
    { title: 'Part I: café', children: [
      { title: 'Chapter 1', pageIndex: 0, children: [] },
      { title: 'Chapter 2', pageIndex: 1, children: [
        { title: 'Reference', uri: 'https://example.com/reference', children: [] },
      ] },
    ] },
    { title: 'Appendix', pageIndex: 1, children: [] },
  ]
  const output = await exportAnnotatedPdf(await createSource(), [], outline)
  const document = await PDFDocument.load(output)
  const root = document.catalog.lookup(PDFName.of('Outlines'), PDFDict)
  assert.equal(root.lookup(PDFName.of('Count'), PDFNumber).asNumber(), 5)
  const first = root.lookup(PDFName.of('First'), PDFDict)
  assert.equal(first.lookup(PDFName.of('Title'), PDFHexString).decodeText(), 'Part I: café')
  assert.equal(first.lookup(PDFName.of('Count'), PDFNumber).asNumber(), 3)
  const appendix = first.lookup(PDFName.of('Next'), PDFDict)
  assert.equal(appendix.lookup(PDFName.of('Title'), PDFHexString).decodeText(), 'Appendix')
  assert.equal(appendix.get(PDFName.of('Prev')).toString(), root.get(PDFName.of('First')).toString())
  const chapter1 = first.lookup(PDFName.of('First'), PDFDict)
  assert.equal(chapter1.lookup(PDFName.of('Dest'), PDFArray).get(0).toString(), document.getPage(0).ref.toString())
  const chapter2 = chapter1.lookup(PDFName.of('Next'), PDFDict)
  assert.equal(chapter2.lookup(PDFName.of('Dest'), PDFArray).get(0).toString(), document.getPage(1).ref.toString())
  const reference = chapter2.lookup(PDFName.of('First'), PDFDict)
  assert.equal(reference.lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString).decodeText(), 'https://example.com/reference')

  const loading = getDocument({ data: output.slice() })
  try {
    const readback = await loading.promise
    const readOutline = await readback.getOutline()
    assert.equal(readOutline.length, 2)
    assert.equal(readOutline[0].items[1].items[0].title, 'Reference')
    assert.equal(readOutline[0].items[1].items[0].url, 'https://example.com/reference')
  } finally {
    await loading.destroy()
  }
  const cleared = await PDFDocument.load(await exportAnnotatedPdf(output, [], []))
  assert.equal(cleared.catalog.has(PDFName.of('Outlines')), false)
})
