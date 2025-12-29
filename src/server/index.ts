import { serve } from "bun";
import { handleExtract } from "./routes/extract";
import { handleGeocode, handleGeocodeIntersection } from "./routes/geocode";
import { handleParcelLookup, handleParcelSearch } from "./routes/parcel";
import { handleRoadGeometry } from "./routes/roads";

// Wrap route handlers with error handling
function withErrorHandling(
  handler: (req: Request) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Server] Error:", message);
      return Response.json({ error: message }, { status: 500 });
    }
  };
}

const PORT = Number(Bun.env.PORT) || 7777;

export function startServer() {
  const server = serve({
    port: PORT,
    idleTimeout: 120,

    routes: {
      // Config endpoint
      "/api/config": {
        GET() {
          return Response.json({
            mapsApiKey: Bun.env.GOOGLE_MAPS_API_KEY ?? "",
          });
        },
      },

      // Geocoding
      "/api/geocode": {
        POST: withErrorHandling(handleGeocode),
      },
      "/api/geocode/intersection": {
        POST: withErrorHandling(handleGeocodeIntersection),
      },

      // Parcel lookup
      "/api/parcel/lookup": {
        POST: withErrorHandling(handleParcelLookup),
      },
      "/api/parcel/search": {
        POST: withErrorHandling(handleParcelSearch),
      },

      // Road geometry
      "/api/roads/geometry": {
        POST: withErrorHandling(handleRoadGeometry),
      },

      // AI extraction
      "/api/ai/extract": {
        POST: withErrorHandling(handleExtract),
      },
    },

    development: process.env.NODE_ENV !== "production" && {
      hmr: true,
      console: true,
    },
  });

  console.log(`Server running at ${server.url}`);
  return server;
}

// Start if run directly
if (import.meta.main) {
  startServer();
}
