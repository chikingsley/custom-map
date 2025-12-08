import { GoogleGenAI } from "@google/genai";
import { serve } from "bun";
import index from "./index.html";

// Gemini setup - use gemini-3-pro-preview for advanced reasoning
const GEMINI_MODEL = Bun.env.GEMINI_MODEL ?? "gemini-3-pro-preview";
const geminiClient = Bun.env.GEMINI_API_KEY
	? new GoogleGenAI({ apiKey: Bun.env.GEMINI_API_KEY })
	: null;

// Store conversation history per session for multi-turn
const sessions = new Map<string, Array<{ role: string; parts: any[] }>>();

// System prompt for the AI assistant
const SYSTEM_PROMPT = `You are an AI assistant specialized in analyzing construction plans, SWPPP plans, site plans, and similar documents. Your job is to:

1. Extract location information from the plan (address, city, state, coordinates, landmarks, site names)
2. Identify the geographic area and suggest appropriate map bounds for overlay positioning
3. Help refine the overlay position based on visual feedback

When analyzing a plan, look for:
- Title blocks with address/location info
- Scale bars and north arrows for orientation
- Surrounding streets, landmarks, or geographic features
- Coordinate systems or survey references
- Site boundaries and property lines

When suggesting bounds, provide them in this JSON format within your response:
{"bounds": {"north": lat, "south": lat, "east": lng, "west": lng}}

Be conversational but concise. Focus on actionable positioning advice.`;

// Status messages for streaming feedback
const STATUS_MESSAGES = [
	"Reading document metadata...",
	"Scanning for location information...",
	"Analyzing title block...",
	"Looking for coordinates...",
	"Identifying landmarks...",
	"Checking street names...",
	"Calculating map bounds...",
	"Verifying position...",
];

// Streaming analysis with thinking support
async function* analyzeplanStreamWithThinking(
	imageDataUrl: string,
	filename: string,
) {
	if (!geminiClient) {
		throw new Error("GEMINI_API_KEY not set");
	}

	const base64 = imageDataUrl.split(",")[1];
	const mimeType = imageDataUrl.includes("image/png")
		? "image/png"
		: "image/jpeg";

	// Emit initial status
	yield { type: "status", message: "Starting analysis..." };

	try {
		const result = await geminiClient.models.generateContentStream({
			model: GEMINI_MODEL,
			contents: [
				{
					role: "user",
					parts: [
						{ text: SYSTEM_PROMPT },
						{
							text: `Please analyze this construction/site plan named "${filename}". Extract the location information and suggest appropriate map bounds for positioning this overlay on Google Maps satellite view. If you can identify the location, suggest bounds that would properly frame this plan on the map.`,
						},
						{
							inlineData: {
								data: base64,
								mimeType,
							},
						},
					],
				},
			],
			config: {
				// Enable thinking for better reasoning (Gemini 3 Pro feature)
				thinkingConfig: {
					thinkingBudget: 2048,
				},
			},
		});

		let chunkCount = 0;
		let lastStatusIndex = 0;

		for await (const chunk of result) {
			chunkCount++;

			// Check for thinking content (internal reasoning)
			const thinkingParts = chunk.candidates?.[0]?.content?.parts?.filter(
				(p: any) => p.thought === true,
			);

			if (thinkingParts && thinkingParts.length > 0) {
				for (const part of thinkingParts) {
					if (part.text) {
						yield { type: "thinking", text: part.text };
					}
				}
			}

			// Regular text content
			const text = chunk.text;
			if (text) {
				yield { type: "text", text };
			}

			// Emit periodic status updates based on chunk count
			if (chunkCount % 3 === 0 && lastStatusIndex < STATUS_MESSAGES.length) {
				yield { type: "status", message: STATUS_MESSAGES[lastStatusIndex] };
				lastStatusIndex++;
			}
		}

		yield { type: "status", message: "Finalizing analysis..." };
	} catch (error) {
		// If thinking config fails, fall back to regular streaming
		console.log(
			"Falling back to regular streaming (thinking may not be supported)",
		);

		const result = await geminiClient.models.generateContentStream({
			model: GEMINI_MODEL,
			contents: [
				{
					role: "user",
					parts: [
						{ text: SYSTEM_PROMPT },
						{
							text: `Please analyze this construction/site plan named "${filename}". Extract the location information and suggest appropriate map bounds for positioning this overlay on Google Maps satellite view. If you can identify the location, suggest bounds that would properly frame this plan on the map.`,
						},
						{
							inlineData: {
								data: base64,
								mimeType,
							},
						},
					],
				},
			],
		});

		let chunkCount = 0;
		let lastStatusIndex = 0;

		for await (const chunk of result) {
			chunkCount++;
			const text = chunk.text;
			if (text) {
				yield { type: "text", text };
			}

			// Emit periodic status updates
			if (chunkCount % 3 === 0 && lastStatusIndex < STATUS_MESSAGES.length) {
				yield { type: "status", message: STATUS_MESSAGES[lastStatusIndex] };
				lastStatusIndex++;
			}
		}
	}
}

// Non-streaming analysis (kept for fallback)
async function analyzeplan(imageDataUrl: string, filename: string) {
	if (!geminiClient) {
		throw new Error("GEMINI_API_KEY not set");
	}

	const base64 = imageDataUrl.split(",")[1];
	const mimeType = imageDataUrl.includes("image/png")
		? "image/png"
		: "image/jpeg";

	const result = await geminiClient.models.generateContent({
		model: GEMINI_MODEL,
		contents: [
			{
				role: "user",
				parts: [
					{ text: SYSTEM_PROMPT },
					{
						text: `Please analyze this construction/site plan named "${filename}". Extract the location information and suggest appropriate map bounds for positioning this overlay on Google Maps satellite view. If you can identify the location, suggest bounds that would properly frame this plan on the map.`,
					},
					{
						inlineData: {
							data: base64,
							mimeType,
						},
					},
				],
			},
		],
	});

	const responseText = result.text ?? "";

	// Try to extract bounds from the response
	let bounds = null;
	const boundsMatch = responseText.match(/\{"bounds":\s*\{[^}]+\}\}/);
	if (boundsMatch) {
		try {
			const parsed = JSON.parse(boundsMatch[0]);
			bounds = parsed.bounds;
		} catch (e) {
			// Bounds parsing failed, that's ok
		}
	}

	// Also try to find coordinates mentioned in text
	if (!bounds) {
		const latMatch = responseText.match(/(?:latitude|lat)[:\s]+(-?\d+\.?\d*)/i);
		const lngMatch = responseText.match(
			/(?:longitude|lng|lon)[:\s]+(-?\d+\.?\d*)/i,
		);

		if (latMatch?.[1] && lngMatch?.[1]) {
			const lat = parseFloat(latMatch[1]);
			const lng = parseFloat(lngMatch[1]);
			bounds = {
				north: lat + 0.001,
				south: lat - 0.001,
				east: lng + 0.0015,
				west: lng - 0.0015,
			};
		}
	}

	const cleanedText = responseText
		.replace(/\{"bounds":\s*\{[^}]+\}\}/, "")
		.trim();

	return {
		analysis: cleanedText,
		bounds,
	};
}

async function refinePlacement(
	screenshotDataUrl: string,
	planDataUrl: string,
	currentBounds: { north: number; south: number; east: number; west: number },
	sessionId: string,
) {
	if (!geminiClient) {
		throw new Error("GEMINI_API_KEY not set");
	}

	const screenshotBase64 = screenshotDataUrl.split(",")[1];

	// Get or create session history
	const history = sessions.get(sessionId) || [];

	const userMessage = {
		role: "user",
		parts: [
			{
				text: `Here's the current map view with the plan overlay. The current bounds are:
North: ${currentBounds.north}
South: ${currentBounds.south}
East: ${currentBounds.east}
West: ${currentBounds.west}

Please analyze how well the plan is positioned and suggest adjustments. Look at:
1. Does the site boundary match the visible features?
2. Are roads, parking lots, or buildings aligned correctly?
3. Is the scale appropriate?

If adjustments are needed, provide new bounds in JSON format: {"bounds": {"north": lat, "south": lat, "east": lng, "west": lng}}`,
			},
			{
				inlineData: {
					data: screenshotBase64,
					mimeType: "image/png",
				},
			},
		],
	};

	history.push(userMessage);

	const result = await geminiClient.models.generateContent({
		model: GEMINI_MODEL,
		contents: [
			{
				role: "user",
				parts: [{ text: SYSTEM_PROMPT }],
			},
			...history,
		],
	});

	const responseText = result.text ?? "";

	let bounds = null;
	const boundsMatch = responseText.match(/\{"bounds":\s*\{[^}]+\}\}/);
	if (boundsMatch) {
		try {
			const parsed = JSON.parse(boundsMatch[0]);
			bounds = parsed.bounds;
		} catch (e) {
			// Bounds parsing failed
		}
	}

	history.push({
		role: "model",
		parts: [{ text: responseText }],
	});
	sessions.set(sessionId, history);

	const cleanedText = responseText
		.replace(/\{"bounds":\s*\{[^}]+\}\}/, "")
		.trim();

	return {
		analysis: cleanedText,
		bounds,
	};
}

const server = serve({
	routes: {
		// Serve the PDF.js worker
		"/pdf-worker.min.mjs": Bun.file(
			new URL(
				"../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
				import.meta.url,
			),
		),

		// Config endpoint (Maps key for client)
		"/api/config": {
			async GET() {
				return Response.json({
					mapsApiKey: Bun.env.GOOGLE_MAPS_API_KEY ?? "",
					model: GEMINI_MODEL,
				});
			},
		},

		// Initial plan analysis (non-streaming)
		"/api/ai/analyze": {
			async POST(req) {
				try {
					const { imageDataUrl, filename } = await req.json();

					if (!imageDataUrl) {
						return Response.json(
							{ error: "imageDataUrl required" },
							{ status: 400 },
						);
					}

					const result = await analyzeplan(
						imageDataUrl,
						filename || "plan.pdf",
					);
					return Response.json(result);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error("Analysis error:", message);
					return Response.json({ error: message }, { status: 500 });
				}
			},
		},

		// Streaming analysis endpoint with thinking
		"/api/ai/analyze/stream": {
			async POST(req) {
				try {
					const { imageDataUrl, filename } = await req.json();

					if (!imageDataUrl) {
						return Response.json(
							{ error: "imageDataUrl required" },
							{ status: 400 },
						);
					}

					const encoder = new TextEncoder();
					const stream = new ReadableStream({
						async start(controller) {
							try {
								let fullText = "";
								let allThinking = "";

								for await (const chunk of analyzeplanStreamWithThinking(
									imageDataUrl,
									filename || "plan.pdf",
								)) {
									if (chunk.type === "text") {
										fullText += chunk.text;
									} else if (chunk.type === "thinking") {
										allThinking += chunk.text;
									}

									// Send all chunk types to client
									controller.enqueue(
										encoder.encode(
											`data: ${JSON.stringify({ ...chunk, done: false })}\n\n`,
										),
									);
								}

								// Extract bounds from complete text
								let bounds = null;
								const boundsMatch = fullText.match(/\{"bounds":\s*\{[^}]+\}\}/);
								if (boundsMatch) {
									try {
										const parsed = JSON.parse(boundsMatch[0]);
										bounds = parsed.bounds;
									} catch (e) {}
								}

								if (!bounds) {
									const latMatch = fullText.match(
										/(?:latitude|lat)[:\s]+(-?\d+\.?\d*)/i,
									);
									const lngMatch = fullText.match(
										/(?:longitude|lng|lon)[:\s]+(-?\d+\.?\d*)/i,
									);
									if (latMatch?.[1] && lngMatch?.[1]) {
										const lat = parseFloat(latMatch[1]);
										const lng = parseFloat(lngMatch[1]);
										bounds = {
											north: lat + 0.001,
											south: lat - 0.001,
											east: lng + 0.0015,
											west: lng - 0.0015,
										};
									}
								}

								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({
											type: "complete",
											done: true,
											bounds,
											thinking: allThinking || undefined,
										})}\n\n`,
									),
								);
								controller.close();
							} catch (error) {
								const message =
									error instanceof Error ? error.message : String(error);
								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ type: "error", error: message, done: true })}\n\n`,
									),
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
					console.error("Stream error:", message);
					return Response.json({ error: message }, { status: 500 });
				}
			},
		},

		// Refinement with screenshot
		"/api/ai/refine": {
			async POST(req) {
				try {
					const { screenshotDataUrl, planDataUrl, currentBounds, sessionId } =
						await req.json();

					if (!screenshotDataUrl || !currentBounds) {
						return Response.json(
							{ error: "screenshotDataUrl and currentBounds required" },
							{ status: 400 },
						);
					}

					const result = await refinePlacement(
						screenshotDataUrl,
						planDataUrl,
						currentBounds,
						sessionId || "default",
					);
					return Response.json(result);
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.error("Refinement error:", message);
					return Response.json({ error: message }, { status: 500 });
				}
			},
		},

		// Clear session
		"/api/ai/session/:sessionId": {
			async DELETE(req) {
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

console.log(`🚀 Plan Overlay Tool running at ${server.url}`);
console.log(`📊 Using model: ${GEMINI_MODEL}`);
