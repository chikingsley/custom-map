import type { GeocodingResult } from "../../types";

/**
 * Geocode an address using Google Maps Geocoding API
 */
export async function geocodeAddress(
  address: string
): Promise<GeocodingResult | null> {
  const apiKey = Bun.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("[Geocode] GOOGLE_MAPS_API_KEY not set");
    return null;
  }

  const encodedAddress = encodeURIComponent(address);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

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

  console.error("[Geocode] Failed:", data.status, data.error_message);
  return null;
}

/**
 * Geocode an intersection (two roads)
 */
export async function geocodeIntersection(
  road1: string,
  road2: string,
  city: string,
  state: string
): Promise<GeocodingResult | null> {
  // Try "Road1 & Road2, City, State" format
  const query = `${road1} & ${road2}, ${city}, ${state}`;
  console.log(`[Geocode] Intersection: "${query}"`);

  const result = await geocodeAddress(query);
  if (result) {
    return result;
  }

  // Fallback: try "Road1 and Road2" format
  const fallback = `${road1} and ${road2}, ${city}, ${state}`;
  console.log(`[Geocode] Fallback: "${fallback}"`);
  return geocodeAddress(fallback);
}
