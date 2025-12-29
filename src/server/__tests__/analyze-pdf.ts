import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});

async function analyzePdf() {
  const pdfPath =
    "/Users/chiejimofor/Documents/Github/auto-custom-map-for-dust-permit/Sun_Health_La_Loma_Campus_Drawings-COMPILED_R1-2025-compressed.pdf";

  console.log("Uploading PDF to Gemini...");
  const file = await ai.files.upload({
    file: pdfPath,
    config: { mimeType: "application/pdf" },
  });

  const fileUri = file.uri ?? "";
  const fileMimeType = file.mimeType ?? "application/pdf";
  const fileName = file.name ?? "";

  console.log(`Uploaded: ${fileName}`);
  console.log(`URI: ${fileUri}`);

  try {
    console.log("\nAnalyzing PDF content...\n");

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                fileUri,
                mimeType: fileMimeType,
              },
            },
            {
              text: `Analyze this construction/engineering PDF plan set.

I need you to find LOCATION DATA. Specifically:

1. PROJECT NAME - What is this project called?
2. PROJECT ADDRESS - The SITE address where construction happens (NOT the engineer's office, NOT the owner's mailing address)
3. CITY, STATE, COUNTY
4. ROADS - What roads/streets are shown AROUND THE SITE PERIMETER?
5. INTERSECTIONS - What road intersections define the corners of this site?
6. PARCEL NUMBER / APN - Is there a tax parcel number?
7. WHICH PAGES have the SITE PLAN (top-down view of entire property)?

Be very careful:
- There are MANY addresses in a plan set (owner address, engineer address, contractor address)
- I only want the SITE/PROJECT address where the actual construction is happening
- Look at the SITE PLAN pages to find roads around the property

Return structured data:
{
  "projectName": "...",
  "siteAddress": "..." or null,
  "city": "...",
  "state": "...", 
  "county": "...",
  "perimeterRoads": ["road1", "road2", ...],
  "intersections": [{"road1": "...", "road2": "...", "corner": "NW/NE/SW/SE"}],
  "parcelNumber": "..." or null,
  "sitePlanPages": [page numbers],
  "confidence": 0.0-1.0,
  "notes": "any important observations"
}`,
            },
          ],
        },
      ],
    });

    console.log("=== ANALYSIS RESULT ===\n");
    console.log(response.text);
  } finally {
    console.log("\nCleaning up...");
    await ai.files.delete({ name: fileName });
    console.log("Done.");
  }
}

analyzePdf().catch(console.error);
