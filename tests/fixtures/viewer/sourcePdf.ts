import { degrees, PDFDocument, PDFHexString, PDFName, rgb, StandardFonts } from 'pdf-lib'

/** Generate source bytes in memory: normal pages, a rotated CropBox, links, and nested outlines. */
export async function createBrowserPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const first = document.addPage([612, 792])
  const rotated = document.addPage([612, 792])
  const last = document.addPage([612, 792])
  first.drawText('Select this first page text for a highlight.', { x: 60, y: 700, size: 18, font })
  first.drawText('Jump to the final page', { x: 60, y: 600, size: 18, font, color: rgb(0, 0.2, 0.8) })
  first.drawRectangle({ x: 60, y: 450, width: 180, height: 90, color: rgb(0.8, 0.9, 1) })
  first.node.addAnnot(document.context.register(document.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [60, 592, 270, 622], Border: [0, 0, 0],
    Dest: [last.ref, 'Fit'],
  })))
  rotated.setCropBox(40, 50, 500, 650)
  rotated.setRotation(degrees(90))
  rotated.drawText('Rotated cropped page text.', { x: 120, y: 600, size: 18, font })
  last.drawText('Final page three.', { x: 60, y: 700, size: 20, font })
  const outlineRoot = document.context.obj({ Type: 'Outlines', Count: 3 })
  const outlineRootRef = document.context.register(outlineRoot)
  const chapter = document.context.obj({ Title: PDFHexString.fromText('First chapter'), Parent: outlineRootRef, Dest: [first.ref, 'Fit'], Count: 1 })
  const chapterRef = document.context.register(chapter)
  const childRef = document.context.register(document.context.obj({
    Title: PDFHexString.fromText('Rotated child'), Parent: chapterRef, Dest: [rotated.ref, 'Fit'],
  }))
  chapter.set(PDFName.of('First'), childRef)
  chapter.set(PDFName.of('Last'), childRef)
  const finalRef = document.context.register(document.context.obj({
    Title: PDFHexString.fromText('Last chapter'), Parent: outlineRootRef, Prev: chapterRef, Dest: [last.ref, 'Fit'],
  }))
  chapter.set(PDFName.of('Next'), finalRef)
  outlineRoot.set(PDFName.of('First'), chapterRef)
  outlineRoot.set(PDFName.of('Last'), finalRef)
  document.catalog.set(PDFName.of('Outlines'), outlineRootRef)
  return document.save()
}
