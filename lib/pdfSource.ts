export type RemotePdfSource = {
  kind: 'remote';
  documentKey: string;
  name: string;
  originalUrl: string;
};

export type LocalPdfSource = {
  kind: 'local';
  buffer: ArrayBuffer;
  documentKey: string;
  name: string;
};

export type PdfSource = RemotePdfSource | LocalPdfSource;

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safePdfName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const name = cleaned || 'document.pdf';
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

export function createRemotePdfSource(rawUrl: string): RemotePdfSource {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Enter an http:// or https:// PDF URL.');
  }

  parsed.hash = '';
  const originalUrl = parsed.toString();
  const pathName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) ?? '');

  return {
    kind: 'remote',
    documentKey: `url-${fnv1a(originalUrl)}`,
    name: safePdfName(pathName || parsed.hostname),
    originalUrl,
  };
}

export async function createLocalPdfSource(file: File): Promise<LocalPdfSource> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer.slice(0));
  const hash = Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return {
    kind: 'local',
    buffer,
    documentKey: `sha256-${hash}`,
    name: safePdfName(file.name),
  };
}

export function sourceForEmbedPdf(source: PdfSource) {
  if (source.kind === 'local') {
    return {
      buffer: source.buffer,
      name: source.name,
      documentId: source.documentKey,
    } as const;
  }

  return {
    url: `/api/pdf?url=${encodeURIComponent(source.originalUrl)}`,
    name: source.name,
    documentId: source.documentKey,
    mode: 'full-fetch' as const,
  };
}
