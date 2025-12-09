import {
  APIProvider,
  Map as GoogleMap,
  Marker,
  useMap,
} from "@vis.gl/react-google-maps";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  Maximize2,
  Move,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

// PDF.js worker setup
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-worker.min.mjs";

// Types
type LatLngLiteral = { lat: number; lng: number };
type LatLngBoundsLiteral = {
  north: number;
  south: number;
  east: number;
  west: number;
};

// Road/street extracted from the plan
type ExtractedRoad = {
  name: string;
  direction: "north" | "south" | "east" | "west" | "unknown";
  isPrimary: boolean;
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
    | "unknown";
};

type ExtractedPlanData = {
  address: string | null;
  city: string | null;
  state: string | null;
  streetNames: string[];
  landmarks: string[];
  scaleInfo: string | null;
  northArrowDegrees: number | null;
  estimatedSizeMeters: number | null;
  confidence: number;
  // Enhanced road/intersection data
  roads: ExtractedRoad[];
  intersections: ExtractedIntersection[];
  siteShape:
    | "rectangular"
    | "irregular"
    | "L-shaped"
    | "triangular"
    | "unknown";
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

type ProcessingStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  detail?: string;
};

// Helper to get step status class name
function getStepStatusClassName(status: ProcessingStep["status"]): string {
  switch (status) {
    case "active":
      return "font-medium text-primary";
    case "complete":
      return "text-muted-foreground";
    case "error":
      return "text-destructive";
    default:
      return "text-muted-foreground/60";
  }
}

// Helper component for step status icon
function StepStatusIcon({ status }: { status: ProcessingStep["status"] }) {
  switch (status) {
    case "pending":
      return (
        <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
      );
    case "active":
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
    case "complete":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    default:
      return <AlertCircle className="h-4 w-4 text-destructive" />;
  }
}

type Message = {
  id: string;
  type: "info" | "success" | "error" | "extraction" | "refinement";
  content: string;
  timestamp: Date;
  data?: ExtractedPlanData | RefinementAdjustment;
  expanded?: boolean;
};

// Helper to get message type class name
function getMessageClassName(type: Message["type"]): string {
  switch (type) {
    case "error":
      return "border border-destructive/30 bg-destructive/10 text-destructive";
    case "success":
      return "border border-green-500/30 bg-green-500/10";
    case "extraction":
      return "border bg-background";
    case "refinement":
      return "border border-primary/30 bg-primary/5";
    default:
      return "bg-muted/50";
  }
}

// Helper component for message icon
function MessageIcon({ type }: { type: Message["type"] }) {
  switch (type) {
    case "error":
      return <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />;
    case "success":
      return (
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
      );
    case "extraction":
      return <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />;
    case "refinement":
      return (
        <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
      );
    default:
      return (
        <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
      );
  }
}

// Geocoded intersection with coordinates
type GeocodedIntersection = {
  road1: string;
  road2: string;
  cornerPosition: string;
  lat: number;
  lng: number;
};

// Road polyline with geometry data
type RoadPolylineData = {
  roadName: string;
  points: Array<{ lat: number; lng: number }>;
  color: string;
};

// Polyline component for drawing roads on the map
function RoadPolyline({
  path,
  color = "#ef4444",
  weight = 4,
  isVisible = true,
}: {
  path: Array<{ lat: number; lng: number }>;
  color?: string;
  weight?: number;
  isVisible?: boolean;
}) {
  const map = useMap();
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!(map && path.length >= 2 && isVisible)) {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
      return;
    }

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
    }

    const polyline = new google.maps.Polyline({
      path,
      strokeColor: color,
      strokeOpacity: 0.8,
      strokeWeight: weight,
      map,
    });
    polylineRef.current = polyline;

    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    };
  }, [map, path, color, weight, isVisible]);

  return null;
}

// Intersection marker component
function IntersectionMarker({
  position,
  label,
  isVisible = true,
}: {
  position: { lat: number; lng: number };
  label: string;
  isVisible?: boolean;
}) {
  if (!isVisible) {
    return null;
  }

  return (
    <Marker
      icon={{
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#22c55e",
        fillOpacity: 1,
        strokeColor: "white",
        strokeWeight: 2,
      }}
      label={{
        text: label,
        color: "#22c55e",
        fontSize: "10px",
        fontWeight: "bold",
        className: "intersection-label",
      }}
      position={position}
      title={label}
    />
  );
}

// Ground overlay component
function GroundOverlayLayer({
  imageUrl,
  bounds,
  opacity,
  isVisible,
}: {
  imageUrl: string;
  bounds: LatLngBoundsLiteral;
  opacity: number;
  isVisible: boolean;
}) {
  const map = useMap();
  const overlayRef = useRef<google.maps.GroundOverlay | null>(null);

  useEffect(() => {
    if (!(map && bounds && imageUrl && isVisible)) {
      if (overlayRef.current) {
        overlayRef.current.setMap(null);
        overlayRef.current = null;
      }
      return;
    }

    if (overlayRef.current) {
      overlayRef.current.setMap(null);
    }

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

  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.setOpacity(opacity);
    }
  }, [opacity]);

  return null;
}

// Corner markers for resizing
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
    if (!e.latLng) {
      return;
    }
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();

    const newBounds = { ...bounds };
    if (type.includes("n")) {
      newBounds.north = lat;
    }
    if (type.includes("s")) {
      newBounds.south = lat;
    }
    if (type.includes("w")) {
      newBounds.west = lng;
    }
    if (type.includes("e")) {
      newBounds.east = lng;
    }

    if (newBounds.north > newBounds.south && newBounds.east > newBounds.west) {
      onBoundsChange(newBounds);
    }
  };

  return (
    <>
      {corners.map(({ lat, lng, label, type }) => (
        <Marker
          draggable={true}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#3b82f6",
            fillOpacity: 1,
            strokeColor: "white",
            strokeWeight: 3,
          }}
          key={type}
          label={{
            text: label,
            color: "white",
            fontSize: "11px",
            fontWeight: "bold",
          }}
          onDrag={(e) => handleDrag(type, e)}
          onDragEnd={(e) => handleDrag(type, e)}
          position={{ lat, lng }}
          title={`Drag to resize (${label})`}
        />
      ))}
    </>
  );
}

// Map controller for programmatic actions
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
    if (!(map && shouldFitBounds)) {
      return;
    }

    const googleBounds = new google.maps.LatLngBounds(
      { lat: bounds.south, lng: bounds.west },
      { lat: bounds.north, lng: bounds.east }
    );
    map.fitBounds(googleBounds, 100);
    onFitComplete();
  }, [map, bounds, shouldFitBounds, onFitComplete]);

  return null;
}

// Map type controller for dynamic map type changes
function MapTypeController({
  mapTypeId,
}: {
  mapTypeId: "roadmap" | "terrain" | "satellite" | "hybrid";
}) {
  const map = useMap();

  useEffect(() => {
    if (map) {
      map.setMapTypeId(mapTypeId);
    }
  }, [map, mapTypeId]);

  return null;
}

// Default bounds (Phoenix, AZ area)
const DEFAULT_BOUNDS: LatLngBoundsLiteral = {
  north: 33.5,
  south: 33.3,
  east: -111.85,
  west: -112.05,
};

// Convert file to base64 data URL
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Convert PDF first page to image (for map overlay display)
// Returns both the image data URL and the aspect ratio (width/height)
async function pdfFirstPageToImage(
  file: File,
  scale = 2
): Promise<{ imageUrl: string; aspectRatio: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const page = await doc.getPage(1);

  // Get viewport with explicit rotation handling
  // PDF pages can have rotation metadata (0, 90, 180, 270)
  const rotation = page.rotate || 0;
  const viewport = page.getViewport({ scale, rotation });

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context unavailable");
  }
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  await page.render({ canvas, canvasContext: context, viewport }).promise;

  const aspectRatio = viewport.width / viewport.height;
  console.log(
    `[PDF] Page rotation: ${rotation}°, viewport: ${viewport.width}x${viewport.height}, aspect ratio: ${aspectRatio.toFixed(3)}`
  );

  return {
    imageUrl: canvas.toDataURL("image/png"),
    aspectRatio,
  };
}

export function PlanOverlayTool() {
  // Core state
  const [mapsApiKey, setMapsApiKey] = useState<string | null>(null);
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [overlayImageUrl, setOverlayImageUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [bounds, setBounds] = useState<LatLngBoundsLiteral>(DEFAULT_BOUNDS);
  const [opacity, setOpacity] = useState(0.6);
  const [isOverlayVisible, setIsOverlayVisible] = useState(true);

  // UI state
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [shouldFitBounds, setShouldFitBounds] = useState(false);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);
  const [currentStatus, setCurrentStatus] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [refinementCount, setRefinementCount] = useState(0);
  const [_extractedData, setExtractedData] = useState<ExtractedPlanData | null>(
    null
  );
  const [geocodedIntersections, setGeocodedIntersections] = useState<
    GeocodedIntersection[]
  >([]);
  const [showRoadHighlights, setShowRoadHighlights] = useState(true);
  const [roadPolylines, setRoadPolylines] = useState<RoadPolylineData[]>([]);

  // Deep refinement state
  const [mapTypeId, setMapTypeId] = useState<"roadmap" | "terrain">("roadmap");
  const [originalBounds, setOriginalBounds] =
    useState<LatLngBoundsLiteral | null>(null);
  const [isDeepRefining, setIsDeepRefining] = useState(false);
  const [deepRefineIteration, setDeepRefineIteration] = useState(0);

  // Refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load config on mount
  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data: { mapsApiKey?: string }) =>
        setMapsApiKey(data.mapsApiKey ?? "")
      )
      .catch(() => setMapsApiKey(""));
  }, []);

  // Auto-scroll messages when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  const center = useMemo<LatLngLiteral>(
    () => ({
      lat: (bounds.north + bounds.south) / 2,
      lng: (bounds.east + bounds.west) / 2,
    }),
    [bounds]
  );

  // Add a message
  const addMessage = useCallback(
    (
      type: Message["type"],
      content: string,
      data?: ExtractedPlanData | RefinementAdjustment
    ) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type,
          content,
          timestamp: new Date(),
          data,
        },
      ]);
    },
    []
  );

  // Update processing step status
  const updateStep = useCallback(
    (id: string, status: ProcessingStep["status"], detail?: string) => {
      setProcessingSteps((prev) =>
        prev.map((step) =>
          step.id === id ? { ...step, status, detail } : step
        )
      );
    },
    []
  );

  // Stream response from API
  const streamResponse = useCallback(
    async <T extends Record<string, unknown>>(
      url: string,
      body: object,
      onStatus: (message: string) => void
    ): Promise<T & { fullText: string }> => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk
          .split("\n")
          .filter((line) => line.startsWith("data: "));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "error") {
              throw new Error(data.error);
            }

            if (data.type === "status") {
              onStatus(data.message);
            }

            if (data.type === "text") {
              fullText += data.text;
            }

            if (data.type === "complete") {
              return { ...data, fullText } as T & { fullText: string };
            }
          } catch (e) {
            if (
              e instanceof Error &&
              e.message !== "Unexpected end of JSON input"
            ) {
              throw e;
            }
          }
        }
      }
      throw new Error("Stream ended without completion");
    },
    []
  );

  // Capture screenshot using Google Maps Static API + overlay composite
  const captureScreenshot = useCallback(async (): Promise<string | null> => {
    if (!(mapsApiKey && overlayImageUrl)) {
      return null;
    }

    try {
      const centerLat = (bounds.north + bounds.south) / 2;
      const centerLng = (bounds.east + bounds.west) / 2;

      // Calculate zoom level based on bounds span
      const latSpan = bounds.north - bounds.south;
      const zoom = Math.min(
        20,
        Math.max(10, Math.floor(14 - Math.log2(latSpan * 111)))
      );

      // Get satellite image from Google Maps Static API
      const staticUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${centerLat},${centerLng}&zoom=${zoom}&size=640x640&maptype=hybrid&key=${mapsApiKey}`;

      // Create composite canvas with satellite + overlay
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 640;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return null;
      }

      // Load and draw satellite image
      const satImage = new Image();
      satImage.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        satImage.onload = () => resolve();
        satImage.onerror = reject;
        satImage.src = staticUrl;
      });
      ctx.drawImage(satImage, 0, 0, 640, 640);

      // Load and draw overlay with transparency
      const overlayImage = new Image();
      await new Promise<void>((resolve, reject) => {
        overlayImage.onload = () => resolve();
        overlayImage.onerror = reject;
        overlayImage.src = overlayImageUrl;
      });
      ctx.globalAlpha = opacity;
      ctx.drawImage(overlayImage, 0, 0, 640, 640);

      return canvas.toDataURL("image/png");
    } catch (error) {
      console.error("Screenshot failed:", error);
      return null;
    }
  }, [mapsApiKey, overlayImageUrl, bounds, opacity]);

  // MAIN PROCESSING FLOW
  const processDocument = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      setMessages([]);
      setExtractedData(null);
      setRefinementCount(0);
      const newSessionId = crypto.randomUUID();
      setSessionId(newSessionId);

      // Initialize processing steps
      const steps: ProcessingStep[] = [
        { id: "read", label: "Reading document", status: "pending" },
        { id: "extract", label: "Extracting location", status: "pending" },
        { id: "geocode", label: "Geocoding address", status: "pending" },
        { id: "position", label: "Initial positioning", status: "pending" },
        { id: "refine", label: "Visual refinement", status: "pending" },
      ];
      setProcessingSteps(steps);

      try {
        // Step 1: Read PDF and convert to image for overlay
        updateStep("read", "active");
        setCurrentStatus("Reading PDF...");

        // Get raw PDF data URL for AI analysis
        const dataUrl = await fileToDataUrl(file);
        setPdfDataUrl(dataUrl);

        // Convert first page to image for map overlay
        setCurrentStatus("Converting to image...");
        const { imageUrl, aspectRatio } = await pdfFirstPageToImage(file);
        setOverlayImageUrl(imageUrl);

        updateStep("read", "complete");

        // Step 2: Extract location data
        updateStep("extract", "active");
        setCurrentStatus("Analyzing document with AI...");

        const extractResult = await streamResponse<{
          extractedData: ExtractedPlanData | null;
        }>(
          "/api/ai/extract",
          { pdfDataUrl: dataUrl, filename: file.name },
          (msg) => setCurrentStatus(msg)
        );

        const extracted = extractResult.extractedData;
        if (!extracted) {
          throw new Error("Could not extract location data from document");
        }
        setExtractedData(extracted);

        updateStep(
          "extract",
          "complete",
          extracted.address || "Location found"
        );
        addMessage(
          "extraction",
          `Found: ${extracted.address || "Unknown address"}, ${extracted.city || ""} ${extracted.state || ""}`,
          extracted
        );

        // Step 3: Geocode - Try intersection first, then fall back to address
        updateStep("geocode", "active");

        let geocodeData: {
          lat: number;
          lng: number;
          formattedAddress: string;
        } | null = null;
        let useCornerBased = false;
        let cornerPosition:
          | "northwest"
          | "northeast"
          | "southwest"
          | "southeast"
          | null = null;

        // Try intersection geocoding first if we have intersections
        const intersections = extracted.intersections || [];
        const firstIntersection = intersections[0];
        const hasValidIntersection =
          firstIntersection !== undefined &&
          firstIntersection.cornerPosition !== "unknown";

        if (hasValidIntersection && extracted.city && firstIntersection) {
          setCurrentStatus(
            `Geocoding intersection: ${firstIntersection.road1} & ${firstIntersection.road2}...`
          );
          addMessage(
            "info",
            `Found intersection: ${firstIntersection.road1} & ${firstIntersection.road2} (${firstIntersection.cornerPosition} corner)`
          );

          const intersectionRes = await fetch("/api/geocode/intersection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              road1: firstIntersection.road1,
              road2: firstIntersection.road2,
              city: extracted.city,
              state: extracted.state || "",
            }),
          });

          if (intersectionRes.ok) {
            const intersectionData: {
              lat: number;
              lng: number;
              formattedAddress: string;
            } = await intersectionRes.json();
            geocodeData = intersectionData;
            useCornerBased = true;
            if (
              firstIntersection.cornerPosition === "northwest" ||
              firstIntersection.cornerPosition === "northeast" ||
              firstIntersection.cornerPosition === "southwest" ||
              firstIntersection.cornerPosition === "southeast"
            ) {
              cornerPosition = firstIntersection.cornerPosition;
            }

            // Store geocoded intersection for road highlighting
            const geocodedIntersection: GeocodedIntersection = {
              road1: firstIntersection.road1,
              road2: firstIntersection.road2,
              cornerPosition: firstIntersection.cornerPosition,
              lat: intersectionData.lat,
              lng: intersectionData.lng,
            };
            setGeocodedIntersections([geocodedIntersection]);

            addMessage(
              "success",
              `Intersection geocoded: ${intersectionData.formattedAddress}`
            );

            // Fetch road geometry for ALL roads found (not just intersection roads)
            setCurrentStatus("Fetching road geometry for all roads...");
            const roadColors = [
              "#ef4444", // red
              "#3b82f6", // blue
              "#22c55e", // green
              "#f59e0b", // amber
              "#8b5cf6", // purple
              "#ec4899", // pink
              "#14b8a6", // teal
              "#f97316", // orange
            ];

            // Get unique road names from extracted.roads
            const allRoadNames = [
              ...new Set(extracted.roads?.map((r) => r.name) ?? []),
            ];

            console.log("[Roads] Drawing all roads:", allRoadNames);

            const roadGeometryPromises = allRoadNames.map(
              async (roadName, index) => {
                try {
                  const res = await fetch("/api/roads/geometry", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      roadName,
                      intersectionPoint: {
                        lat: intersectionData.lat,
                        lng: intersectionData.lng,
                      },
                      city: extracted.city,
                      state: extracted.state || "",
                      radiusMeters: 1000, // larger radius to catch more of each road
                    }),
                  });

                  if (res.ok) {
                    const data: {
                      points: Array<{ lat: number; lng: number }>;
                    } = await res.json();
                    return {
                      roadName,
                      points: data.points,
                      color: roadColors[index % roadColors.length],
                    } as RoadPolylineData;
                  }
                  return null;
                } catch {
                  return null;
                }
              }
            );

            const roadResults = await Promise.all(roadGeometryPromises);
            const validRoads = roadResults.filter(
              (r): r is RoadPolylineData => r !== null
            );
            setRoadPolylines(validRoads);

            if (validRoads.length > 0) {
              addMessage(
                "info",
                `Road highlighting: ${validRoads.map((r) => r.roadName).join(", ")}`
              );
            }
          } else {
            addMessage(
              "info",
              "Intersection geocoding failed, falling back to address..."
            );
          }
        }

        // Fall back to address geocoding
        if (!geocodeData) {
          setCurrentStatus("Looking up address coordinates...");

          const addressParts = [
            extracted.address,
            extracted.city,
            extracted.state,
          ].filter(Boolean);
          const fullAddress = addressParts.join(", ");

          if (fullAddress) {
            const geocodeRes = await fetch("/api/geocode", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ address: fullAddress }),
            });

            if (!geocodeRes.ok) {
              throw new Error(`Geocoding failed for: ${fullAddress}`);
            }

            geocodeData = await geocodeRes.json();
          } else {
            // Last resort: try to geocode just the roads with city
            const roads = extracted.roads || [];
            const firstRoad = roads[0];
            if (firstRoad && extracted.city) {
              const primaryRoad = roads.find((r) => r.isPrimary) ?? firstRoad;
              const fallbackAddress = `${primaryRoad.name}, ${extracted.city}, ${extracted.state || ""}`;
              addMessage(
                "info",
                `Trying road-based geocode: ${fallbackAddress}`
              );

              const fallbackRes = await fetch("/api/geocode", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address: fallbackAddress }),
              });

              if (fallbackRes.ok) {
                geocodeData = await fallbackRes.json();
              }
            }

            if (!geocodeData) {
              throw new Error("No address or roads found to geocode");
            }
          }
        }

        // At this point geocodeData is guaranteed to be non-null (throw above ensures this)
        if (!geocodeData) {
          throw new Error("Geocode data is unexpectedly null");
        }

        addMessage("success", `Geocoded to: ${geocodeData.formattedAddress}`);

        updateStep(
          "geocode",
          "complete",
          `${geocodeData.lat.toFixed(4)}, ${geocodeData.lng.toFixed(4)}`
        );

        // Step 4: Calculate initial bounds
        updateStep("position", "active");
        setCurrentStatus("Calculating overlay position...");

        // Clamp size to reasonable bounds (10m min, 500m max for typical sites)
        const rawSize = extracted.estimatedSizeMeters || 100;
        const sizeMeters = Math.max(10, Math.min(500, rawSize));
        if (rawSize !== sizeMeters) {
          console.log(
            `[Frontend] Clamped size from ${rawSize}m to ${sizeMeters}m`
          );
        }
        let boundsData: { bounds: LatLngBoundsLiteral };

        if (useCornerBased && cornerPosition) {
          // Use corner-based positioning from intersection
          console.log(
            `[Frontend] Using corner-based bounds: corner=${cornerPosition}, size=${sizeMeters}m`
          );
          addMessage("info", `Using ${cornerPosition} corner as anchor point`);

          const boundsRes = await fetch("/api/bounds/from-corner", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              corner: {
                lat: geocodeData.lat,
                lng: geocodeData.lng,
              },
              cornerPosition,
              sizeMeters,
              aspectRatio,
            }),
          });

          boundsData = await boundsRes.json();
        } else {
          // Use center-based positioning (legacy)
          console.log(
            `[Frontend] Using center-based bounds: size=${sizeMeters}m, aspect=${aspectRatio.toFixed(3)}`
          );

          const boundsRes = await fetch("/api/bounds/calculate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              center: {
                lat: geocodeData.lat,
                lng: geocodeData.lng,
              },
              sizeMeters,
              aspectRatio,
            }),
          });

          boundsData = await boundsRes.json();
        }

        console.log("[Frontend] Received bounds:", boundsData.bounds);
        setBounds(boundsData.bounds);
        setOriginalBounds(boundsData.bounds); // Store for deep refinement bounds checking
        setShouldFitBounds(true);

        const positionMethod = useCornerBased
          ? `${cornerPosition} corner anchor`
          : "center-based";
        updateStep(
          "position",
          "complete",
          `~${sizeMeters}m (${positionMethod})`
        );
        addMessage(
          "success",
          `Positioned overlay: ${sizeMeters}m scale, ${positionMethod}`
        );

        // Step 5: Visual refinement (optional, run once)
        updateStep("refine", "active");
        setCurrentStatus("Preparing visual refinement...");

        // Wait for map to render
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const screenshot = await captureScreenshot();
        if (screenshot) {
          setCurrentStatus("AI is comparing with satellite...");
          setRefinementCount(1);

          const refineResult = await streamResponse<{
            adjustment: RefinementAdjustment | null;
            newBounds: LatLngBoundsLiteral | null;
          }>(
            "/api/ai/refine",
            {
              screenshotDataUrl: screenshot,
              pdfDataUrl: dataUrl,
              currentBounds: boundsData.bounds,
              sessionId: newSessionId,
            },
            (msg) => setCurrentStatus(msg)
          );

          if (refineResult.adjustment && refineResult.newBounds) {
            setBounds(refineResult.newBounds);
            setShouldFitBounds(true);
            addMessage(
              "refinement",
              refineResult.adjustment.reasoning,
              refineResult.adjustment
            );
          }

          updateStep("refine", "complete", "Alignment adjusted");
        } else {
          updateStep("refine", "complete", "Skipped");
        }

        setCurrentStatus("");
        addMessage(
          "success",
          "Processing complete! Drag the corner markers to fine-tune positioning."
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Processing error:", message);
        addMessage("error", message);
        setCurrentStatus("");

        // Mark current step as error
        setProcessingSteps((prev) =>
          prev.map((step) =>
            step.status === "active" ? { ...step, status: "error" } : step
          )
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [addMessage, captureScreenshot, streamResponse, updateStep]
  );

  // File handling
  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.includes("pdf")) {
        addMessage("error", "Please upload a PDF file");
        return;
      }

      setFileName(file.name);
      await processDocument(file);
    },
    [addMessage, processDocument]
  );

  // Manual refinement
  const requestRefinement = useCallback(async () => {
    if (!(pdfDataUrl && sessionId)) {
      return;
    }

    setIsProcessing(true);
    setRefinementCount((prev) => prev + 1);
    setCurrentStatus("Capturing current view...");

    try {
      const screenshot = await captureScreenshot();
      if (!screenshot) {
        throw new Error("Could not capture screenshot");
      }

      setCurrentStatus("AI is analyzing alignment...");

      const refineResult = await streamResponse<{
        adjustment: RefinementAdjustment | null;
        newBounds: LatLngBoundsLiteral | null;
      }>(
        "/api/ai/refine",
        {
          screenshotDataUrl: screenshot,
          pdfDataUrl,
          currentBounds: bounds,
          sessionId,
        },
        (msg) => setCurrentStatus(msg)
      );

      if (refineResult.adjustment && refineResult.newBounds) {
        setBounds(refineResult.newBounds);
        setShouldFitBounds(true);
        addMessage(
          "refinement",
          refineResult.adjustment.reasoning,
          refineResult.adjustment
        );
      } else {
        addMessage("info", "No adjustments needed - alignment looks good!");
      }

      setCurrentStatus("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addMessage("error", message);
      setCurrentStatus("");
    } finally {
      setIsProcessing(false);
    }
  }, [
    pdfDataUrl,
    sessionId,
    bounds,
    captureScreenshot,
    streamResponse,
    addMessage,
  ]);

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
    if (file) {
      handleFile(file);
    }
  };

  // Deep refinement with iterative terrain/feature matching
  const handleDeepRefine = async () => {
    if (!(overlayImageUrl && mapsApiKey)) {
      addMessage("error", "No overlay image available for deep refinement");
      return;
    }

    setIsDeepRefining(true);
    setMapTypeId("terrain"); // Switch to terrain view for better matching
    let currentIteration = 0;
    const maxIterations = 5;
    let currentBoundsLocal = bounds;

    try {
      while (currentIteration < maxIterations) {
        currentIteration += 1;
        setDeepRefineIteration(currentIteration);
        addMessage(
          "info",
          `Deep refinement iteration ${currentIteration}/${maxIterations}...`
        );

        // Get terrain screenshot using Static Maps API
        const centerLat =
          (currentBoundsLocal.north + currentBoundsLocal.south) / 2;
        const centerLng =
          (currentBoundsLocal.east + currentBoundsLocal.west) / 2;
        const terrainUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${centerLat},${centerLng}&zoom=17&size=800x600&maptype=terrain&key=${mapsApiKey}`;

        // Fetch terrain image and convert to data URL
        const terrainRes = await fetch(terrainUrl);
        const terrainBlob = await terrainRes.blob();
        const terrainDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result as string);
          };
          reader.readAsDataURL(terrainBlob);
        });

        // Call deep refine API - send the rendered overlay image, not the PDF
        console.log("[DeepRefine] Sending request with:", {
          hasDrawing: !!overlayImageUrl,
          hasTerrain: !!terrainDataUrl,
          iteration: currentIteration,
        });

        const res = await fetch("/api/ai/deep-refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            drawingDataUrl: overlayImageUrl, // Use rendered image, not PDF
            terrainScreenshotUrl: terrainDataUrl,
            currentBounds: currentBoundsLocal,
            originalBounds,
            iteration: currentIteration,
            maxShiftMeters: 200,
          }),
        });

        if (!res.ok) {
          throw new Error(`Deep refine failed: ${res.statusText}`);
        }

        // Parse SSE stream
        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let result: {
          adjustment?: {
            shiftMeters: { north: number; east: number };
            scaleFactor: number;
            confidence: number;
            featuresMatched?: string[];
            reasoning: string;
          };
          newBounds?: LatLngBoundsLiteral;
          boundsClamped?: boolean;
          shouldContinue?: boolean;
        } | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = JSON.parse(line.slice(6));
              if (data.type === "complete") {
                result = data;
              } else if (data.type === "error") {
                throw new Error(data.error);
              }
            }
          }
        }

        if (result?.adjustment) {
          const adj = result.adjustment;
          addMessage(
            "refinement",
            `Iteration ${currentIteration}: Shift ${adj.shiftMeters.north.toFixed(1)}m N, ${adj.shiftMeters.east.toFixed(1)}m E | Confidence: ${(adj.confidence * 100).toFixed(0)}%`,
            adj
          );

          if (adj.featuresMatched?.length) {
            addMessage(
              "info",
              `Features matched: ${adj.featuresMatched.join(", ")}`
            );
          }

          if (result.boundsClamped) {
            addMessage(
              "info",
              "Adjustment was clamped to stay within bounds limit"
            );
          }

          if (result.newBounds) {
            currentBoundsLocal = result.newBounds;
            setBounds(result.newBounds);
          }

          // Check if we should continue
          if (!result.shouldContinue) {
            addMessage(
              "success",
              `Deep refinement converged after ${currentIteration} iterations`
            );
            break;
          }
        } else {
          addMessage("info", "No adjustment suggested, stopping refinement");
          break;
        }
      }

      if (currentIteration >= maxIterations) {
        addMessage("info", `Reached maximum iterations (${maxIterations})`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addMessage("error", `Deep refinement error: ${message}`);
    } finally {
      setIsDeepRefining(false);
      setDeepRefineIteration(0);
    }
  };

  const handleReset = () => {
    setPdfDataUrl(null);
    setOverlayImageUrl(null);
    setFileName(null);
    setMessages([]);
    setSessionId(null);
    setBounds(DEFAULT_BOUNDS);
    setOpacity(0.6);
    setIsOverlayVisible(true);
    setCurrentStatus("");
    setRefinementCount(0);
    setProcessingSteps([]);
    setExtractedData(null);
    setGeocodedIntersections([]);
    setShowRoadHighlights(true);
    setRoadPolylines([]);
    setMapTypeId("roadmap");
    setOriginalBounds(null);
    setIsDeepRefining(false);
    setDeepRefineIteration(0);
  };

  // Loading state
  if (mapsApiKey === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-muted">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!mapsApiKey) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-muted">
        <Card className="max-w-md p-6">
          <div className="flex items-center gap-3 text-destructive">
            <XCircle className="h-6 w-6" />
            <div>
              <h2 className="font-semibold">Configuration Error</h2>
              <p className="text-muted-foreground text-sm">
                GOOGLE_MAPS_API_KEY is not configured.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen overflow-hidden">
      {/* Main Map Area */}
      <div
        aria-label="Map area - drag and drop PDF here"
        className="relative flex-1"
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        ref={mapContainerRef}
        role="application"
      >
        <APIProvider apiKey={mapsApiKey}>
          <GoogleMap
            defaultCenter={center}
            defaultZoom={16}
            disableDefaultUI={false}
            fullscreenControl={false}
            gestureHandling="greedy"
            mapId="plan-overlay-map"
            mapTypeControl={true}
            mapTypeId={mapTypeId}
            streetViewControl={false}
            style={{ width: "100%", height: "100%" }}
            zoomControl={true}
          >
            <MapController
              bounds={bounds}
              onFitComplete={() => setShouldFitBounds(false)}
              shouldFitBounds={shouldFitBounds}
            />
            <MapTypeController mapTypeId={mapTypeId} />
            {overlayImageUrl ? (
              <>
                <GroundOverlayLayer
                  bounds={bounds}
                  imageUrl={overlayImageUrl}
                  isVisible={isOverlayVisible}
                  opacity={opacity}
                />
                {isOverlayVisible ? (
                  <CornerMarkers bounds={bounds} onBoundsChange={setBounds} />
                ) : null}
              </>
            ) : null}
            {/* Road polylines for highlighting */}
            {roadPolylines.map((road) => (
              <RoadPolyline
                color={road.color}
                isVisible={showRoadHighlights}
                key={road.roadName}
                path={road.points}
                weight={5}
              />
            ))}
            {/* Intersection markers for road highlighting */}
            {geocodedIntersections.map((intersection, index) => (
              <IntersectionMarker
                isVisible={showRoadHighlights}
                key={`${intersection.road1}-${intersection.road2}-${index}`}
                label={`${intersection.road1} & ${intersection.road2}`}
                position={{ lat: intersection.lat, lng: intersection.lng }}
              />
            ))}
          </GoogleMap>
        </APIProvider>

        {/* Drag overlay */}
        {isDraggingFile ? (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
            <div className="rounded-2xl border-2 border-primary border-dashed bg-background/95 p-8 shadow-2xl">
              <Upload className="mx-auto mb-3 h-12 w-12 text-primary" />
              <p className="font-medium text-lg">Drop your PDF here</p>
            </div>
          </div>
        ) : null}

        {/* Processing status bar */}
        {currentStatus ? (
          <div className="-translate-x-1/2 absolute top-4 left-1/2 z-50">
            <div className="flex items-center gap-2 rounded-full bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm">{currentStatus}</span>
            </div>
          </div>
        ) : null}

        {/* Floating controls */}
        {overlayImageUrl ? (
          <div className="absolute bottom-6 left-6 z-40">
            <Card className="bg-background/95 p-3 shadow-lg backdrop-blur">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-4">
                  <Button
                    className="gap-2"
                    onClick={() => setIsOverlayVisible(!isOverlayVisible)}
                    size="sm"
                    variant="ghost"
                  >
                    {isOverlayVisible ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                    {isOverlayVisible ? "Hide" : "Show"}
                  </Button>

                  <div className="flex items-center gap-2">
                    <Label className="text-muted-foreground text-xs">
                      Opacity
                    </Label>
                    <input
                      className="h-1.5 w-24 accent-primary"
                      max={1}
                      min={0.1}
                      onChange={(e) => setOpacity(Number(e.target.value))}
                      step={0.05}
                      type="range"
                      value={opacity}
                    />
                    <span className="w-8 text-muted-foreground text-xs">
                      {Math.round(opacity * 100)}%
                    </span>
                  </div>
                </div>

                {/* Map type and road highlighting controls */}
                <div className="flex items-center gap-2 border-t pt-3">
                  <Button
                    className="gap-2"
                    onClick={() =>
                      setMapTypeId(
                        mapTypeId === "roadmap" ? "terrain" : "roadmap"
                      )
                    }
                    size="sm"
                    variant={mapTypeId === "terrain" ? "default" : "outline"}
                  >
                    <MapPin className="h-4 w-4" />
                    {mapTypeId === "terrain" ? "Terrain" : "Roadmap"}
                  </Button>
                  {geocodedIntersections.length > 0 ||
                  roadPolylines.length > 0 ? (
                    <Button
                      className="gap-2"
                      onClick={() => setShowRoadHighlights(!showRoadHighlights)}
                      size="sm"
                      variant={showRoadHighlights ? "default" : "outline"}
                    >
                      {showRoadHighlights ? "Hide Roads" : "Show Roads"}
                    </Button>
                  ) : null}
                </div>

                {/* Deep refinement controls */}
                <div className="flex items-center gap-2 border-t pt-3">
                  <Button
                    className="gap-2"
                    disabled={isProcessing || isDeepRefining}
                    onClick={handleDeepRefine}
                    size="sm"
                    variant="default"
                  >
                    {isDeepRefining ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Refining ({deepRefineIteration}/5)
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Deep Refine
                      </>
                    )}
                  </Button>
                  {isDeepRefining ? (
                    <span className="text-muted-foreground text-xs">
                      Matching terrain features...
                    </span>
                  ) : null}
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {/* Panel toggle */}
        <Button
          className="absolute top-4 right-4 z-40 shadow-lg"
          onClick={() => setIsPanelOpen(!isPanelOpen)}
          size="icon"
          variant="secondary"
        >
          {isPanelOpen ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Side Panel */}
      <div
        className={`absolute top-0 right-0 bottom-0 z-30 flex w-96 flex-col border-l bg-background transition-all duration-300 md:relative md:translate-x-0 ${isPanelOpen ? "translate-x-0" : "translate-x-full md:hidden"}`}
      >
        {/* Header */}
        <div className="border-b p-4">
          <h1 className="flex items-center gap-2 font-semibold text-lg">
            <MapPin className="h-5 w-5 text-primary" />
            Plan Overlay Tool
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            AI-powered construction plan positioning
          </p>
        </div>

        {/* Upload Section */}
        <div className="border-b p-4">
          {pdfDataUrl ? (
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" />
                <span className="truncate text-sm">{fileName}</span>
              </div>
              <Button onClick={handleReset} size="sm" variant="ghost">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div
              aria-label="Upload PDF file"
              className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/50 ${isDraggingFile ? "border-primary bg-primary/5" : "border-muted-foreground/25"}`}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  fileInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
            >
              <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Upload Plan PDF</p>
              <p className="mt-1 text-muted-foreground text-xs">
                Click or drag & drop
              </p>
            </div>
          )}
          <input
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleFile(file);
              }
              e.target.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
        </div>

        {/* Processing Steps */}
        {processingSteps.length > 0 ? (
          <div className="border-b p-4">
            <div className="space-y-2">
              {processingSteps.map((step) => (
                <div className="flex items-center gap-2 text-sm" key={step.id}>
                  <StepStatusIcon status={step.status} />
                  <span className={getStepStatusClassName(step.status)}>
                    {step.label}
                  </span>
                  {step.detail ? (
                    <span className="ml-auto truncate text-muted-foreground text-xs">
                      {step.detail}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Messages / AI Assistant */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">AI Assistant</span>
                {refinementCount > 0 ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary text-xs">
                    Pass {refinementCount}
                  </span>
                ) : null}
              </div>
              {pdfDataUrl ? (
                <Button
                  className="gap-1.5"
                  disabled={isProcessing}
                  onClick={requestRefinement}
                  size="sm"
                  variant="outline"
                >
                  {isProcessing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Refine
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 && !isProcessing ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                <Sparkles className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p>Upload a plan to start</p>
                <p className="mt-1 text-xs">
                  AI will extract location, geocode, and position
                </p>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <div
                    className={`rounded-lg p-3 text-sm ${getMessageClassName(msg.type)}`}
                    key={msg.id}
                  >
                    <div className="flex items-start gap-2">
                      <MessageIcon type={msg.type} />
                      <div className="flex-1">
                        <p>{msg.content}</p>
                        {msg.data !== undefined && "confidence" in msg.data ? (
                          <p className="mt-1 text-muted-foreground text-xs">
                            Confidence: {Math.round(msg.data.confidence * 100)}%
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        {pdfDataUrl ? (
          <div className="border-t bg-muted/30 p-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="gap-1.5"
                onClick={() => setShouldFitBounds(true)}
                size="sm"
                variant="outline"
              >
                <Move className="h-3 w-3" />
                Pan to Fit
              </Button>
              <Button
                className="gap-1.5"
                onClick={() => {
                  setBounds(DEFAULT_BOUNDS);
                  setShouldFitBounds(true);
                }}
                size="sm"
                variant="outline"
              >
                <Maximize2 className="h-3 w-3" />
                Reset View
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
