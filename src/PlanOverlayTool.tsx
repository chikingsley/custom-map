import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import html2canvas from "html2canvas";
import {
	Brain,
	CheckCircle2,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	Eye,
	EyeOff,
	Loader2,
	MapPin,
	Maximize2,
	Move,
	RotateCcw,
	Sparkles,
	Upload,
	XCircle,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type LatLngLiteral = { lat: number; lng: number };
type LatLngBoundsLiteral = {
	north: number;
	south: number;
	east: number;
	west: number;
};

type AIMessage = {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: Date;
	bounds?: LatLngBoundsLiteral;
	thinking?: string;
	isStreaming?: boolean;
};

// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf-worker.min.mjs";

async function pdfFirstPageToDataUrl(file: File, scale = 2): Promise<string> {
	const arrayBuffer = await file.arrayBuffer();
	const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
	const page = await doc.getPage(1);
	const viewport = page.getViewport({ scale });
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas 2D context unavailable");
	canvas.height = viewport.height;
	canvas.width = viewport.width;
	await page.render({ canvasContext: context, viewport, canvas }).promise;
	return canvas.toDataURL("image/png");
}

// Draggable/resizable overlay component
function DraggableOverlay({
	imageUrl,
	bounds,
	opacity,
	isVisible,
}: {
	imageUrl: string;
	bounds: LatLngBoundsLiteral;
	opacity: number;
	onBoundsChange: (bounds: LatLngBoundsLiteral) => void;
	isVisible: boolean;
}) {
	const map = useMap();
	const overlayRef = useRef<google.maps.GroundOverlay | null>(null);

	useEffect(() => {
		if (!map || !bounds || !imageUrl || !isVisible) {
			if (overlayRef.current) {
				overlayRef.current.setMap(null);
				overlayRef.current = null;
			}
			return;
		}

		// Remove existing overlay
		if (overlayRef.current) {
			overlayRef.current.setMap(null);
		}

		// Create new overlay
		const overlay = new google.maps.GroundOverlay(imageUrl, bounds, {
			opacity,
			clickable: true,
		});
		overlay.setMap(map);
		overlayRef.current = overlay;

		return () => {
			if (overlayRef.current) {
				overlayRef.current.setMap(null);
				overlayRef.current = null;
			}
		};
	}, [map, bounds, imageUrl, opacity, isVisible]);

	// Update opacity without recreating overlay
	useEffect(() => {
		if (overlayRef.current) {
			overlayRef.current.setOpacity(opacity);
		}
	}, [opacity]);

	return null;
}

// Corner markers for resizing - using library Marker component
function CornerMarkers({
	bounds,
	onBoundsChange,
}: {
	bounds: LatLngBoundsLiteral;
	onBoundsChange: (bounds: LatLngBoundsLiteral) => void;
}) {
	const corners = [
		{ lat: bounds.north, lng: bounds.west, label: "NW", type: "nw" },
		{ lat: bounds.north, lng: bounds.east, label: "NE", type: "ne" },
		{ lat: bounds.south, lng: bounds.west, label: "SW", type: "sw" },
		{ lat: bounds.south, lng: bounds.east, label: "SE", type: "se" },
	];

	const handleDrag = (type: string, e: google.maps.MapMouseEvent) => {
		if (!e.latLng) return;
		const lat = e.latLng.lat();
		const lng = e.latLng.lng();

		const newBounds = { ...bounds };
		if (type.includes("n")) newBounds.north = lat;
		if (type.includes("s")) newBounds.south = lat;
		if (type.includes("w")) newBounds.west = lng;
		if (type.includes("e")) newBounds.east = lng;

		// Ensure bounds are valid
		if (newBounds.north > newBounds.south && newBounds.east > newBounds.west) {
			onBoundsChange(newBounds);
		}
	};

	return (
		<>
			{corners.map(({ lat, lng, label, type }) => (
				<Marker
					key={type}
					position={{ lat, lng }}
					draggable={true}
					label={{
						text: label,
						color: "white",
						fontSize: "10px",
						fontWeight: "bold",
					}}
					icon={{
						path: google.maps.SymbolPath.CIRCLE,
						scale: 8,
						fillColor: "#3b82f6",
						fillOpacity: 1,
						strokeColor: "white",
						strokeWeight: 2,
					}}
					onDrag={(e) => handleDrag(type, e)}
					onDragEnd={(e) => handleDrag(type, e)}
				/>
			))}
		</>
	);
}

// Map controller for programmatic map actions
function MapController({
	bounds,
	shouldFitBounds,
	onFitComplete,
}: {
	bounds: LatLngBoundsLiteral;
	shouldFitBounds: boolean;
	onFitComplete: () => void;
}) {
	const map = useMap();

	useEffect(() => {
		if (!map || !shouldFitBounds) return;

		const googleBounds = new google.maps.LatLngBounds(
			{ lat: bounds.south, lng: bounds.west },
			{ lat: bounds.north, lng: bounds.east },
		);
		map.fitBounds(googleBounds, 50); // 50px padding
		onFitComplete();
	}, [map, bounds, shouldFitBounds, onFitComplete]);

	return null;
}

export function PlanOverlayTool() {
	// State
	const [mapsApiKey, setMapsApiKey] = useState<string | null>(null);
	const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);
	const [bounds, setBounds] = useState<LatLngBoundsLiteral>({
		north: 33.345,
		south: 33.338,
		east: -111.922,
		west: -111.934,
	});
	const [opacity, setOpacity] = useState(0.6);
	const [isOverlayVisible, setIsOverlayVisible] = useState(true);
	const [isDraggingFile, setIsDraggingFile] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isPanelOpen, setIsPanelOpen] = useState(true);

	// AI state
	const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
	const [isAiThinking, setIsAiThinking] = useState(false);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [currentStatus, setCurrentStatus] = useState<string | null>(null);
	const [currentThinking, setCurrentThinking] = useState<string>("");
	const [expandedThinking, setExpandedThinking] = useState<Set<number>>(
		new Set(),
	);

	// Refs
	const mapContainerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Map fit state
	const [shouldFitBounds, setShouldFitBounds] = useState(false);

	// Load config on mount
	useEffect(() => {
		fetch("/api/config")
			.then((res) => res.json())
			.then((data: { mapsApiKey?: string }) =>
				setMapsApiKey(data.mapsApiKey ?? ""),
			)
			.catch(() => setMapsApiKey(""));
	}, []);

	// Auto-scroll messages
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [aiMessages]);

	const center = useMemo<LatLngLiteral>(
		() => ({
			lat: (bounds.north + bounds.south) / 2,
			lng: (bounds.east + bounds.west) / 2,
		}),
		[bounds],
	);

	// File handling
	const handleFile = useCallback(async (file: File) => {
		if (!file.type.includes("pdf")) {
			alert("Please upload a PDF file");
			return;
		}

		setIsLoading(true);
		setFileName(file.name);

		try {
			const dataUrl = await pdfFirstPageToDataUrl(file);
			setOverlayUrl(dataUrl);

			// Start AI analysis
			setSessionId(crypto.randomUUID());
			setAiMessages([
				{
					role: "system",
					content: `Analyzing "${file.name}"...`,
					timestamp: new Date(),
				},
			]);

			// Call AI to analyze and position
			await analyzeAndPosition(dataUrl, file.name);
		} catch (error) {
			console.error(error);
			setAiMessages((prev) => [
				...prev,
				{
					role: "system",
					content: `Error: Could not process the PDF. ${error}`,
					timestamp: new Date(),
				},
			]);
		} finally {
			setIsLoading(false);
		}
	}, []);

	// Analyze with AI and get initial position (with streaming)
	const analyzeAndPosition = async (imageDataUrl: string, filename: string) => {
		setIsAiThinking(true);
		setCurrentStatus("Starting analysis...");
		setCurrentThinking("");

		// Add a placeholder message that we'll update
		const msgIndex = aiMessages.length;
		setAiMessages((prev) => [
			...prev,
			{
				role: "assistant",
				content: "",
				timestamp: new Date(),
				isStreaming: true,
			},
		]);

		try {
			const res = await fetch("/api/ai/analyze/stream", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					imageDataUrl,
					filename,
				}),
			});

			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}

			const reader = res.body?.getReader();
			if (!reader) throw new Error("No response body");

			const decoder = new TextDecoder();
			let fullText = "";
			let fullThinking = "";
			let finalBounds: LatLngBoundsLiteral | undefined;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value);
				const lines = chunk
					.split("\n")
					.filter((line) => line.startsWith("data: "));

				for (const line of lines) {
					const jsonStr = line.slice(6); // Remove "data: "
					try {
						const data = JSON.parse(jsonStr);

						if (data.type === "error" || data.error) {
							throw new Error(data.error || "Unknown error");
						}

						// Handle status updates
						if (data.type === "status" && data.message) {
							setCurrentStatus(data.message);
						}

						// Handle thinking/reasoning
						if (data.type === "thinking" && data.text) {
							fullThinking += data.text;
							setCurrentThinking(fullThinking);
						}

						// Handle main text content
						if (data.type === "text" && data.text) {
							fullText += data.text;
							// Update the message in place
							setAiMessages((prev) => {
								const updated = [...prev];
								const existingMsg = updated[msgIndex + 1];
								if (existingMsg) {
									updated[msgIndex + 1] = {
										role: existingMsg.role,
										timestamp: existingMsg.timestamp,
										bounds: existingMsg.bounds,
										thinking: fullThinking || undefined,
										isStreaming: true,
										content: fullText
											.replace(/\{"bounds":\s*\{[^}]+\}\}/, "")
											.trim(),
									};
								}
								return updated;
							});
						}

						// Handle completion
						if (data.type === "complete" && data.done) {
							finalBounds = data.bounds;
							if (data.thinking) {
								fullThinking = data.thinking;
							}
						}
					} catch (e) {
						if (e instanceof Error && e.message !== "Unknown error") {
							throw e;
						}
						// JSON parse error, skip
					}
				}
			}

			// Finalize message
			setAiMessages((prev) => {
				const updated = [...prev];
				const existingMsg = updated[msgIndex + 1];
				if (existingMsg) {
					updated[msgIndex + 1] = {
						role: existingMsg.role,
						timestamp: existingMsg.timestamp,
						content:
							existingMsg.content ||
							fullText.replace(/\{"bounds":\s*\{[^}]+\}\}/, "").trim(),
						bounds: finalBounds,
						thinking: fullThinking || undefined,
						isStreaming: false,
					};
				}
				return updated;
			});

			// Apply bounds if found
			if (finalBounds) {
				setBounds(finalBounds);
				setShouldFitBounds(true); // Pan to show the overlay
			}

			setCurrentStatus(null);
			setCurrentThinking("");
		} catch (error) {
			setAiMessages((prev) => {
				const updated = [...prev];
				const existingMsg = updated[msgIndex + 1];
				if (existingMsg) {
					updated[msgIndex + 1] = {
						role: existingMsg.role,
						timestamp: existingMsg.timestamp,
						bounds: existingMsg.bounds,
						isStreaming: false,
						content: `I encountered an issue analyzing the plan: ${error}. You can still manually position the overlay using the corner handles.`,
					};
				}
				return updated;
			});
			setCurrentStatus(null);
			setCurrentThinking("");
		} finally {
			setIsAiThinking(false);
		}
	};

	// Request AI refinement with screenshot
	const requestRefinement = async () => {
		if (!mapContainerRef.current || !overlayUrl) return;

		setIsAiThinking(true);
		setAiMessages((prev) => [
			...prev,
			{
				role: "user",
				content: "Please refine the positioning based on the current view.",
				timestamp: new Date(),
			},
		]);

		try {
			// Capture screenshot of the map
			const canvas = await html2canvas(mapContainerRef.current, {
				useCORS: true,
				allowTaint: true,
				logging: false,
			});
			const screenshotUrl = canvas.toDataURL("image/png");

			const res = await fetch("/api/ai/refine", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					screenshotDataUrl: screenshotUrl,
					planDataUrl: overlayUrl,
					currentBounds: bounds,
					sessionId,
				}),
			});

			const data = await res.json();

			if (data.error) {
				throw new Error(data.error);
			}

			setAiMessages((prev) => [
				...prev,
				{
					role: "assistant",
					content: data.analysis,
					timestamp: new Date(),
					bounds: data.bounds,
				},
			]);

			if (data.bounds) {
				setBounds(data.bounds);
				setShouldFitBounds(true);
			}
		} catch (error) {
			setAiMessages((prev) => [
				...prev,
				{
					role: "assistant",
					content: `Refinement failed: ${error}`,
					timestamp: new Date(),
				},
			]);
		} finally {
			setIsAiThinking(false);
		}
	};

	// Drag and drop handlers
	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDraggingFile(true);
	};

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDraggingFile(false);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDraggingFile(false);
		const file = e.dataTransfer.files[0];
		if (file) handleFile(file);
	};

	const handleBoundsChange = useCallback((newBounds: LatLngBoundsLiteral) => {
		setBounds(newBounds);
	}, []);

	// Default bounds (for reset)
	const defaultBounds: LatLngBoundsLiteral = {
		north: 33.345,
		south: 33.338,
		east: -111.922,
		west: -111.934,
	};

	// Reset everything
	const handleReset = () => {
		setOverlayUrl(null);
		setFileName(null);
		setAiMessages([]);
		setSessionId(null);
		setBounds(defaultBounds);
		setOpacity(0.6);
		setIsOverlayVisible(true);
	};

	// Reset just the bounds
	const handleResetBounds = () => {
		setBounds(defaultBounds);
		setAiMessages((prev) => [
			...prev,
			{
				role: "system",
				content: "Bounds reset to default position.",
				timestamp: new Date(),
			},
		]);
	};

	if (mapsApiKey === null) {
		return (
			<div className="h-screen w-screen flex items-center justify-center bg-muted">
				<Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	if (!mapsApiKey) {
		return (
			<div className="h-screen w-screen flex items-center justify-center bg-muted">
				<Card className="p-6 max-w-md">
					<div className="flex items-center gap-3 text-destructive">
						<XCircle className="w-6 h-6" />
						<div>
							<h2 className="font-semibold">Configuration Error</h2>
							<p className="text-sm text-muted-foreground">
								GOOGLE_MAPS_API_KEY is not configured.
							</p>
						</div>
					</div>
				</Card>
			</div>
		);
	}

	return (
		<div className="h-screen w-screen flex relative overflow-hidden">
			{/* Main Map Area */}
			<div
				ref={mapContainerRef}
				className="flex-1 relative"
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
			>
				<APIProvider apiKey={mapsApiKey}>
					<Map
						defaultZoom={16}
						center={center}
						gestureHandling="greedy"
						disableDefaultUI={false}
						mapTypeId="satellite"
						mapTypeControl={true}
						streetViewControl={false}
						fullscreenControl={false}
						zoomControl={true}
						mapId="plan-overlay-map"
						style={{ width: "100%", height: "100%" }}
					>
						<MapController
							bounds={bounds}
							shouldFitBounds={shouldFitBounds}
							onFitComplete={() => setShouldFitBounds(false)}
						/>
						{overlayUrl && (
							<>
								<DraggableOverlay
									imageUrl={overlayUrl}
									bounds={bounds}
									opacity={opacity}
									onBoundsChange={handleBoundsChange}
									isVisible={isOverlayVisible}
								/>
								{isOverlayVisible && (
									<CornerMarkers
										bounds={bounds}
										onBoundsChange={handleBoundsChange}
									/>
								)}
							</>
						)}
					</Map>
				</APIProvider>

				{/* Drag overlay indicator */}
				{isDraggingFile && (
					<div className="absolute inset-0 bg-primary/10 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-none">
						<div className="bg-background/95 rounded-2xl p-8 shadow-2xl border-2 border-primary border-dashed">
							<Upload className="w-12 h-12 mx-auto mb-3 text-primary" />
							<p className="text-lg font-medium">Drop your PDF here</p>
						</div>
					</div>
				)}

				{/* Loading overlay */}
				{isLoading && (
					<div className="absolute inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-50">
						<div className="bg-background rounded-xl p-6 shadow-xl flex items-center gap-3">
							<Loader2 className="w-6 h-6 animate-spin text-primary" />
							<span>Processing PDF...</span>
						</div>
					</div>
				)}

				{/* Floating controls (bottom-left) */}
				{overlayUrl && (
					<div className="absolute bottom-6 left-6 z-40">
						<Card className="p-3 shadow-lg bg-background/95 backdrop-blur">
							<div className="flex items-center gap-4">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setIsOverlayVisible(!isOverlayVisible)}
									className="gap-2"
								>
									{isOverlayVisible ? (
										<Eye className="w-4 h-4" />
									) : (
										<EyeOff className="w-4 h-4" />
									)}
									{isOverlayVisible ? "Hide" : "Show"}
								</Button>

								<div className="flex items-center gap-2">
									<Label className="text-xs text-muted-foreground">
										Opacity
									</Label>
									<input
										type="range"
										min={0.1}
										max={1}
										step={0.05}
										value={opacity}
										onChange={(e) => setOpacity(Number(e.target.value))}
										className="w-24 h-1.5 accent-primary"
									/>
									<span className="text-xs text-muted-foreground w-8">
										{Math.round(opacity * 100)}%
									</span>
								</div>
							</div>
						</Card>
					</div>
				)}

				{/* Panel toggle button */}
				<Button
					variant="secondary"
					size="icon"
					className="absolute top-4 right-4 z-40 shadow-lg"
					onClick={() => setIsPanelOpen(!isPanelOpen)}
				>
					{isPanelOpen ? (
						<ChevronRight className="w-4 h-4" />
					) : (
						<ChevronLeft className="w-4 h-4" />
					)}
				</Button>
			</div>

			{/* Side Panel */}
			<div
				className={`
          w-96 bg-background border-l flex flex-col transition-all duration-300
          ${isPanelOpen ? "translate-x-0" : "translate-x-full"}
          absolute right-0 top-0 bottom-0 z-30
          md:relative md:translate-x-0 ${!isPanelOpen && "md:hidden"}
        `}
			>
				{/* Header */}
				<div className="p-4 border-b">
					<h1 className="text-lg font-semibold flex items-center gap-2">
						<MapPin className="w-5 h-5 text-primary" />
						Plan Overlay Tool
					</h1>
					<p className="text-sm text-muted-foreground mt-1">
						AI-powered construction plan positioning
					</p>
				</div>

				{/* Upload Section */}
				<div className="p-4 border-b">
					{!overlayUrl ? (
						<div
							className={`
                drop-zone p-6 text-center cursor-pointer
                hover:border-primary/50 hover:bg-muted/50
                ${isDraggingFile ? "dragging" : ""}
              `}
							onClick={() => fileInputRef.current?.click()}
						>
							<Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
							<p className="font-medium">Upload Plan PDF</p>
							<p className="text-xs text-muted-foreground mt-1">
								Click or drag & drop
							</p>
						</div>
					) : (
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2 min-w-0">
								<CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
								<span className="text-sm truncate">{fileName}</span>
							</div>
							<Button variant="ghost" size="sm" onClick={handleReset}>
								<RotateCcw className="w-4 h-4" />
							</Button>
						</div>
					)}
					<input
						ref={fileInputRef}
						type="file"
						accept="application/pdf"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) handleFile(file);
							e.target.value = "";
						}}
					/>
				</div>

				{/* AI Assistant */}
				<div className="flex-1 flex flex-col min-h-0">
					<div className="p-3 border-b bg-muted/30">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<Sparkles className="w-4 h-4 text-primary" />
								<span className="text-sm font-medium">AI Assistant</span>
							</div>
							{overlayUrl && (
								<Button
									variant="outline"
									size="sm"
									onClick={requestRefinement}
									disabled={isAiThinking}
									className="gap-1.5"
								>
									{isAiThinking ? (
										<Loader2 className="w-3 h-3 animate-spin" />
									) : (
										<Sparkles className="w-3 h-3" />
									)}
									Refine
								</Button>
							)}
						</div>
					</div>

					<div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
						{aiMessages.length === 0 ? (
							<div className="text-center text-muted-foreground text-sm py-8">
								<Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30" />
								<p>Upload a plan to start</p>
								<p className="text-xs mt-1">
									AI will analyze and position it automatically
								</p>
							</div>
						) : (
							<>
								{aiMessages.map((msg, i) => (
									<div
										key={i}
										className={`
                      text-sm rounded-lg p-3 transition-all
                      ${
												msg.role === "user"
													? "bg-primary text-primary-foreground ml-6"
													: msg.role === "system"
														? "bg-muted text-muted-foreground text-xs"
														: "bg-muted/50 mr-6"
											}
                    `}
									>
										{/* Thinking section (collapsible) */}
										{msg.thinking && (
											<div className="mb-2">
												<button
													onClick={() => {
														setExpandedThinking((prev) => {
															const newSet = new Set(prev);
															if (newSet.has(i)) {
																newSet.delete(i);
															} else {
																newSet.add(i);
															}
															return newSet;
														});
													}}
													className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
												>
													<Brain className="w-3 h-3" />
													<span>AI Reasoning</span>
													{expandedThinking.has(i) ? (
														<ChevronUp className="w-3 h-3" />
													) : (
														<ChevronDown className="w-3 h-3" />
													)}
												</button>
												{expandedThinking.has(i) && (
													<div className="mt-2 p-2 bg-background/50 rounded text-xs text-muted-foreground border-l-2 border-primary/30 max-h-32 overflow-y-auto">
														{msg.thinking}
													</div>
												)}
											</div>
										)}

										{/* Streaming indicator */}
										{msg.isStreaming && (
											<div className="flex items-center gap-2 mb-2 text-xs text-primary">
												<Loader2 className="w-3 h-3 animate-spin" />
												<span className="animate-pulse">Receiving...</span>
											</div>
										)}

										{/* Main content */}
										<div className={msg.isStreaming ? "opacity-90" : ""}>
											{msg.content || (msg.isStreaming ? "..." : "")}
										</div>

										{/* Bounds action */}
										{msg.bounds && !msg.isStreaming && (
											<Button
												variant="link"
												size="sm"
												className="p-0 h-auto mt-2 text-xs"
												onClick={() => setBounds(msg.bounds!)}
											>
												Apply these bounds
											</Button>
										)}
									</div>
								))}

								{/* Live status and thinking display */}
								{isAiThinking && (
									<div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg p-3 mr-6 border border-primary/20">
										{/* Animated status */}
										<div className="flex items-center gap-2 mb-2">
											<div className="relative">
												<div className="w-2 h-2 rounded-full bg-primary animate-ping absolute" />
												<div className="w-2 h-2 rounded-full bg-primary" />
											</div>
											<span className="text-sm font-medium text-primary animate-pulse">
												{currentStatus || "Processing..."}
											</span>
										</div>

										{/* Live thinking preview */}
										{currentThinking && (
											<div className="mt-2 p-2 bg-background/50 rounded text-xs text-muted-foreground border-l-2 border-primary/30 max-h-24 overflow-y-auto">
												<div className="flex items-center gap-1.5 mb-1 text-primary/70">
													<Brain className="w-3 h-3" />
													<span>Thinking...</span>
												</div>
												{currentThinking.slice(-200)}
												{currentThinking.length > 200 && "..."}
											</div>
										)}

										{/* Animated dots */}
										<div className="flex gap-1 mt-2">
											<div className="w-1.5 h-1.5 rounded-full bg-primary ai-thinking-dot" />
											<div className="w-1.5 h-1.5 rounded-full bg-primary ai-thinking-dot" />
											<div className="w-1.5 h-1.5 rounded-full bg-primary ai-thinking-dot" />
										</div>
									</div>
								)}
								<div ref={messagesEndRef} />
							</>
						)}
					</div>
				</div>

				{/* Quick Actions */}
				{overlayUrl && (
					<div className="p-4 border-t bg-muted/30">
						<div className="grid grid-cols-2 gap-2">
							<Button
								variant="outline"
								size="sm"
								className="gap-1.5"
								onClick={() => setShouldFitBounds(true)}
							>
								<Move className="w-3 h-3" />
								Pan to Fit
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="gap-1.5"
								onClick={handleResetBounds}
							>
								<Maximize2 className="w-3 h-3" />
								Reset Bounds
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
