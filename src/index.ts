import { GoogleGenAI } from "@google/genai";
import { serve } from "bun";
import index from "./index.html";

// Types
type Bounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

// Road/street extracted from the plan
type ExtractedRoad = {
  name: string;
  direction: "north" | "south" | "east" | "west" | "unknown";
  isPrimary: boolean; // Is this the main frontage road?
};

// Intersection point where roads meet
type ExtractedIntersection = {
  road1: string;
  road2: string;
  cornerPosition:
    | "northwest"
    | "northeast"
    | "southwest"
    | "southeast"
    | "unknown"; // Which corner of the site is at this intersection
};

// Enhanced extraction data
type ExtractedPlanData = {
  // Legacy fields for backwards compatibility
  address: string | null;
  city: string | null;
  state: string | null;
  streetNames: string[]; // Keep for backwards compat
  landmarks: string[];
  scaleInfo: string | null;
  northArrowDegrees: number | null;
  estimatedSizeMeters: number | null;
  confidence: number;
  // NEW: Enhanced road/intersection data
  roads: ExtractedRoad[];
  intersections: ExtractedIntersection[];
  siteShape:
    | "rectangular"
    | "irregular"
    | "L-shaped"
    | "triangular"
    | "unknown";
  // Approximate bounding box of site relative to roads
  siteBoundary: {
    northRoad: string | null;
    southRoad: string | null;
    eastRoad: string | null;
    westRoad: string | null;
  };
};

type RefinementAdjustment = {
  shiftMeters: { north: number; east: number };
  scaleFactor: number;
  confidence: number;
  reasoning: string;
};

// Model names - Using newest models as of December 2025
// Primary: Gemini 3 Pro Preview - newest model with thinking capabilities
const GEMINI_PRIMARY_MODEL = Bun.env.GEMINI_MODEL ?? "gemini-3-pro-preview";

// Fast model for iterative refinement - Gemini 2.5 Flash (fast and smart)
const GEMINI_FAST_MODEL = "gemini-2.5-flash";

// Initialize Google GenAI directly (no AI SDK wrapper)
const genai = Bun.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: Bun.env.GEMINI_API_KEY })
  : null;

// Store conversation history per session for multi-turn
const sessions = new Map<
  string,
  Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>
>();

// System prompt for EXTRACTION phase - simple and direct
const EXTRACTION_SYSTEM_PROMPT = `Extract location data from this construction/site plan.

<task>
Read every piece of text in the document. Find:
1. All street/road names visible anywhere in the document
2. The street address (usually in title block)
3. City and state
4. Scale information if present
</task>

<output>
Return JSON only.
</output>`;

// System prompt for REFINEMENT phase - visual comparison
const REFINEMENT_SYSTEM_PROMPT = `You are an AI that compares construction plan overlays with satellite imagery to suggest positioning adjustments.

You will receive:
1. A screenshot of the current map with the plan overlay
2. The original plan document

Your task is to compare visible features and suggest ADJUSTMENTS (not absolute positions):

Look for:
- Street alignments: Are roads in the plan parallel to roads in satellite view?
- Building footprints: Do building shapes match?
- Parking lots, driveways, property boundaries
- Scale: Is the plan too big or too small compared to actual features?

Return ONLY a JSON object:
{
  "shiftMeters": {"north": 0, "east": 0},
  "scaleFactor": 1.0,
  "confidence": 0.7,
  "reasoning": "Brief explanation of what you see"
}

Guidelines:
- shiftMeters: positive north = move overlay northward, positive east = move eastward
- scaleFactor: 1.0 = no change, 1.1 = 10% larger, 0.9 = 10% smaller
- confidence: 0.0-1.0, how confident you are in these adjustments
- Keep adjustments small (under 100m shifts, under 20% scale change per iteration)`;

// System prompt for DEEP REFINEMENT - iterative terrain/feature matching
const DEEP_REFINEMENT_SYSTEM_PROMPT = `You are an AI that precisely aligns construction site plans to real terrain by matching visual features.

You will receive TWO SEPARATE IMAGES:
1. The DRAWING (site plan/construction plan)
2. The TERRAIN MAP (Google Maps terrain view showing topography)

Your task is to find matching features and suggest how to shift/scale the overlay to align them.

## Features to Match (in priority order):

1. **TOPOGRAPHY CONTOURS**: The drawing may show elevation lines. Match these to terrain contours on the map.

2. **PARKING LOTS**: Look for rectangular striped areas in the drawing. Match to existing parking lots on the terrain map.

3. **ROAD CURVES**: Roads curve in specific ways. Match road shapes between drawing and map.

4. **BUILDING FOOTPRINTS**: Existing buildings should align (not planned/future buildings).

5. **PROPERTY BOUNDARIES**: Look for property lines that match terrain features.

## Analysis Steps:
1. Identify 2-3 distinctive features in the drawing
2. Find where those same features appear on the terrain map
3. Calculate how far off they are (in meters, roughly)
4. Suggest adjustment

Return ONLY a JSON object:
{
  "shiftMeters": {"north": 0, "east": 0},
  "scaleFactor": 1.0,
  "confidence": 0.7,
  "featuresMatched": ["topography contour", "parking lot"],
  "reasoning": "The 1200ft contour line in the drawing matches the contour 30m north of current position"
}

Guidelines:
- shiftMeters: positive north = move overlay northward, positive east = move eastward
- Maximum shift per iteration: 50 meters
- scaleFactor: 1.0 = no change, keep between 0.9 and 1.1
- confidence: 0.0-1.0
- If you can't find matching features, set confidence to 0.3 or lower`;

// Regex patterns for JSON parsing
const CODE_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)```/;
const JSON_OBJECT_REGEX = /\{[\s\S]*\}/;

// Regex for data URL parsing
const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/;

// Parse JSON from AI response (handles markdown code blocks)
function parseJsonResponse<T>(text: string): T | null {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = text.match(CODE_BLOCK_REGEX);
  const jsonStr =
    codeBlockMatch?.[1] !== undefined ? codeBlockMatch[1].trim() : text.trim();

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Try to find JSON object in the text
    const jsonMatch = jsonStr.match(JSON_OBJECT_REGEX);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Geocode an address using Google Maps Geocoding API
async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  const apiKey = Bun.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_MAPS_API_KEY not set for geocoding");
    return null;
  }

  const encodedAddress = encodeURIComponent(address);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "OK" && data.results?.[0]) {
      const result = data.results[0];
      return {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        formattedAddress: result.formatted_address,
      };
    }
    console.error("Geocoding failed:", data.status, data.error_message);
    return null;
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

// Decode Google's encoded polyline format
// Algorithm requires bitwise operations: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let idx = 0;
  let lat = 0;
  let lng = 0;

  while (idx < encoded.length) {
    // Decode latitude
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(idx) - 63;
      idx += 1;
      // biome-ignore lint/suspicious/noBitwiseOperators: Required by polyline algorithm
      // biome-ignore lint/style/useShorthandAssign: Explicit form for clarity
      result = result | ((byte & 0x1f) << shift);
      shift += 5;
    } while (byte >= 0x20);

    // biome-ignore lint/suspicious/noBitwiseOperators: Required by polyline algorithm
    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    // Decode longitude
    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(idx) - 63;
      idx += 1;
      // biome-ignore lint/suspicious/noBitwiseOperators: Required by polyline algorithm
      // biome-ignore lint/style/useShorthandAssign: Explicit form for clarity
      result = result | ((byte & 0x1f) << shift);
      shift += 5;
    } while (byte >= 0x20);

    // biome-ignore lint/suspicious/noBitwiseOperators: Required by polyline algorithm
    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5,
    });
  }

  return points;
}

// Options for road geometry search
type RoadGeometryOptions = {
  roadName: string;
  nearPoint: { lat: number; lng: number };
  city?: string;
  state?: string;
  searchRadiusMeters?: number;
};

// Get road geometry by finding two points along the road and getting directions between them
async function getRoadGeometryBySearch(
  options: RoadGeometryOptions
): Promise<Array<{ lat: number; lng: number }> | null> {
  const { roadName, nearPoint, searchRadiusMeters = 1000 } = options;
  const apiKey = Bun.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return null;
  }

  // Calculate offset points in meters (rough approximation)
  const METERS_PER_LAT_DEG = 111_000;
  const latRadians = (nearPoint.lat * Math.PI) / 180;
  const metersPerLngDeg = Math.cos(latRadians) * 111_000;

  // Offset by ~500m in each direction to create a segment
  const latOffset = searchRadiusMeters / METERS_PER_LAT_DEG;
  const lngOffset = searchRadiusMeters / metersPerLngDeg;

  // Try to determine road direction from the road name
  // E.g., "E. Baseline Road" suggests east-west orientation
  const roadNameLower = roadName.toLowerCase();

  const isNorthSouth =
    roadNameLower.includes("kyrene") ||
    roadNameLower.includes("mill") ||
    roadNameLower.includes("rural") ||
    roadNameLower.includes("st") ||
    roadNameLower.startsWith("n.") ||
    roadNameLower.startsWith("s.");

  // Create origin and destination based on likely road direction
  let origin: string;
  let destination: string;

  if (isNorthSouth) {
    // Road runs north-south, offset in latitude
    origin = `${nearPoint.lat + latOffset},${nearPoint.lng}`;
    destination = `${nearPoint.lat - latOffset},${nearPoint.lng}`;
  } else {
    // Default to east-west, offset in longitude
    origin = `${nearPoint.lat},${nearPoint.lng - lngOffset}`;
    destination = `${nearPoint.lat},${nearPoint.lng + lngOffset}`;
  }

  const directionsUrl = new URL(
    "https://maps.googleapis.com/maps/api/directions/json"
  );
  directionsUrl.searchParams.set("origin", origin);
  directionsUrl.searchParams.set("destination", destination);
  directionsUrl.searchParams.set("key", apiKey);
  directionsUrl.searchParams.set("mode", "driving");

  try {
    console.log(
      `[Roads] Getting geometry for "${roadName}" (${isNorthSouth ? "N-S" : "E-W"})`
    );
    console.log(`[Roads] Origin: ${origin}, Destination: ${destination}`);

    const response = await fetch(directionsUrl.toString());
    const data = await response.json();

    if (data.status === "OK" && data.routes?.[0]?.overview_polyline?.points) {
      const encodedPolyline = data.routes[0].overview_polyline.points;
      const points = decodePolyline(encodedPolyline);
      console.log(`[Roads] Got ${points.length} points for "${roadName}"`);
      return points;
    }

    console.error(
      "[Roads] Directions API failed:",
      data.status,
      data.error_message
    );
    return null;
  } catch (error) {
    console.error("[Roads] Directions error:", error);
    return null;
  }
}

// Geocode an intersection (two roads) - returns the intersection point
async function geocodeIntersection(
  road1: string,
  road2: string,
  city: string,
  state: string
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  // Format intersection query - Google understands "Road1 & Road2, City, State"
  const intersectionQuery = `${road1} & ${road2}, ${city}, ${state}`;
  console.log(`[Geocode] Attempting intersection: "${intersectionQuery}"`);

  const result = await geocodeAddress(intersectionQuery);
  if (result) {
    console.log(
      `[Geocode] Intersection found: ${result.lat}, ${result.lng} (${result.formattedAddress})`
    );
    return result;
  }

  // Fallback: try "Road1 and Road2" format
  const fallbackQuery = `${road1} and ${road2}, ${city}, ${state}`;
  console.log(`[Geocode] Fallback intersection: "${fallbackQuery}"`);
  return geocodeAddress(fallbackQuery);
}

// Calculate bounds from a CORNER point (intersection) instead of center
// cornerPosition tells us which corner of the site the intersection represents
function calculateBoundsFromCorner(
  corner: { lat: number; lng: number },
  cornerPosition: "northwest" | "northeast" | "southwest" | "southeast",
  sizeMeters: number,
  aspectRatio = 1
): Bounds {
  const METERS_PER_LAT_DEG = 111_000;
  const latRadians = (corner.lat * Math.PI) / 180;
  const metersPerLngDeg = Math.cos(latRadians) * 111_000;

  // Calculate width and height based on aspect ratio
  let widthMeters: number;
  let heightMeters: number;

  if (aspectRatio >= 1) {
    widthMeters = sizeMeters;
    heightMeters = sizeMeters / aspectRatio;
  } else {
    heightMeters = sizeMeters;
    widthMeters = sizeMeters * aspectRatio;
  }

  // Convert meters to degrees
  const latDelta = heightMeters / METERS_PER_LAT_DEG;
  const lngDelta = widthMeters / metersPerLngDeg;

  console.log(
    `[Bounds] Corner-based: position=${cornerPosition}, size=${sizeMeters}m, aspect=${aspectRatio.toFixed(3)}`
  );
  console.log(
    `[Bounds] Dimensions: width=${widthMeters.toFixed(1)}m, height=${heightMeters.toFixed(1)}m`
  );

  // Calculate bounds based on which corner we have
  switch (cornerPosition) {
    case "northwest":
      return {
        north: corner.lat,
        south: corner.lat - latDelta,
        west: corner.lng,
        east: corner.lng + lngDelta,
      };
    case "northeast":
      return {
        north: corner.lat,
        south: corner.lat - latDelta,
        east: corner.lng,
        west: corner.lng - lngDelta,
      };
    case "southwest":
      return {
        south: corner.lat,
        north: corner.lat + latDelta,
        west: corner.lng,
        east: corner.lng + lngDelta,
      };
    case "southeast":
      return {
        south: corner.lat,
        north: corner.lat + latDelta,
        east: corner.lng,
        west: corner.lng - lngDelta,
      };
    default:
      // Fallback to northwest if unknown
      console.warn(
        `Unknown corner position: ${cornerPosition}, defaulting to northwest`
      );
      return {
        north: corner.lat,
        south: corner.lat - latDelta,
        west: corner.lng,
        east: corner.lng + lngDelta,
      };
  }
}

// Calculate bounds from center point, size, and aspect ratio
function calculateBounds(
  center: { lat: number; lng: number },
  sizeMeters: number,
  aspectRatio = 1 // width / height
): Bounds {
  // 1 degree latitude ≈ 111,000 meters (constant everywhere)
  // 1 degree longitude = cos(latitude) * 111,000 meters (varies by latitude)
  const METERS_PER_LAT_DEG = 111_000;
  const latRadians = (center.lat * Math.PI) / 180;
  const metersPerLngDeg = Math.cos(latRadians) * 111_000;

  // sizeMeters is the longest dimension of the plan
  // Calculate width and height based on aspect ratio
  let widthMeters: number;
  let heightMeters: number;

  if (aspectRatio >= 1) {
    // Landscape: width is larger
    widthMeters = sizeMeters;
    heightMeters = sizeMeters / aspectRatio;
  } else {
    // Portrait: height is larger
    heightMeters = sizeMeters;
    widthMeters = sizeMeters * aspectRatio;
  }

  // Convert meters to degrees
  const latDelta = heightMeters / METERS_PER_LAT_DEG / 2;
  const lngDelta = widthMeters / metersPerLngDeg / 2;

  console.log(
    `[Bounds] Input: sizeMeters=${sizeMeters}, aspectRatio=${aspectRatio.toFixed(3)}`
  );
  console.log(
    `[Bounds] Dimensions: width=${widthMeters.toFixed(1)}m, height=${heightMeters.toFixed(1)}m`
  );
  console.log(
    `[Bounds] At lat=${center.lat.toFixed(4)}: metersPerLngDeg=${metersPerLngDeg.toFixed(0)}`
  );

  return {
    north: center.lat + latDelta,
    south: center.lat - latDelta,
    east: center.lng + lngDelta,
    west: center.lng - lngDelta,
  };
}

// Apply adjustment to bounds
function applyAdjustment(
  currentBounds: Bounds,
  adjustment: RefinementAdjustment
): Bounds {
  const currentCenter = {
    lat: (currentBounds.north + currentBounds.south) / 2,
    lng: (currentBounds.east + currentBounds.west) / 2,
  };

  // Apply shift (convert meters to degrees)
  // Use latitude-dependent longitude conversion
  const latRadians = (currentCenter.lat * Math.PI) / 180;
  const metersPerLngDeg = Math.cos(latRadians) * 111_000;

  const latShift = adjustment.shiftMeters.north / 111_000;
  const lngShift = adjustment.shiftMeters.east / metersPerLngDeg;

  const newCenter = {
    lat: currentCenter.lat + latShift,
    lng: currentCenter.lng + lngShift,
  };

  // Apply scale
  const currentLatSpan = currentBounds.north - currentBounds.south;
  const currentLngSpan = currentBounds.east - currentBounds.west;

  const newLatSpan = currentLatSpan * adjustment.scaleFactor;
  const newLngSpan = currentLngSpan * adjustment.scaleFactor;

  return {
    north: newCenter.lat + newLatSpan / 2,
    south: newCenter.lat - newLatSpan / 2,
    east: newCenter.lng + newLngSpan / 2,
    west: newCenter.lng - newLngSpan / 2,
  };
}

// Convert base64 data URL to base64 string (for Google GenAI)
function dataUrlToBase64(dataUrl: string): { data: string; mimeType: string } {
  const match = dataUrl.match(DATA_URL_REGEX);
  if (!(match?.[1] && match[2])) {
    throw new Error("Invalid data URL format");
  }
  return {
    mimeType: match[1],
    data: match[2],
  };
}

// JSON Schema for extraction response - enforced by Gemini
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    address: {
      type: "string",
      description: "Street address from the document",
      nullable: true,
    },
    city: {
      type: "string",
      description: "City name",
      nullable: true,
    },
    state: {
      type: "string",
      description: "State abbreviation (e.g., AZ, CA)",
      nullable: true,
    },
    roads: {
      type: "array",
      description: "All road/street names found in the document",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Road name as written" },
          direction: {
            type: "string",
            enum: ["north", "south", "east", "west", "unknown"],
            description: "Which side of the site this road is on",
          },
        },
        required: ["name", "direction"],
      },
    },
    intersections: {
      type: "array",
      description: "Pairs of roads that intersect at corners of the site",
      items: {
        type: "object",
        properties: {
          road1: { type: "string" },
          road2: { type: "string" },
          corner: {
            type: "string",
            enum: ["northwest", "northeast", "southwest", "southeast"],
          },
        },
        required: ["road1", "road2", "corner"],
      },
    },
    scaleInfo: {
      type: "string",
      description: "Scale text if found (e.g., '1 inch = 50 feet')",
      nullable: true,
    },
    estimatedSizeMeters: {
      type: "number",
      description: "Estimated site size in meters",
      nullable: true,
    },
  },
  required: ["roads"],
};

// Extract with JSON schema enforcement (non-streaming for reliability)
async function extractWithSchema(
  pdfBase64: string,
  mimeType: string,
  filename: string
): Promise<ExtractedPlanData> {
  if (!genai) {
    throw new Error("GEMINI_API_KEY not set");
  }

  console.log(`[Extract] Using model: ${GEMINI_PRIMARY_MODEL}`);

  const response = await genai.models.generateContent({
    model: GEMINI_PRIMARY_MODEL,
    config: {
      systemInstruction: EXTRACTION_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: EXTRACTION_SCHEMA,
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: `Document: ${filename}` },
          { inlineData: { mimeType, data: pdfBase64 } },
        ],
      },
    ],
  });

  const text = response.text ?? "";
  console.log(`[Extract] Response: ${text.substring(0, 500)}`);

  const data = JSON.parse(text);

  // Map to ExtractedPlanData format
  return {
    address: data.address ?? null,
    city: data.city ?? null,
    state: data.state ?? null,
    streetNames: data.roads?.map((r: { name: string }) => r.name) ?? [],
    landmarks: [],
    scaleInfo: data.scaleInfo ?? null,
    northArrowDegrees: null,
    estimatedSizeMeters: data.estimatedSizeMeters ?? 100,
    confidence: data.roads?.length >= 2 ? 0.8 : 0.5,
    roads:
      data.roads?.map((r: { name: string; direction: string }) => ({
        name: r.name,
        direction: r.direction as
          | "north"
          | "south"
          | "east"
          | "west"
          | "unknown",
        isPrimary: false,
      })) ?? [],
    intersections:
      data.intersections?.map(
        (i: { road1: string; road2: string; corner: string }) => ({
          road1: i.road1,
          road2: i.road2,
          cornerPosition: i.corner as
            | "northwest"
            | "northeast"
            | "southwest"
            | "southeast"
            | "unknown",
        })
      ) ?? [],
    siteShape: "unknown",
    siteBoundary: {
      northRoad:
        data.roads?.find((r: { direction: string }) => r.direction === "north")
          ?.name ?? null,
      southRoad:
        data.roads?.find((r: { direction: string }) => r.direction === "south")
          ?.name ?? null,
      eastRoad:
        data.roads?.find((r: { direction: string }) => r.direction === "east")
          ?.name ?? null,
      westRoad:
        data.roads?.find((r: { direction: string }) => r.direction === "west")
          ?.name ?? null,
    },
  };
}

// Generate content with Google GenAI (streaming)
async function* generateContentStream(
  model: string,
  systemPrompt: string,
  contents: Array<{
    role: "user" | "model";
    parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
      | { fileData: { mimeType: string; fileUri: string } }
    >;
  }>
): AsyncGenerator<string, void, unknown> {
  if (!genai) {
    throw new Error("GEMINI_API_KEY not set");
  }

  console.log(`[GenAI] Using model: ${model}`);
  console.log(`[GenAI] Contents count: ${contents.length}`);

  const response = await genai.models.generateContentStream({
    model,
    config: {
      systemInstruction: systemPrompt,
    },
    contents,
  });

  for await (const chunk of response) {
    const text = chunk.text;
    if (text) {
      yield text;
    }
  }
}

const PORT = Number(Bun.env.PORT) || 7777;

const server = serve({
  port: PORT,
  // Increase idle timeout for long AI operations
  idleTimeout: 120,

  routes: {
    // Serve the PDF.js worker for frontend PDF rendering
    "/pdf-worker.min.mjs": Bun.file(
      new URL(
        "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      )
    ),

    // Config endpoint (Maps key for client)
    "/api/config": {
      GET() {
        return Response.json({
          mapsApiKey: Bun.env.GOOGLE_MAPS_API_KEY ?? "",
          primaryModel: GEMINI_PRIMARY_MODEL,
          fastModel: GEMINI_FAST_MODEL,
        });
      },
    },

    // Geocode an address
    "/api/geocode": {
      async POST(req) {
        try {
          const { address } = await req.json();
          if (!address) {
            return Response.json(
              { error: "address required" },
              { status: 400 }
            );
          }

          const result = await geocodeAddress(address);
          if (!result) {
            return Response.json(
              { error: "Geocoding failed" },
              { status: 404 }
            );
          }

          return Response.json(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    // Geocode an intersection (two roads)
    "/api/geocode/intersection": {
      async POST(req) {
        try {
          const { road1, road2, city, state } = await req.json();
          if (!(road1 && road2 && city)) {
            return Response.json(
              { error: "road1, road2, and city required" },
              { status: 400 }
            );
          }

          const result = await geocodeIntersection(
            road1,
            road2,
            city,
            state || ""
          );
          if (!result) {
            return Response.json(
              { error: `Could not geocode intersection: ${road1} & ${road2}` },
              { status: 404 }
            );
          }

          return Response.json(result);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    // Get road geometry (polyline) for highlighting on map
    "/api/roads/geometry": {
      async POST(req) {
        try {
          const { roadName, intersectionPoint, city, state, radiusMeters } =
            await req.json();

          if (!roadName) {
            return Response.json(
              { error: "roadName required" },
              { status: 400 }
            );
          }

          // Strategy: Try to find the road in multiple ways
          let nearPoint = intersectionPoint;
          const searchRadius = radiusMeters || 1000;

          // If no intersection point provided, or we want to find the road itself,
          // geocode the road name directly
          if (!(nearPoint?.lat && nearPoint?.lng)) {
            const roadQuery =
              `${roadName}, ${city || ""} ${state || ""}`.trim();
            console.log(`[Roads] Geocoding road: "${roadQuery}"`);
            const roadGeocode = await geocodeAddress(roadQuery);
            if (roadGeocode) {
              nearPoint = { lat: roadGeocode.lat, lng: roadGeocode.lng };
              console.log(
                `[Roads] Road geocoded to: ${nearPoint.lat}, ${nearPoint.lng}`
              );
            }
          }

          if (!(nearPoint?.lat && nearPoint?.lng)) {
            return Response.json(
              { error: `Could not locate road: ${roadName}` },
              { status: 404 }
            );
          }

          // Get road geometry using directions API
          const points = await getRoadGeometryBySearch({
            roadName,
            nearPoint,
            city: city || "",
            state: state || "",
            searchRadiusMeters: searchRadius,
          });

          if (!points || points.length === 0) {
            return Response.json(
              { error: `Could not get geometry for road: ${roadName}` },
              { status: 404 }
            );
          }

          return Response.json({
            roadName,
            points,
            pointCount: points.length,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    // Calculate bounds from a corner (intersection) position
    "/api/bounds/from-corner": {
      POST(req) {
        return req
          .json()
          .then(({ corner, cornerPosition, sizeMeters, aspectRatio }) => {
            if (!(corner?.lat && corner?.lng && sizeMeters && cornerPosition)) {
              return Response.json(
                {
                  error:
                    "corner (lat, lng), cornerPosition, and sizeMeters required",
                },
                { status: 400 }
              );
            }
            const bounds = calculateBoundsFromCorner(
              corner,
              cornerPosition,
              sizeMeters,
              aspectRatio || 1
            );
            return Response.json({ bounds });
          });
      },
    },

    // Calculate bounds from center, size, and aspect ratio
    "/api/bounds/calculate": {
      POST(req) {
        return req.json().then(({ center, sizeMeters, aspectRatio }) => {
          if (!(center?.lat && center?.lng && sizeMeters)) {
            return Response.json(
              { error: "center (lat, lng) and sizeMeters required" },
              { status: 400 }
            );
          }
          const bounds = calculateBounds(center, sizeMeters, aspectRatio || 1);
          return Response.json({ bounds });
        });
      },
    },

    // PHASE 1: Extract structured data from plan (with JSON schema)
    "/api/ai/extract": {
      async POST(req) {
        try {
          const { pdfDataUrl, filename } = await req.json();

          if (!pdfDataUrl) {
            return Response.json(
              { error: "pdfDataUrl required" },
              { status: 400 }
            );
          }

          if (!genai) {
            return Response.json(
              { error: "GEMINI_API_KEY not set" },
              { status: 500 }
            );
          }

          // Parse the PDF data URL
          const { data: pdfBase64, mimeType } = dataUrlToBase64(pdfDataUrl);

          // Use schema-enforced extraction
          const extractedData = await extractWithSchema(
            pdfBase64,
            mimeType,
            filename || "plan.pdf"
          );

          // Return as SSE for frontend compatibility
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "status", message: "Extracting..." })}\n\n`
                )
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: "complete",
                    extractedData,
                    rawText: JSON.stringify(extractedData, null, 2),
                  })}\n\n`
                )
              );
              controller.close();
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error("Extract error:", message);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    // PHASE 2: Refine placement by comparing overlay with satellite
    "/api/ai/refine": {
      async POST(req) {
        try {
          const { screenshotDataUrl, pdfDataUrl, currentBounds, sessionId } =
            await req.json();

          if (!(screenshotDataUrl && currentBounds)) {
            return Response.json(
              { error: "screenshotDataUrl and currentBounds required" },
              { status: 400 }
            );
          }

          if (!genai) {
            return Response.json(
              { error: "GEMINI_API_KEY not set" },
              { status: 500 }
            );
          }

          const encoder = new TextEncoder();
          const history = sessions.get(sessionId || "default") ?? [];

          const stream = new ReadableStream({
            async start(controller) {
              try {
                let fullText = "";

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "status", message: "Comparing overlay with satellite..." })}\n\n`
                  )
                );

                const userMessage = `Current overlay bounds:
- North: ${currentBounds.north.toFixed(6)}
- South: ${currentBounds.south.toFixed(6)}
- East: ${currentBounds.east.toFixed(6)}
- West: ${currentBounds.west.toFixed(6)}

Compare the plan overlay (semi-transparent) with the satellite imagery underneath. Suggest adjustments to improve alignment.`;

                // Build content array
                const parts: Array<
                  | { text: string }
                  | { inlineData: { mimeType: string; data: string } }
                > = [{ text: userMessage }];

                // Add screenshot
                const screenshot = dataUrlToBase64(screenshotDataUrl);
                parts.push({
                  inlineData: {
                    mimeType: screenshot.mimeType,
                    data: screenshot.data,
                  },
                });

                // Add original PDF if provided
                if (pdfDataUrl) {
                  const pdf = dataUrlToBase64(pdfDataUrl);
                  parts.push({
                    inlineData: {
                      mimeType: pdf.mimeType,
                      data: pdf.data,
                    },
                  });
                }

                const contents = [...history, { role: "user" as const, parts }];

                console.log("[Refine] Starting Gemini API call...");
                try {
                  for await (const chunk of generateContentStream(
                    GEMINI_PRIMARY_MODEL,
                    REFINEMENT_SYSTEM_PROMPT,
                    contents
                  )) {
                    fullText += chunk;
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`
                      )
                    );
                  }
                  console.log(
                    "[Refine] Stream complete, got",
                    fullText.length,
                    "chars"
                  );
                } catch (streamError) {
                  console.error("[Refine] Stream error:", streamError);
                  // If stream fails, try to continue with whatever we got
                  if (fullText.length === 0) {
                    throw streamError;
                  }
                  console.log("[Refine] Continuing with partial response...");
                }

                // Parse adjustment
                const adjustment =
                  parseJsonResponse<RefinementAdjustment>(fullText);

                // Calculate new bounds if adjustment parsed successfully
                let newBounds: Bounds | null = null;
                if (adjustment) {
                  newBounds = applyAdjustment(currentBounds, adjustment);
                }

                // Update session history
                history.push({ role: "user", parts: [{ text: userMessage }] });
                history.push({ role: "model", parts: [{ text: fullText }] });
                sessions.set(sessionId || "default", history);

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "complete",
                      adjustment,
                      newBounds,
                      rawText: fullText,
                    })}\n\n`
                  )
                );
                controller.close();
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                console.error("Refine error:", message);
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "error", error: message })}\n\n`
                  )
                );
                controller.close();
              }
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error("Refine error:", message);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    // PHASE 3: Deep refinement with iterative terrain/feature matching
    "/api/ai/deep-refine": {
      async POST(req) {
        try {
          const {
            drawingDataUrl,
            terrainScreenshotUrl,
            currentBounds,
            originalBounds,
            iteration,
            maxShiftMeters = 200,
          } = await req.json();

          if (!(drawingDataUrl && terrainScreenshotUrl && currentBounds)) {
            return Response.json(
              {
                error:
                  "drawingDataUrl, terrainScreenshotUrl, and currentBounds required",
              },
              { status: 400 }
            );
          }

          if (!genai) {
            return Response.json(
              { error: "GEMINI_API_KEY not set" },
              { status: 500 }
            );
          }

          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              try {
                let fullText = "";

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "status",
                      message: `Deep refinement iteration ${iteration || 1}...`,
                    })}\n\n`
                  )
                );

                const userMessage = `Iteration ${iteration || 1}: Compare these two images and suggest positioning adjustments.

IMAGE 1: The construction/site plan drawing
IMAGE 2: The terrain map (Google Maps terrain view)

Current overlay position (bounds):
- North: ${currentBounds.north.toFixed(6)}
- South: ${currentBounds.south.toFixed(6)}
- East: ${currentBounds.east.toFixed(6)}
- West: ${currentBounds.west.toFixed(6)}

Find matching features (topography contours, parking lots, road shapes, building outlines) and suggest how to shift the overlay to align them better.`;

                console.log(
                  "[DeepRefine] Starting API call with model:",
                  GEMINI_FAST_MODEL
                );
                console.log(
                  "[DeepRefine] Drawing image size:",
                  drawingDataUrl?.length || 0,
                  "chars"
                );
                console.log(
                  "[DeepRefine] Terrain image size:",
                  terrainScreenshotUrl?.length || 0,
                  "chars"
                );

                // Parse image data URLs
                const drawing = dataUrlToBase64(drawingDataUrl);
                const terrain = dataUrlToBase64(terrainScreenshotUrl);

                const contents = [
                  {
                    role: "user" as const,
                    parts: [
                      { text: userMessage },
                      {
                        inlineData: {
                          mimeType: drawing.mimeType,
                          data: drawing.data,
                        },
                      },
                      {
                        inlineData: {
                          mimeType: terrain.mimeType,
                          data: terrain.data,
                        },
                      },
                    ],
                  },
                ];

                for await (const chunk of generateContentStream(
                  GEMINI_FAST_MODEL,
                  DEEP_REFINEMENT_SYSTEM_PROMPT,
                  contents
                )) {
                  fullText += chunk;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`
                    )
                  );
                }

                console.log(
                  "[DeepRefine] AI response length:",
                  fullText.length
                );
                console.log(
                  "[DeepRefine] AI response (first 500 chars):",
                  fullText.substring(0, 500)
                );

                // Parse adjustment
                const adjustment = parseJsonResponse<
                  RefinementAdjustment & { featuresMatched?: string[] }
                >(fullText);

                console.log("[DeepRefine] Parsed adjustment:", adjustment);

                let newBounds: Bounds | null = null;
                let boundsClamped = false;

                if (adjustment) {
                  // Clamp shifts to maxShiftMeters from original position
                  if (originalBounds) {
                    const originalCenter = {
                      lat: (originalBounds.north + originalBounds.south) / 2,
                      lng: (originalBounds.east + originalBounds.west) / 2,
                    };
                    const currentCenter = {
                      lat: (currentBounds.north + currentBounds.south) / 2,
                      lng: (currentBounds.east + currentBounds.west) / 2,
                    };

                    // Calculate current offset from original in meters
                    const currentOffsetNorth =
                      (currentCenter.lat - originalCenter.lat) * 111_000;
                    const currentOffsetEast =
                      (currentCenter.lng - originalCenter.lng) *
                      111_000 *
                      Math.cos((currentCenter.lat * Math.PI) / 180);

                    // Check if proposed shift would exceed bounds
                    const proposedOffsetNorth =
                      currentOffsetNorth + adjustment.shiftMeters.north;
                    const proposedOffsetEast =
                      currentOffsetEast + adjustment.shiftMeters.east;

                    if (Math.abs(proposedOffsetNorth) > maxShiftMeters) {
                      adjustment.shiftMeters.north =
                        Math.sign(proposedOffsetNorth) * maxShiftMeters -
                        currentOffsetNorth;
                      boundsClamped = true;
                    }
                    if (Math.abs(proposedOffsetEast) > maxShiftMeters) {
                      adjustment.shiftMeters.east =
                        Math.sign(proposedOffsetEast) * maxShiftMeters -
                        currentOffsetEast;
                      boundsClamped = true;
                    }
                  }

                  newBounds = applyAdjustment(currentBounds, adjustment);
                }

                // Determine if we should continue iterating
                const shouldContinue =
                  adjustment &&
                  adjustment.confidence < 0.9 &&
                  (Math.abs(adjustment.shiftMeters.north) > 2 ||
                    Math.abs(adjustment.shiftMeters.east) > 2);

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "complete",
                      adjustment,
                      newBounds,
                      boundsClamped,
                      shouldContinue,
                      rawText: fullText,
                    })}\n\n`
                  )
                );
                controller.close();
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                console.error("Deep refine error:", message);
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "error", error: message })}\n\n`
                  )
                );
                controller.close();
              }
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error("Deep refine error:", message);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    // Clear session
    "/api/ai/session/:sessionId": {
      DELETE(req) {
        const { sessionId } = req.params;
        sessions.delete(sessionId);
        return Response.json({ success: true });
      },
    },

    // Serve index.html for all unmatched routes
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`Plan Overlay Tool running at ${server.url}`);
console.log(`Using primary model: ${GEMINI_PRIMARY_MODEL}`);
console.log(`Using fast model: ${GEMINI_FAST_MODEL}`);
console.log("AI SDK: Google GenAI SDK (@google/genai) - Direct integration");
