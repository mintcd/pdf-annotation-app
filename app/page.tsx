import Dashboard from '../components/Dashboard'
import PdfDocumentPage from '../components/PdfDocumentPage'

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export const metadata = {
  title: 'PDF Annotation Studio',
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const resolved = { ...(await searchParams) }
  const url = first(resolved.url).trim()

  if (!url) return <Dashboard />

  return (
    <PdfDocumentPage
      url={url}
      initialAnnotationId={first(resolved.annotation).trim() || undefined}
    />
  )
}
