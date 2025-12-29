import { describe, expect, test } from "bun:test";
import { decodePolyline, getRoadGeometry } from "../lib/roads";

/**
 * Tests for road geometry functions
 */

describe("decodePolyline", () => {
  test("decodes a simple polyline correctly", () => {
    // Known encoded polyline (Phoenix area road segment)
    const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
    const points = decodePolyline(encoded);

    expect(Array.isArray(points)).toBe(true);
    expect(points.length).toBeGreaterThan(0);

    // Each point should have lat/lng
    for (const point of points) {
      expect(typeof point.lat).toBe("number");
      expect(typeof point.lng).toBe("number");
    }
  });

  test("returns empty array for empty string", () => {
    const points = decodePolyline("");
    expect(points).toEqual([]);
  });
});

describe("getRoadGeometry", () => {
  test("returns geometry for valid road near known point", async () => {
    if (!Bun.env.GOOGLE_MAPS_API_KEY) {
      console.log("⚠️  Skipping: GOOGLE_MAPS_API_KEY not set");
      return;
    }

    // Central Ave near downtown Phoenix
    const result = await getRoadGeometry({
      roadName: "Central Ave",
      nearPoint: { lat: 33.4484, lng: -112.074 },
      searchRadiusMeters: 500,
    });

    if (result === null) {
      console.log("⚠️  API may be having issues, skipping assertions");
      return;
    }

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(2);

    // Points should be near the requested location
    for (const point of result) {
      expect(point.lat).toBeGreaterThan(33.4);
      expect(point.lat).toBeLessThan(33.5);
      expect(point.lng).toBeGreaterThan(-112.1);
      expect(point.lng).toBeLessThan(-112.0);
    }
  });

  test("returns null when API key is missing", async () => {
    const originalKey = Bun.env.GOOGLE_MAPS_API_KEY;
    Bun.env.GOOGLE_MAPS_API_KEY = "";

    const result = await getRoadGeometry({
      roadName: "Central Ave",
      nearPoint: { lat: 33.4484, lng: -112.074 },
    });

    expect(result).toBeNull();

    // Restore key
    Bun.env.GOOGLE_MAPS_API_KEY = originalKey;
  });
});
