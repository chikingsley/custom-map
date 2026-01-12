import { PDFDocument } from "pdf-lib";

export async function optimizePdf(
  inputPath: string,
  outputPath: string
): Promise<void> {
  console.log(`[Optimizer] Loading PDF: ${inputPath}`);

  const pdfBytes = await Bun.file(inputPath).arrayBuffer();
  const pdfDoc = await PDFDocument.load(pdfBytes);

  console.log(`[Optimizer] Pages: ${pdfDoc.getPageCount()}`);

  const optimizedBytes = await pdfDoc.save({
    useObjectStreams: false,
    addDefaultPage: false,
    objectsPerTick: 50,
  });

  await Bun.write(outputPath, optimizedBytes);

  const originalSize = pdfBytes.byteLength;
  const optimizedSize = optimizedBytes.byteLength;
  const reduction = (
    ((originalSize - optimizedSize) / originalSize) *
    100
  ).toFixed(1);

  console.log(`[Optimizer] Optimized: ${outputPath}`);
  console.log(
    `[Optimizer] Original: ${(originalSize / 1024 / 1024).toFixed(2)}MB`
  );
  console.log(
    `[Optimizer] Optimized: ${(optimizedSize / 1024 / 1024).toFixed(2)}MB`
  );
  console.log(`[Optimizer] Reduction: ${reduction}%`);
}

export async function getPageCount(pdfPath: string): Promise<number> {
  const pdfBytes = await Bun.file(pdfPath).arrayBuffer();
  const pdfDoc = await PDFDocument.load(pdfBytes);
  return pdfDoc.getPageCount();
}
