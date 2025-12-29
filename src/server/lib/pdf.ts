import { GoogleGenAI } from "@google/genai";
import type { RelevantPage } from "../../types";

const ai = new GoogleGenAI({});

// Model for PDF scanning (fast, cheap)
const SCAN_MODEL = "gemini-2.0-flash";

// Regex patterns at top level for performance
const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/;
const JSON_OBJECT_REGEX = /\{[\s\S]*\}/;

type PageScanResult = {
  pages: RelevantPage[];
  totalPages: number;
  bestPageIndex: number | null;
};

/**
 * Upload a PDF to Gemini File API for processing
 * Better for large files than base64 encoding
 */
export async function uploadPdfFile(
  filePath: string
): Promise<{ uri: string; mimeType: string; name: string }> {
  console.log(`[PDF] Uploading: ${filePath}`);

  const file = await ai.files.upload({
    file: filePath,
    config: { mimeType: "application/pdf" },
  });

  console.log(`[PDF] Uploaded: ${file.name}, URI: ${file.uri}`);

  return {
    uri: file.uri ?? "",
    mimeType: file.mimeType ?? "application/pdf",
    name: file.name ?? "",
  };
}

/**
 * Delete an uploaded file from Gemini
 */
export async function deletePdfFile(fileName: string): Promise<void> {
  await ai.files.delete({ name: fileName });
  console.log(`[PDF] Deleted: ${fileName}`);
}

/**
 * Scan PDF pages to identify which have useful site plan drawings
 * Returns ranked list of pages with relevance scores
 */
export async function scanPdfPages(
  pageImages: string[] // Array of base64 data URLs for each page
): Promise<PageScanResult> {
  console.log(`[PDF] Scanning ${pageImages.length} pages`);

  // Build parts array with all page images
  const imageParts = pageImages.map((dataUrl, idx) => {
    const match = dataUrl.match(DATA_URL_REGEX);
    if (!(match?.[1] && match[2])) {
      throw new Error(`Invalid data URL for page ${idx}`);
    }
    return {
      inlineData: {
        mimeType: match[1],
        data: match[2],
      },
    };
  });

  const scanPrompt = `You are analyzing ${pageImages.length} PDF pages from a construction/engineering plan set.

YOUR TASK: Find pages with FULL-PAGE SITE PLANS suitable for map overlay and geolocation.

WHAT WE NEED (mark isUsefulForGeolocation: true):
- SITE PLANS showing the entire property from TOP-DOWN view
- Pages with NORTH ARROWS and SCALE BARS
- Pages showing STREET NAMES around the perimeter
- Pages showing the PROPERTY BOUNDARY

WHAT WE DON'T NEED (mark isUsefulForGeolocation: false):
- Cover sheets, title blocks only
- Detail drawings (enlarged sections)
- Utility plans, grading plans without context
- Building floor plans (interior layouts)
- Landscape details, irrigation details

For EACH page (0-indexed), return:
{
  "pages": [
    {
      "pageIndex": 0,
      "pageType": "cover sheet" | "site plan" | "detail" | "utility plan" | etc,
      "description": "Brief description of what's on this page",
      "hasDrawing": true/false,
      "isUsefulForGeolocation": true/false,
      "score": 0.0-1.0 (how useful for geolocation)
    }
  ]
}

Return ONLY valid JSON.`;

  const response = await ai.models.generateContent({
    model: SCAN_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: scanPrompt }, ...imageParts],
      },
    ],
  });

  const text = response.text ?? "";
  console.log(`[PDF] Scan response length: ${text.length}`);

  // Parse JSON from response
  const jsonMatch = text.match(JSON_OBJECT_REGEX);
  if (!jsonMatch) {
    throw new Error("Failed to parse page scan response");
  }

  const result = JSON.parse(jsonMatch[0]) as { pages: RelevantPage[] };
  const pages = result.pages ?? [];

  // Find best page
  let bestPageIndex: number | null = null;
  let bestScore = 0;
  for (const page of pages) {
    if (page.isUsefulForGeolocation && page.score > bestScore) {
      bestScore = page.score;
      bestPageIndex = page.pageIndex;
    }
  }

  console.log(`[PDF] Found ${pages.length} pages, best: ${bestPageIndex}`);

  return {
    pages,
    totalPages: pageImages.length,
    bestPageIndex,
  };
}

/**
 * Extract a specific page range from PDF using Gemini
 * Useful when you know which page to analyze
 */
export async function extractFromPdfPage(
  pdfUri: string,
  mimeType: string,
  pageHint?: string
): Promise<string> {
  const response = await ai.models.generateContent({
    model: SCAN_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              fileUri: pdfUri,
              mimeType,
            },
          },
          {
            text: pageHint
              ? `Focus on ${pageHint}. Extract all text and location data visible.`
              : "Extract all text and location data from this document.",
          },
        ],
      },
    ],
  });

  return response.text ?? "";
}
