"use client"
import { useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`

export default function PDFViewer() {
  const [file, setFile] = useState<File | null>(null)
  const [numPages, setNumPages] = useState<number | null>(null)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
  }

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages)
  }

  return (
    <div className="p-4 w-full max-w-4xl">
      <div className="mb-4">
        <input type="file" accept="application/pdf" onChange={onFileChange} />
      </div>
      {file && (
        <div>
          <Document file={file} onLoadSuccess={onDocumentLoadSuccess}>
            {Array.from(new Array(numPages ?? 0), (el, index) => (
              <Page key={`page_${index + 1}`} pageNumber={index + 1} width={800} />
            ))}
          </Document>
        </div>
      )}
      {!file && <div className="text-muted">Choose a PDF to begin</div>}
    </div>
  )
}
