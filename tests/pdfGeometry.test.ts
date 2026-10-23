import assert from 'node:assert/strict'
import test from 'node:test'
import { degrees, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  geometryFromSelectionRects,
  pdfRectToPageCoordinates,
  pdfRectToViewportRect,
  positionToViewportRects,
  viewportRectToPdfRect,
  type PdfRect,
} from '../lib/pdfGeometry'
import { normalizePdfPosition, positionFromGeometry, serializePdfPosition } from '../utils/pdfSync'

const storedRect: PdfRect = { origin: { x: 19, y: 33 }, size: { width: 64, height: 12 } }

function assertRect(actual: PdfRect, expected: PdfRect) {
  for (const [value, target] of [
    [actual.origin.x, expected.origin.x],
    [actual.origin.y, expected.origin.y],
    [actual.size.width, expected.size.width],
    [actual.size.height, expected.size.height],
  ]) assert.ok(Math.abs(value - target) < 1e-8, `${value} differs from ${target}`)
}

for (const rotation of [0, 90, 180, 270]) {
  for (const userUnit of [1, 3]) {
    test(`v1 PDF coordinates survive crop offset, rotation ${rotation}, UserUnit ${userUnit}, and CSS zoom`, async () => {
      const source = await PDFDocument.create()
      const page = source.addPage([500, 700])
      page.setCropBox(45, 60, 300, 500)
      page.setRotation(degrees(rotation))
      page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit))
      const loading = getDocument({ data: await source.save() })
      try {
        const document = await loading.promise
        const pdfPage = await document.getPage(1)
        const viewport = pdfPage.getViewport({ scale: 2.25 })
        assert.deepEqual(viewport.viewBox, [45, 60, 345, 560])
        assert.deepEqual(pdfRectToPageCoordinates(storedRect, viewport.viewBox), [64, 515, 128, 527])
        const displayed = pdfRectToViewportRect(storedRect, viewport)
        assertRect(viewportRectToPdfRect(displayed, viewport), storedRect)
        assertRect(positionToViewportRects({ rect: storedRect, segmentRects: [] }, viewport)[0], displayed)

        const bounds = { left: 100, top: 80, width: viewport.width * 0.75, height: viewport.height * 0.75 }
        const selection = {
          left: bounds.left + displayed.origin.x * 0.75,
          top: bounds.top + displayed.origin.y * 0.75,
          width: displayed.size.width * 0.75,
          height: displayed.size.height * 0.75,
        }
        const geometry = geometryFromSelectionRects([selection, selection], [{ pageIndex: 4, viewport, bounds }])
        assert.equal(geometry.length, 1)
        assert.equal(geometry[0].pageIndex, 4)
        assert.equal(geometry[0].segmentRects.length, 1)
        assertRect(geometry[0].rect, storedRect)
        const position = normalizePdfPosition(serializePdfPosition(positionFromGeometry(geometry[0])))
        assertRect(position.rect, storedRect)
      } finally {
        await loading.destroy()
      }
    })
  }
}

test('selection fragments are clipped and grouped across pages without using inter-page gaps', async () => {
  const source = await PDFDocument.create()
  source.addPage([100, 100])
  const loading = getDocument({ data: await source.save() })
  try {
    const document = await loading.promise
    const page = await document.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const geometry = geometryFromSelectionRects([
      { left: 15, top: 90, width: 70, height: 40 },
      { left: 15, top: 135, width: 70, height: 12 },
    ], [
      { pageIndex: 0, viewport, bounds: { left: 0, top: 0, width: 100, height: 100 } },
      { pageIndex: 1, viewport, bounds: { left: 0, top: 120, width: 100, height: 100 } },
    ])
    assert.equal(geometry.length, 2)
    assertRect(geometry[0].rect, { origin: { x: 15, y: 90 }, size: { width: 70, height: 10 } })
    assertRect(geometry[1].rect, { origin: { x: 15, y: 0 }, size: { width: 70, height: 27 } })
    assert.equal(geometry[1].segmentRects.length, 2)
  } finally {
    await loading.destroy()
  }
})

test('malformed, nonfinite, negative-size and unsupported stored geometry is rejected', () => {
  const valid = positionFromGeometry({ pageIndex: 0, rect: storedRect, segmentRects: [storedRect] })
  assert.ok(normalizePdfPosition(JSON.stringify(valid)))
  assert.equal(normalizePdfPosition('{'), null)
  assert.equal(normalizePdfPosition({ ...valid, pageIndex: -1 } as never), null)
  assert.equal(normalizePdfPosition({ ...valid, version: 2 } as never), null)
  assert.equal(normalizePdfPosition({ ...valid, rect: { origin: { x: Infinity, y: 0 }, size: { width: 1, height: 1 } } } as never), null)
  assert.equal(normalizePdfPosition({ ...valid, rect: { origin: { x: 0, y: 0 }, size: { width: -1, height: 1 } } } as never), null)
})
