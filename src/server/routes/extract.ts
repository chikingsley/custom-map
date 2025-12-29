import { extractPlanData, extractPlanDataFast } from "../lib/gemini";

const DATA_URL_REGEX = /^data:([^;]+);base64,(.+)$/;

/**
 * POST /api/ai/extract
 * Extract location data from a construction plan image
 *
 * Body: { image: string (data URL), filename: string, useGrounding?: boolean, locationBias?: { lat, lng } }
 */
export async function handleExtract(req: Request): Promise<Response> {
  const body = await req.json();
  const { image, filename, useGrounding = true, locationBias } = body;

  if (!image) {
    return Response.json(
      { error: "image (data URL) required" },
      { status: 400 }
    );
  }

  // Parse data URL
  const match = image.match(DATA_URL_REGEX);
  if (!(match?.[1] && match[2])) {
    return Response.json({ error: "Invalid data URL format" }, { status: 400 });
  }

  const mimeType = match[1];
  const imageBase64 = match[2];

  console.log(
    `[Extract] Processing ${filename ?? "unknown"}, size: ${imageBase64.length} bytes`
  );

  // Use fast extraction or grounding-enabled extraction
  if (useGrounding) {
    const result = await extractPlanData(
      imageBase64,
      mimeType,
      filename ?? "document",
      {
        useGrounding: true,
        locationBias,
      }
    );

    return Response.json({
      data: result.data,
      groundingSources: result.groundingSources,
      modelUsed: result.modelUsed,
    });
  }

  const data = await extractPlanDataFast(
    imageBase64,
    mimeType,
    filename ?? "document"
  );
  return Response.json({
    data,
    groundingSources: [],
    modelUsed: "gemini-3-flash-preview",
  });
}
