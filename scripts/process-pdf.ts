#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import {
  closeDatabase,
  createOcrPage,
  createProject,
  initDatabase,
} from "../src/server/lib/database/sqlite";
import { extractPage } from "../src/server/lib/pdf-processor/extractor";
import { ocrWithRetry } from "../src/server/lib/pdf-processor/ocr";
import {
  getPageCount,
  optimizePdf,
} from "../src/server/lib/pdf-processor/optimizer";
import type { OcrResult } from "../src/server/lib/pdf-processor/types";

const TEST_FILES = [
  "Sun_Health_La_Loma_Campus_Drawings-COMPILED_R1-2025-compressed.pdf",
  "250422_Sun Health La Loma Campus - Resident Gathering Space_COMPILED_R1 Drawings Only.pdf",
  "SWPPP Test - Kiwanis Park North Playground PLAN Sheets.pdf",
];

async function processFile(
  fileName: string,
  inputPath: string,
  optimizedPath: string
): Promise<{ completed: number; failed: number }> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Processing: ${fileName}`);
  console.log(`${"=".repeat(60)}\n`);

  let completed = 0;
  let failed = 0;

  try {
    console.log("[Step 1/3] Optimizing PDF...");
    await optimizePdf(inputPath, optimizedPath);
    console.log("[Step 1/3] OK");

    const pageCount = await getPageCount(optimizedPath);
    console.log(`[Step 2/3] Total pages: ${pageCount}\n`);

    const projectId = randomUUID();
    createProject({
      id: projectId,
      name: fileName,
      inputPath,
      optimizedPath,
      pageCount,
    });

    console.log("[Step 3/3] Running OCR...");

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const pageId = randomUUID();

      try {
        const pageBytes = await extractPage(optimizedPath, pageNum);
        const ocrResult = await ocrWithRetry(pageBytes);

        createOcrPage({
          id: pageId,
          projectId,
          pageNumber: pageNum,
          titleBlockJson: JSON.stringify(ocrResult.titleBlock),
          engineeringInfoJson: JSON.stringify(ocrResult.engineeringInfo),
          ocrDataJson: JSON.stringify(ocrResult.ocrData),
          ocrModel: "gemini-3-flash-preview",
          status: "completed",
          retryCount: 0,
        });

        completed += 1;
        console.log(`[OCR] Page ${pageNum}/${pageCount} completed`);
      } catch (error) {
        console.error(`\n[Error] Page ${pageNum} failed: ${error}`);

        const emptyOcrResult: OcrResult = {
          titleBlock: {
            projectName: "",
            projectNameType: "",
            projectNameNumber: "",
            drawingTitle: "",
            drawingNumber: "",
            sheetNumber: "",
            revision: "",
            designedBy: "",
            drawnBy: "",
            checkedBy: "",
            scale: { ratio: "", units: "" },
          },
          engineeringInfo: {
            disciplines: [],
            notes: [],
            abbreviations: [],
          },
          ocrData: {
            fullText: "",
            addresses: [],
            roads: [],
            measurements: [],
            materials: [],
            generalNotes: [],
          },
        };

        createOcrPage({
          id: pageId,
          projectId,
          pageNumber: pageNum,
          titleBlockJson: JSON.stringify(emptyOcrResult.titleBlock),
          engineeringInfoJson: JSON.stringify(emptyOcrResult.engineeringInfo),
          ocrDataJson: JSON.stringify(emptyOcrResult.ocrData),
          ocrModel: "gemini-3-flash-preview",
          status: "failed",
          retryCount: 3,
        });

        failed += 1;
        console.log(`[OCR] Page ${pageNum}/${pageCount} failed`);
      }
    }

    return { completed, failed };
  } catch (error) {
    console.error(`[Error] Failed to process file: ${error}`);
    return { completed: 0, failed: 0 };
  }
}

async function main() {
  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  PDF Processing Pipeline Test                          ║");
  console.log("╚═════════════════════════════════════════════════╝\n");

  if (!process.env.GEMINI_API_KEY) {
    console.error("[ERROR] GEMINI_API_KEY not set in environment");
    console.error("[ERROR] Please set it in .env file");
    process.exit(1);
  }

  initDatabase();

  await Bun.$`mkdir -p ./data/input`.quiet();
  await Bun.$`mkdir -p ./data/optimized`.quiet();

  let totalCompleted = 0;
  let totalFailed = 0;

  for (const fileName of TEST_FILES) {
    const inputPath = `./${fileName}`;
    const optimizedPath = `./data/optimized/${fileName}`;

    const result = await processFile(fileName, inputPath, optimizedPath);

    totalCompleted += result.completed;
    totalFailed += result.failed;
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("SUMMARY");
  console.log("═".repeat(60));
  console.log(`Total pages processed: ${totalCompleted + totalFailed}`);
  console.log(`Successfully extracted: ${totalCompleted}`);
  console.log(`Failed: ${totalFailed}`);
  console.log("═".repeat(60));

  closeDatabase();
}

main().catch(console.error);
