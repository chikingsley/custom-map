import { getRoadGeometryByName } from "../lib/roads";

/**
 * POST /api/roads/geometry
 * Get road polyline geometry for map display
 */
export async function handleRoadGeometry(req: Request): Promise<Response> {
  const { roadName, intersectionPoint, city, state } = await req.json();

  if (!roadName) {
    return Response.json({ error: "roadName required" }, { status: 400 });
  }

  const points = await getRoadGeometryByName(
    roadName,
    city,
    state,
    intersectionPoint
  );

  if (!points || points.length === 0) {
    return Response.json(
      { error: `Could not get geometry for road: ${roadName}` },
      { status: 404 }
    );
  }

  return Response.json({
    roadName,
    points,
    pointCount: points.length,
  });
}
