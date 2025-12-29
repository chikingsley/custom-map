// Geo types
export type LatLng = {
  lat: number;
  lng: number;
};

export type Bounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

// Road/street extracted from the plan
export type ExtractedRoad = {
  name: string;
  direction: "north" | "south" | "east" | "west" | "unknown";
  isPrimary: boolean;
};

// Intersection point where roads meet
export type ExtractedIntersection = {
  road1: string;
  road2: string;
  cornerPosition:
    | "northwest"
    | "northeast"
    | "southwest"
    | "southeast"
    | "unknown";
};

// Data extracted from a construction plan
export type ExtractedPlanData = {
  projectName: string | null;
  parcelNumber: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  roads: ExtractedRoad[];
  intersections: ExtractedIntersection[];
  scaleInfo: string | null;
  estimatedSizeMeters: number | null;
  confidence: number;
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
  // Coordinates from grounding (if available)
  coordinates: LatLng | null;
};

// Parcel data from Maricopa County
export type ParcelData = {
  apn: string;
  address: string | null;
  owner: string | null;
  acres: number | null;
  polygon: LatLng[];
  centroid: LatLng;
  rawAttributes: Record<string, unknown>;
};

// Geocoding result
export type GeocodingResult = {
  lat: number;
  lng: number;
  formattedAddress: string;
};

// Road geometry for display
export type RoadGeometry = {
  roadName: string;
  points: LatLng[];
};

// Relevant page from PDF scan
export type RelevantPage = {
  pageIndex: number;
  pageType: string;
  description: string;
  hasDrawing: boolean;
  isUsefulForGeolocation: boolean;
  score: number;
};

// Processing step for UI
export type ProcessingStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  detail?: string;
};

// Message for UI
export type Message = {
  type: "info" | "success" | "warning" | "error";
  text: string;
};
