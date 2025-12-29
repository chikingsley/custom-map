import { describe, expect, test } from "bun:test";
import { queryParcelByCoordinates } from "../lib/maricopa";

/**
 * Tests for Maricopa County parcel API
 *
 * These tests hit the real ArcGIS API (public, no auth needed).
 * They verify:
 * 1. Valid coordinates return parcel data with correct structure
 * 2. Invalid coordinates (outside county) return null
 * 3. Edge cases are handled gracefully
 */

// Known location in Maricopa County (Phoenix City Hall)
const PHOENIX_CITY_HALL = { lat: 33.4484, lng: -112.074 };

// Location outside Maricopa County (NYC)
const NEW_YORK_CITY = { lat: 40.7128, lng: -74.006 };

// Location in the ocean (should return null)
const PACIFIC_OCEAN = { lat: 0, lng: -150 };

describe("queryParcelByCoordinates", () => {
  test("returns parcel data for valid Maricopa County coordinates", async () => {
    const result = await queryParcelByCoordinates(
      PHOENIX_CITY_HALL.lat,
      PHOENIX_CITY_HALL.lng
    );

    // Should return data, not null
    expect(result).not.toBeNull();

    if (result) {
      // Must have APN (Assessor Parcel Number)
      expect(result.apn).toBeDefined();
      expect(typeof result.apn).toBe("string");
      expect(result.apn.length).toBeGreaterThan(0);

      // Must have polygon (array of lat/lng points)
      expect(Array.isArray(result.polygon)).toBe(true);
      expect(result.polygon.length).toBeGreaterThanOrEqual(3); // Min 3 points for a polygon

      // Each polygon point must have lat/lng
      for (const point of result.polygon) {
        expect(typeof point.lat).toBe("number");
        expect(typeof point.lng).toBe("number");
        // Sanity check: coordinates are in Arizona range
        expect(point.lat).toBeGreaterThan(30);
        expect(point.lat).toBeLessThan(38);
        expect(point.lng).toBeGreaterThan(-115);
        expect(point.lng).toBeLessThan(-108);
      }

      // Must have centroid
      expect(result.centroid).toBeDefined();
      expect(typeof result.centroid.lat).toBe("number");
      expect(typeof result.centroid.lng).toBe("number");

      // rawAttributes should exist (for debugging/future use)
      expect(result.rawAttributes).toBeDefined();
      expect(typeof result.rawAttributes).toBe("object");
    }
  });

  test("returns null for coordinates outside Maricopa County", async () => {
    const result = await queryParcelByCoordinates(
      NEW_YORK_CITY.lat,
      NEW_YORK_CITY.lng
    );

    expect(result).toBeNull();
  });

  test("returns null for coordinates in ocean", async () => {
    const result = await queryParcelByCoordinates(
      PACIFIC_OCEAN.lat,
      PACIFIC_OCEAN.lng
    );

    expect(result).toBeNull();
  });

  test("handles edge case: coordinates at county boundary", async () => {
    // Far edge of Maricopa County - might or might not have parcels
    const edgeCoords = { lat: 33.0, lng: -113.3 };

    // Should not throw, should return null or valid data
    const result = await queryParcelByCoordinates(
      edgeCoords.lat,
      edgeCoords.lng
    );

    // Either null or valid structure
    if (result !== null) {
      expect(result.apn).toBeDefined();
      expect(Array.isArray(result.polygon)).toBe(true);
    }
  });
});
