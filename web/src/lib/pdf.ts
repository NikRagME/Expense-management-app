/** Read positioned text from a PDF statement in the browser (pdf.js, loaded only when needed). */
import type { PdfPage } from '../../../shared/parsers/citiPdf';
import { extractPdfPages } from '../../../shared/parsers/pdfText';

export async function readPdf(data: Uint8Array): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return extractPdfPages(pdfjs.getDocument as never, data);
}

export const isPdf = (bytes: Uint8Array) => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // "%PDF"
