import { geocodeAddress, geocodeIntersection } from "../lib/geocoding";

/**
 * POST /api/geocode
 * Geocode an address to coordinates
 */
export async function handleGeocode(req: Request): Promise<Response> {
  const { address } = await req.json();

  if (!address) {
    return Response.json({ error: "address required" }, { status: 400 });
  }

  const result = await geocodeAddress(address);

  if (!result) {
    return Response.json({ error: "Geocoding failed" }, { status: 404 });
  }

  return Response.json(result);
}

/**
 * POST /api/geocode/intersection
 * Geocode an intersection (two roads)
 */
export async function handleGeocodeIntersection(
  req: Request
): Promise<Response> {
  const { road1, road2, city, state } = await req.json();

  if (!(road1 && road2 && city)) {
    return Response.json(
      { error: "road1, road2, and city required" },
      { status: 400 }
    );
  }

  const result = await geocodeIntersection(road1, road2, city, state || "");

  if (!result) {
    return Response.json(
      { error: `Could not geocode intersection: ${road1} & ${road2}` },
      { status: 404 }
    );
  }

  return Response.json(result);
}
