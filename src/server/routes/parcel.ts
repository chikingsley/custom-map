import {
  fetchAssessorDetails,
  queryParcelByCoordinates,
  searchProperties,
} from "../lib/maricopa";

/**
 * POST /api/parcel/lookup
 * Lookup parcel by coordinates
 */
export async function handleParcelLookup(req: Request): Promise<Response> {
  const { lat, lng, includeAssessorDetails } = await req.json();

  if (lat === undefined || lng === undefined) {
    return Response.json({ error: "lat and lng required" }, { status: 400 });
  }

  const parcel = await queryParcelByCoordinates(lat, lng);

  if (!parcel) {
    return Response.json(
      { error: "No parcel found at location" },
      { status: 404 }
    );
  }

  // Optionally enrich with Assessor's API data
  let assessorDetails: Record<string, unknown> | null = null;
  if (includeAssessorDetails && parcel.apn) {
    assessorDetails = await fetchAssessorDetails(parcel.apn);
  }

  return Response.json({
    ...parcel,
    assessorDetails,
  });
}

/**
 * POST /api/parcel/search
 * Search parcels by address
 */
export async function handleParcelSearch(req: Request): Promise<Response> {
  const { query } = await req.json();

  if (!query) {
    return Response.json({ error: "query required" }, { status: 400 });
  }

  const data = await searchProperties(query);
  return Response.json(data);
}
