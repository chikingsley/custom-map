import type { ParcelData } from "../../types";

const ARCGIS_PARCEL_URL =
  "https://gis.mcassessor.maricopa.gov/arcgis/rest/services/Parcels/MapServer/0/query";

const ASSESSOR_BASE_URL = "https://mcassessor.maricopa.gov";

/**
 * Query Maricopa County ArcGIS MapServer for parcel at coordinates
 * Uses the public REST API - no auth required
 */
export async function queryParcelByCoordinates(
  lat: number,
  lng: number
): Promise<ParcelData | null> {
  const params = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    f: "json",
  });

  const url = `${ARCGIS_PARCEL_URL}?${params.toString()}`;
  console.log(`[Parcel] Querying at ${lat}, ${lng}`);

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    console.error("[Parcel] ArcGIS error:", data.error);
    return null;
  }

  if (!data.features || data.features.length === 0) {
    console.log("[Parcel] No parcel found");
    return null;
  }

  const feature = data.features[0];
  const attrs = feature.attributes || {};
  const rings = feature.geometry?.rings?.[0] || [];

  // Convert ESRI rings to lat/lng array
  const polygon = rings.map((coord: [number, number]) => ({
    lat: coord[1],
    lng: coord[0],
  }));

  // Calculate centroid
  let centroidLat = 0;
  let centroidLng = 0;
  for (const point of polygon) {
    centroidLat += point.lat;
    centroidLng += point.lng;
  }
  if (polygon.length > 0) {
    centroidLat /= polygon.length;
    centroidLng /= polygon.length;
  }

  // Extract common fields
  const apn = attrs.APN || attrs.PARCEL_ID || attrs.PARCELNUMB || "";
  const address = attrs.SITUS || attrs.SITUS_ADDR || attrs.ADDRESS || null;
  const owner = attrs.OWNER || attrs.OWNER_NAME || null;
  const acres = attrs.ACRES || attrs.GIS_ACRES || null;

  console.log(`[Parcel] Found: APN=${apn}`);

  return {
    apn: String(apn),
    address: address ? String(address) : null,
    owner: owner ? String(owner) : null,
    acres: acres ? Number(acres) : null,
    polygon,
    centroid: { lat: centroidLat, lng: centroidLng },
    rawAttributes: attrs,
  };
}

/**
 * Fetch additional parcel details from Assessor's API
 */
export async function fetchAssessorDetails(
  apn: string
): Promise<Record<string, unknown> | null> {
  const token = Bun.env.MARICOPA_ASSESSOR_TOKEN;
  if (!token) {
    return null;
  }

  const cleanApn = apn.replace(/[-\s.]/g, "");
  const url = `${ASSESSOR_BASE_URL}/parcel/${cleanApn}`;

  const response = await fetch(url, {
    headers: {
      AUTHORIZATION: token,
      "User-Agent": "dust-permit-app",
    },
  });

  if (!response.ok) {
    console.log(`[Assessor] API returned ${response.status}`);
    return null;
  }

  return response.json();
}

/**
 * Search properties by address/query
 */
export async function searchProperties(query: string): Promise<unknown> {
  const token = Bun.env.MARICOPA_ASSESSOR_TOKEN;
  if (!token) {
    throw new Error("MARICOPA_ASSESSOR_TOKEN not configured");
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `${ASSESSOR_BASE_URL}/search/property/?q=${encodedQuery}`;

  const response = await fetch(url, {
    headers: {
      AUTHORIZATION: token,
      "User-Agent": "dust-permit-app",
    },
  });

  if (!response.ok) {
    throw new Error(`Assessor API error: ${response.status}`);
  }

  return response.json();
}
