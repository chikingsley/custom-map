import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Use gemini-2.5-flash for document processing
const OCR_MODEL = "gemini-2.5-flash";

/**
 * Full OCR transcription prompt.
 * Goal: Extract EVERYTHING visible on the page, not specific fields.
 * This is real OCR - capture all text so it can be queried later.
 */
const FULL_OCR_PROMPT = `You are performing OCR (Optical Character Recognition) on an engineering/construction drawing page.

TRANSCRIBE ALL TEXT visible on this page. Include:
- Title block information (project name, sheet number, drawing title, revision, dates, names)
- All labels and annotations
- All dimensions and measurements with units
- All notes (general notes, specific notes, callouts)
- All legends and symbols with their descriptions
- All tables and their contents
- All addresses visible
- All road/street names visible
- All material specifications
- All code references
- All company/firm names and contact info
- Scale information
- North arrow labels
- Grid references
- Any other text visible anywhere on the page

FORMAT: Organize the transcription by area/section of the drawing where possible.
Use clear headings like:
- TITLE BLOCK:
- GENERAL NOTES:
- LEGEND:
- DIMENSIONS:
- LABELS:
- OTHER TEXT:

Be thorough. Capture EVERYTHING. This transcription will be used for downstream analysis.`;

/**
 * Result of full OCR - just the raw text
 */
export type FullOcrResult = {
  pageNumber: number;
  rawText: string;
  model: string;
  timestamp: string;
};

/**
 * Perform full OCR on a PDF page.
 * Returns all text visible on the page.
 */
async function ocrPageFull(
  pageBytes: Uint8Array,
  pageNumber: number
): Promise<FullOcrResult> {
  const base64 = Buffer.from(pageBytes).toString("base64");

  console.log(
    `[OCR Full] Page ${pageNumber}: sending ${(pageBytes.length / 1024).toFixed(1)}KB PDF to ${OCR_MODEL}`
  );

  const response = await ai.models.generateContent({
    model: OCR_MODEL,
    contents: [
      {
        inlineData: {
          mimeType: "application/pdf",
          data: base64,
        },
      },
      FULL_OCR_PROMPT,
    ],
  });

  const rawText = response.text || "";

  console.log(
    `[OCR Full] Page ${pageNumber}: received ${rawText.length} chars`
  );

  return {
    pageNumber,
    rawText,
    model: OCR_MODEL,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Full OCR with retry logic for rate limits.
 */
export async function ocrPageWithRetry(
  pageBytes: Uint8Array,
  pageNumber: number,
  maxRetries = 3
): Promise<FullOcrResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await ocrPageFull(pageBytes, pageNumber);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isRateLimit =
        errorMessage.includes("rate limit") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("429") ||
        errorMessage.includes("RESOURCE_EXHAUSTED");

      if (isRateLimit && attempt < maxRetries - 1) {
        const delayMs = 2 ** attempt * 1000;
        console.log(
          `[OCR] Rate limited, retrying in ${delayMs}ms... (attempt ${attempt + 1}/${maxRetries})`
        );
        await Bun.sleep(delayMs);
      } else {
        throw error;
      }
    }
  }
  throw new Error(`OCR failed after ${maxRetries} retries`);
}

/**
 * Process multiple pages in sequence with rate limit handling.
 */
export async function ocrAllPages(
  extractPageFn: (pageNum: number) => Promise<Uint8Array>,
  totalPages: number,
  onProgress?: (pageNum: number, result: FullOcrResult) => void
): Promise<FullOcrResult[]> {
  const results: FullOcrResult[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    console.log(`[OCR] Processing page ${pageNum}/${totalPages}...`);

    const pageBytes = await extractPageFn(pageNum);
    const result = await ocrPageWithRetry(pageBytes, pageNum);

    results.push(result);
    onProgress?.(pageNum, result);

    // Small delay between pages to avoid rate limits
    if (pageNum < totalPages) {
      await Bun.sleep(500);
    }
  }

  return results;
}

// ============================================================
// LEGACY: Keep old function for backwards compatibility
// This will be removed once we migrate fully to full OCR
// ============================================================

import type { OcrResult } from "./types";

const LEGACY_OCR_PROMPT = `
You are extracting structured data from a construction/engineering drawing page.

Extract data in this JSON format:
{
  "titleBlock": {
    "projectName": "...",
    "projectNameType": "...",
    "projectNameNumber": "...",
    "drawingTitle": "...",
    "drawingNumber": "...",
    "sheetNumber": "...",
    "revision": "...",
    "designedBy": "...",
    "drawnBy": "...",
    "checkedBy": "...",
    "scale": { "ratio": "...", "units": "..." }
  },
  "engineeringInfo": {
    "disciplines": [{"discipline": "...", "disciplineNumber": "..."}],
    "notes": ["...", "..."],
    "abbreviations": ["...", "..."]
  },
  "ocrData": {
    "fullText": "...",
    "addresses": ["..."],
    "roads": ["..."],
    "measurements": [{"description": "...", "value": number, "unit": "..."}],
    "materials": ["..."],
    "generalNotes": ["..."]
  }
}

Return ONLY valid JSON. No markdown, no explanations.`;

function isRateLimitError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return (
    errorMessage.includes("rate limit") ||
    errorMessage.includes("quota") ||
    errorMessage.includes("429") ||
    errorMessage.includes("RESOURCE_EXHAUSTED")
  );
}

function parseJsonFromResponse(responseText: string): OcrResult {
  // Strip markdown code blocks if present
  let text = responseText.trim();
  if (text.startsWith("```json")) {
    text = text.slice(7);
  } else if (text.startsWith("```")) {
    text = text.slice(3);
  }
  if (text.endsWith("```")) {
    text = text.slice(0, -3);
  }
  text = text.trim();

  const startIndex = text.indexOf("{");
  const endIndex = text.lastIndexOf("}");

  if (startIndex === -1 || endIndex === -1) {
    throw new Error("No valid JSON found in OCR response");
  }

  const jsonStr = text.substring(startIndex, endIndex + 1);
  return JSON.parse(jsonStr) as OcrResult;
}

async function legacyOcrPage(pageBytes: Uint8Array): Promise<OcrResult> {
  const base64 = Buffer.from(pageBytes).toString("base64");

  const response = await ai.models.generateContent({
    model: OCR_MODEL,
    contents: [
      {
        inlineData: {
          mimeType: "application/pdf",
          data: base64,
        },
      },
      { text: LEGACY_OCR_PROMPT },
    ],
  });

  return parseJsonFromResponse(response.text || "");
}

/**
 * @deprecated Use ocrPageWithRetry instead for full OCR
 */
export async function ocrWithRetry(
  pageBytes: Uint8Array,
  maxRetries = 3
): Promise<OcrResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await legacyOcrPage(pageBytes);
    } catch (error) {
      if (isRateLimitError(error) && attempt < maxRetries - 1) {
        const delayMs = 2 ** attempt * 1000;
        console.log(
          `[OCR] Rate limited, retrying in ${delayMs}ms... (attempt ${attempt + 1}/${maxRetries})`
        );
        await Bun.sleep(delayMs);
      } else {
        throw error;
      }
    }
  }
  throw new Error(`OCR failed after ${maxRetries} retries`);
}
