/** Positioned text from a PDF via pdf.js (passed in, so browser and tests can use different builds). */
import type { PdfPage } from './citiPdf';

interface PdfJsLike {
  // Minimal shape of pdf.js' getDocument we rely on.
  (src: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> }> };
}

export async function extractPdfPages(getDocument: PdfJsLike, data: Uint8Array): Promise<PdfPage[]> {
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(
      (content.items as { str?: string; transform?: number[] }[])
        .filter((i) => typeof i.str === 'string' && i.transform)
        .map((i) => ({ str: i.str!, x: i.transform![4], y: i.transform![5] })),
    );
  }
  return pages;
}
