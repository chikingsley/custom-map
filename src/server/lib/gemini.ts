import { GoogleGenAI } from "@google/genai";
import type { ExtractedPlanData, LatLng } from "../../types";

// Model configuration
// Gemini 2.5 required for Maps grounding (Gemini 3 doesn't support it)
const GROUNDING_MODEL = "gemini-2.5-flash";
// Gemini 3 for fast text-only extraction
const FAST_MODEL = "gemini-3-flash-preview";

const ai = new GoogleGenAI({});

// System prompt for extraction
const EXTRACTION_PROMPT = `Extract location data from this construction/site plan.

<task>
Read every piece of text in the document. Find:
1. All street/road names visible anywhere in the document
2. The street address (usually in title block)
3. City and state
4. Scale information if present
5. Project name from title block
6. Parcel number (APN) if visible
</task>

<output>
Return JSON only.
</output>`;

// Regex patterns for JSON extraction
const CODE_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)```/;
const JSON_OBJECT_REGEX = /\{[\s\S]*\}/;

type ExtractionOptions = {
  useGrounding?: boolean;
  locationBias?: LatLng;
};

type GroundingSource = {
  type: "web" | "maps";
  uri?: string;
  title?: string;
};

type ExtractionResult = {
  data: ExtractedPlanData;
  groundingSources: GroundingSource[];
  modelUsed: string;
};

/**
 * Extract location data from a construction plan image
 * Uses Gemini with optional Google Search + Maps grounding
 */
export async function extractPlanData(
  imageBase64: string,
  mimeType: string,
  filename: string,
  options: ExtractionOptions = {}
): Promise<ExtractionResult> {
  const { useGrounding = true, locationBias } = options;
  const model = useGrounding ? GROUNDING_MODEL : FAST_MODEL;

  console.log(`[Extract] Using model: ${model}, grounding: ${useGrounding}`);

  // Build config - grounding tools only work with 2.5 models
  const config: Record<string, unknown> = {
    systemInstruction: EXTRACTION_PROMPT,
  };

  if (useGrounding) {
    config.tools = [{ googleSearch: {} }, { googleMaps: {} }];

    // Add location bias if provided
    if (locationBias) {
      config.toolConfig = {
        retrievalConfig: {
          latLng: { latitude: locationBias.lat, longitude: locationBias.lng },
        },
      };
      console.log(
        `[Extract] Location bias: ${locationBias.lat}, ${locationBias.lng}`
      );
    }
  }

  const response = await ai.models.generateContent({
    model,
    config,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Document: ${filename}

Extract ALL location data from this construction/site plan image.
${useGrounding ? "Use Google Search and Google Maps to verify addresses and find coordinates." : ""}

IMPORTANT: Look for the PROJECT NAME in the title block (usually top right or bottom of drawing).
Also look for PARCEL NUMBER (APN) which may be labeled as "Parcel", "APN", or similar.

Return ONLY valid JSON (no markdown, no explanation):
{
  "projectName": "string or null - the project/site name from title block",
  "parcelNumber": "string or null - the APN/parcel number",
  "address": "string or null",
  "city": "string or null",
  "state": "string or null",
  "county": "string or null",
  "roads": [{"name": "string", "direction": "north|south|east|west|unknown"}],
  "intersections": [{"road1": "string", "road2": "string", "corner": "northwest|northeast|southwest|southeast"}],
  "scaleInfo": "string or null",
  "estimatedSizeMeters": number or null,
  "coordinates": {"lat": number, "lng": number} or null
}`,
          },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      },
    ],
  });

  const text = response.text ?? "";
  console.log(`[Extract] Response length: ${text.length}`);

  // Capture grounding metadata
  const groundingSources: GroundingSource[] = [];
  const metadata = response.candidates?.[0]?.groundingMetadata;
  if (metadata?.groundingChunks) {
    for (const chunk of metadata.groundingChunks) {
      if (chunk.web) {
        groundingSources.push({
          type: "web",
          uri: chunk.web.uri,
          title: chunk.web.title,
        });
      }
    }
    console.log(`[Extract] Grounding sources: ${groundingSources.length}`);
  }

  // Parse JSON from response
  const data = parseExtractionResponse(text);

  return {
    data: mapToExtractedPlanData(data),
    groundingSources,
    modelUsed: model,
  };
}

function parseExtractionResponse(text: string): Record<string, unknown> {
  let jsonStr = text;

  // Try markdown code block first
  const codeMatch = text.match(CODE_BLOCK_REGEX);
  if (codeMatch?.[1]) {
    jsonStr = codeMatch[1].trim();
  } else {
    // Try raw JSON object
    const objMatch = text.match(JSON_OBJECT_REGEX);
    if (objMatch) {
      jsonStr = objMatch[0];
    }
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("[Extract] JSON parse error:", e);
    throw new Error(
      `Failed to parse extraction response: ${jsonStr.slice(0, 200)}`
    );
  }
}

type RawRoad = { name: string; direction: string };
type RawIntersection = { road1: string; road2: string; corner: string };
type Direction = "north" | "south" | "east" | "west" | "unknown";
type Corner = "northwest" | "northeast" | "southwest" | "southeast" | "unknown";

function mapRoad(r: RawRoad) {
  return {
    name: r.name,
    direction: (r.direction as Direction) ?? "unknown",
    isPrimary: false,
  };
}

function mapIntersection(i: RawIntersection) {
  return {
    road1: i.road1,
    road2: i.road2,
    cornerPosition: (i.corner as Corner) ?? "unknown",
  };
}

function findRoadByDirection(roads: RawRoad[], dir: Direction): string | null {
  return roads.find((r) => r.direction === dir)?.name ?? null;
}

function mapToExtractedPlanData(
  data: Record<string, unknown>
): ExtractedPlanData {
  const roads = (data.roads as RawRoad[]) ?? [];
  const intersections = (data.intersections as RawIntersection[]) ?? [];
  const coords = data.coordinates as { lat: number; lng: number } | null;

  return {
    projectName: (data.projectName as string) ?? null,
    parcelNumber: (data.parcelNumber as string) ?? null,
    address: (data.address as string) ?? null,
    city: (data.city as string) ?? null,
    state: (data.state as string) ?? null,
    county: (data.county as string) ?? null,
    roads: roads.map(mapRoad),
    intersections: intersections.map(mapIntersection),
    scaleInfo: (data.scaleInfo as string) ?? null,
    estimatedSizeMeters: (data.estimatedSizeMeters as number) ?? null,
    confidence: roads.length >= 2 ? 0.8 : 0.5,
    siteShape: "unknown",
    siteBoundary: {
      northRoad: findRoadByDirection(roads, "north"),
      southRoad: findRoadByDirection(roads, "south"),
      eastRoad: findRoadByDirection(roads, "east"),
      westRoad: findRoadByDirection(roads, "west"),
    },
    coordinates: coords ? { lat: coords.lat, lng: coords.lng } : null,
  };
}

/**
 * Simple text extraction without grounding (faster, cheaper)
 * Uses Gemini 3 Flash with lower thinking level
 */
export async function extractPlanDataFast(
  imageBase64: string,
  mimeType: string,
  filename: string
): Promise<ExtractedPlanData> {
  const result = await extractPlanData(imageBase64, mimeType, filename, {
    useGrounding: false,
  });
  return result.data;
}
