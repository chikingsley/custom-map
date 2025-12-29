import type { LatLng } from "../../types";
import { geocodeAddress } from "./geocoding";

/**
 * Decode Google's encoded polyline format
 * Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 * Note: Bitwise operators are required by the polyline algorithm
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
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
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    // Decode longitude
    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(idx) - 63;
      idx += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5,
    });
  }

  return points;
}

type RoadGeometryOptions = {
  roadName: string;
  nearPoint: LatLng;
  searchRadiusMeters?: number;
};

/**
 * Get road geometry by finding route along the road using Directions API
 */
export async function getRoadGeometry(
  options: RoadGeometryOptions
): Promise<LatLng[] | null> {
  const { roadName, nearPoint, searchRadiusMeters = 1000 } = options;
  const apiKey = Bun.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error("[Roads] GOOGLE_MAPS_API_KEY not set");
    return null;
  }

  // Calculate offset points
  const METERS_PER_LAT_DEG = 111_000;
  const latRadians = (nearPoint.lat * Math.PI) / 180;
  const metersPerLngDeg = Math.cos(latRadians) * 111_000;

  const latOffset = searchRadiusMeters / METERS_PER_LAT_DEG;
  const lngOffset = searchRadiusMeters / metersPerLngDeg;

  // Determine likely road direction from name
  const roadNameLower = roadName.toLowerCase();
  const isNorthSouth =
    roadNameLower.includes("kyrene") ||
    roadNameLower.includes("mill") ||
    roadNameLower.includes("rural") ||
    roadNameLower.includes("st") ||
    roadNameLower.startsWith("n.") ||
    roadNameLower.startsWith("s.");

  // Create origin/destination based on road direction
  const origin = isNorthSouth
    ? `${nearPoint.lat + latOffset},${nearPoint.lng}`
    : `${nearPoint.lat},${nearPoint.lng - lngOffset}`;

  const destination = isNorthSouth
    ? `${nearPoint.lat - latOffset},${nearPoint.lng}`
    : `${nearPoint.lat},${nearPoint.lng + lngOffset}`;

  const directionsUrl = new URL(
    "https://maps.googleapis.com/maps/api/directions/json"
  );
  directionsUrl.searchParams.set("origin", origin);
  directionsUrl.searchParams.set("destination", destination);
  directionsUrl.searchParams.set("key", apiKey);
  directionsUrl.searchParams.set("mode", "driving");

  console.log(
    `[Roads] Getting geometry for "${roadName}" (${isNorthSouth ? "N-S" : "E-W"})`
  );

  const response = await fetch(directionsUrl.toString());
  const data = await response.json();

  if (data.status === "OK" && data.routes?.[0]?.overview_polyline?.points) {
    const points = decodePolyline(data.routes[0].overview_polyline.points);
    console.log(`[Roads] Got ${points.length} points for "${roadName}"`);
    return points;
  }

  console.error("[Roads] Directions API failed:", data.status);
  return null;
}

/**
 * Get road geometry, geocoding the road name if no point provided
 */
export async function getRoadGeometryByName(
  roadName: string,
  city?: string,
  state?: string,
  intersectionPoint?: LatLng
): Promise<LatLng[] | null> {
  let nearPoint = intersectionPoint;

  // If no point provided, geocode the road name
  if (!nearPoint) {
    const roadQuery = `${roadName}, ${city || ""} ${state || ""}`.trim();
    console.log(`[Roads] Geocoding road: "${roadQuery}"`);

    const geocoded = await geocodeAddress(roadQuery);
    if (geocoded) {
      nearPoint = { lat: geocoded.lat, lng: geocoded.lng };
    }
  }

  if (!nearPoint) {
    console.error(`[Roads] Could not locate road: ${roadName}`);
    return null;
  }

  return getRoadGeometry({ roadName, nearPoint });
}
