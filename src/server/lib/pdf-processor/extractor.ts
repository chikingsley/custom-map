import { PDFDocument } from "pdf-lib";

export async function extractPage(
  inputPath: string,
  pageNumber: number
): Promise<Uint8Array> {
  const pdfBytes = await Bun.file(inputPath).arrayBuffer();
  const pdfDoc = await PDFDocument.load(pdfBytes);

  const newPdf = await PDFDocument.create();

  const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageNumber - 1]);
  newPdf.addPage(copiedPage);

  const pageBytes = await newPdf.save();
  return pageBytes;
}
