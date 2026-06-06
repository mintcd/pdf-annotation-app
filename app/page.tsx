import PDFViewer from './components/PDFViewer'

export default function Page() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div>
        <h1 className="text-2xl font-bold mb-4">PDF Annotation App — Scaffold</h1>
        <PDFViewer />
      </div>
    </main>
  )
}
