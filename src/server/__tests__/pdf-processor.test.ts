import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createProject,
  getProject,
  initDatabase,
} from "../lib/database/sqlite";
import { extractPage } from "../lib/pdf-processor/extractor";
import { ocrPageWithRetry, ocrWithRetry } from "../lib/pdf-processor/ocr";
import { getPageCount, optimizePdf } from "../lib/pdf-processor/optimizer";
import type { OcrResult } from "../lib/pdf-processor/types";

// Real test PDF
const TEST_PDF =
  "./Sun_Health_La_Loma_Campus_Drawings-COMPILED_R1-2025-compressed.pdf";
const OPTIMIZED_PDF = "./data/optimized/test-output.pdf";

describe("Database", () => {
  test("can initialize", () => {
    initDatabase();
    expect(true).toBe(true);
  });

  test("can create and retrieve project", () => {
    initDatabase();

    const projectId = randomUUID();
    createProject({
      id: projectId,
      name: "Test Project",
      inputPath: "/test/input.pdf",
      optimizedPath: "/test/output.pdf",
      pageCount: 10,
    });

    const retrieved = getProject(projectId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("Test Project");
    expect(retrieved?.pageCount).toBe(10);
  });
});

describe("PDF Optimizer", () => {
  test("can get page count from PDF", async () => {
    const pageCount = await getPageCount(TEST_PDF);

    console.log(`[Test] PDF has ${pageCount} pages`);

    expect(pageCount).toBeGreaterThan(0);
    expect(typeof pageCount).toBe("number");
  });

  test("can optimize PDF", async () => {
    await optimizePdf(TEST_PDF, OPTIMIZED_PDF);

    // Verify output file exists
    const outputFile = Bun.file(OPTIMIZED_PDF);
    const exists = await outputFile.exists();

    expect(exists).toBe(true);

    const size = outputFile.size;
    console.log(
      `[Test] Optimized PDF size: ${(size / 1024 / 1024).toFixed(2)}MB`
    );

    expect(size).toBeGreaterThan(0);
  });
});

describe("PDF Extractor", () => {
  test("can extract single page as PDF bytes", async () => {
    const pageBytes = await extractPage(TEST_PDF, 1);

    console.log(`[Test] Extracted page 1: ${pageBytes.length} bytes`);

    expect(pageBytes).toBeInstanceOf(Uint8Array);
    expect(pageBytes.length).toBeGreaterThan(0);

    // Should be valid PDF (starts with %PDF)
    const header = new TextDecoder().decode(pageBytes.slice(0, 5));
    expect(header).toBe("%PDF-");
  });

  test("can extract different pages", async () => {
    const page1 = await extractPage(TEST_PDF, 1);
    const page2 = await extractPage(TEST_PDF, 2);

    console.log(
      `[Test] Page 1: ${page1.length} bytes, Page 2: ${page2.length} bytes`
    );

    // Both should be valid PDFs
    expect(page1.length).toBeGreaterThan(0);
    expect(page2.length).toBeGreaterThan(0);

    // They should be different (different content)
    expect(page1.length).not.toBe(page2.length);
  });
});

describe("OCR with Gemini", () => {
  test("can OCR page 1 (usually cover sheet)", async () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log("[Test] GEMINI_API_KEY not set, skipping OCR test");
      return;
    }

    const pageBytes = await extractPage(TEST_PDF, 1);
    const result = await ocrWithRetry(pageBytes);

    console.log("\n[Test] OCR Result for Page 1:");
    console.log("  Project Name:", result.titleBlock.projectName);
    console.log("  Drawing Title:", result.titleBlock.drawingTitle);
    console.log("  Sheet Number:", result.titleBlock.sheetNumber);
    console.log("  Addresses found:", result.ocrData.addresses);
    console.log("  Roads found:", result.ocrData.roads);

    // Should have structure
    expect(result.titleBlock).toBeDefined();
    expect(result.engineeringInfo).toBeDefined();
    expect(result.ocrData).toBeDefined();

    // ocrData should have arrays
    expect(Array.isArray(result.ocrData.addresses)).toBe(true);
    expect(Array.isArray(result.ocrData.roads)).toBe(true);
  }, 60_000); // 60s timeout for API call

  test("can OCR a site plan page (page 3-5 typically)", async () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log("[Test] GEMINI_API_KEY not set, skipping OCR test");
      return;
    }

    // Try page 3 - often a site plan
    const pageBytes = await extractPage(TEST_PDF, 3);
    const result = await ocrWithRetry(pageBytes);

    console.log("\n[Test] OCR Result for Page 3 (likely site plan):");
    console.log("  Project Name:", result.titleBlock.projectName);
    console.log("  Drawing Title:", result.titleBlock.drawingTitle);
    console.log("  Drawing Number:", result.titleBlock.drawingNumber);
    console.log("  Scale:", result.titleBlock.scale);
    console.log("  Addresses:", result.ocrData.addresses);
    console.log("  Roads:", result.ocrData.roads);
    console.log("  Measurements:", result.ocrData.measurements.slice(0, 3));
    console.log("  Full text length:", result.ocrData.fullText.length, "chars");

    // Site plans should have more data
    expect(result.titleBlock.drawingTitle).toBeDefined();
    expect(result.ocrData.fullText.length).toBeGreaterThan(0);
  }, 60_000);

  // Skip: Legacy OCR deprecated - use Full OCR tests instead
  // This test frequently hits rate limits when run with other tests
  // biome-ignore lint/suspicious/noSkippedTests: Legacy test, deprecated in favor of Full OCR
  test.skip("OCR multiple pages and compare results", async () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log("[Test] GEMINI_API_KEY not set, skipping OCR test");
      return;
    }

    const pagesToTest = [1, 2, 3];
    const results: Array<{ pageNum: number; result: OcrResult }> = [];

    for (const pageNum of pagesToTest) {
      console.log(`\n[Test] Processing page ${pageNum}...`);
      const pageBytes = await extractPage(TEST_PDF, pageNum);
      const result = await ocrWithRetry(pageBytes);
      results.push({ pageNum, result });

      console.log(
        `  Page ${pageNum}: "${result.titleBlock.drawingTitle || "(no title)"}"`
      );
      console.log(`    Roads: ${result.ocrData.roads.join(", ") || "(none)"}`);
      console.log(
        `    Addresses: ${result.ocrData.addresses.join(", ") || "(none)"}`
      );
    }

    // All should succeed
    expect(results.length).toBe(3);

    // Each result should have required structure
    for (const { result } of results) {
      expect(result.titleBlock).toBeDefined();
      expect(result.ocrData).toBeDefined();
    }
  }, 180_000); // 3 min timeout for 3 pages
});

describe("Full OCR (new)", () => {
  test("extracts ALL text from page 2 (project info page)", async () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log("[Test] GEMINI_API_KEY not set, skipping OCR test");
      return;
    }

    // Page 2 has project info with roads, addresses, etc
    const pageBytes = await extractPage(TEST_PDF, 2);
    const result = await ocrPageWithRetry(pageBytes, 2);

    console.log("\n[Full OCR] Page 2 result:");
    console.log("  Model:", result.model);
    console.log("  Text length:", result.rawText.length, "chars");
    console.log("\n--- RAW TEXT (first 2000 chars) ---");
    console.log(result.rawText.substring(0, 2000));
    console.log("--- END ---\n");

    // Should have substantial text (full OCR typically gets 10k+ chars)
    expect(result.rawText.length).toBeGreaterThan(5000);
    expect(result.pageNumber).toBe(2);
    expect(result.model).toBe("gemini-2.5-flash");

    // Should contain key info we know is on this page
    const text = result.rawText.toLowerCase();
    expect(text).toContain("sun health");
  }, 90_000);

  test("extracts structured content sections", async () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log("[Test] GEMINI_API_KEY not set, skipping OCR test");
      return;
    }

    const pageBytes = await extractPage(TEST_PDF, 3);
    const result = await ocrPageWithRetry(pageBytes, 3);

    console.log("\n[Full OCR] Page 3 result:");
    console.log("  Text length:", result.rawText.length, "chars");

    // Should have organized sections
    const text = result.rawText;
    expect(result.rawText.length).toBeGreaterThan(1000);

    // Log a sample of what was extracted
    console.log("\n--- Sample sections found ---");
    if (text.includes("TITLE BLOCK")) {
      console.log("  ✓ TITLE BLOCK section found");
    }
    if (text.includes("NOTE") || text.includes("Notes")) {
      console.log("  ✓ NOTES section found");
    }
    console.log("--- END ---\n");
  }, 90_000);
});
