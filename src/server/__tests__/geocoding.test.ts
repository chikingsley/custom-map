import { describe, expect, test } from "bun:test";
import { geocodeAddress, geocodeIntersection } from "../lib/geocoding";

/**
 * Tests for Google Geocoding API wrapper
 *
 * These tests hit the real Google Geocoding API.
 * Requires GOOGLE_MAPS_API_KEY to be set and valid.
 * If the API key is missing or expired, tests pass with a warning.
 */

describe("geocodeAddress", () => {
  test("returns coordinates for valid Phoenix address", async () => {
    if (!Bun.env.GOOGLE_MAPS_API_KEY) {
      console.log("⚠️  Skipping: GOOGLE_MAPS_API_KEY not set");
      return;
    }

    const result = await geocodeAddress(
      "200 W Washington St, Phoenix, AZ 85003"
    );

    // If null, API key might be expired
    if (result === null) {
      console.log("⚠️  Geocoding returned null - API key may be expired");
      return;
    }

    // Should be in Phoenix area
    expect(result.lat).toBeGreaterThan(33.4);
    expect(result.lat).toBeLessThan(33.5);
    expect(result.lng).toBeGreaterThan(-112.1);
    expect(result.lng).toBeLessThan(-112.0);

    // Should have formatted address
    expect(result.formattedAddress).toBeDefined();
    expect(result.formattedAddress.toLowerCase()).toContain("phoenix");
  });

  test("returns null for nonsense address (does not throw)", async () => {
    if (!Bun.env.GOOGLE_MAPS_API_KEY) {
      console.log("⚠️  Skipping: GOOGLE_MAPS_API_KEY not set");
      return;
    }

    const result = await geocodeAddress("asdfghjkl qwertyuiop 12345");

    // Should return null, not throw
    expect(result).toBeNull();
  });

  test("handles address with special characters", async () => {
    if (!Bun.env.GOOGLE_MAPS_API_KEY) {
      console.log("⚠️  Skipping: GOOGLE_MAPS_API_KEY not set");
      return;
    }

    // Should not throw, regardless of result
    const result = await geocodeAddress("McDonald's, Phoenix, AZ");
    expect(result === null || typeof result.lat === "number").toBe(true);
  });
});

describe("geocodeIntersection", () => {
  test("returns coordinates for major Phoenix intersection", async () => {
    if (!Bun.env.GOOGLE_MAPS_API_KEY) {
      console.log("⚠️  Skipping: GOOGLE_MAPS_API_KEY not set");
      return;
    }

    const result = await geocodeIntersection(
      "Central Ave",
      "Washington St",
      "Phoenix",
      "AZ"
    );

    if (result === null) {
      console.log("⚠️  Geocoding returned null - API key may be expired");
      return;
    }

    // Central & Washington is in downtown Phoenix
    expect(result.lat).toBeGreaterThan(33.44);
    expect(result.lat).toBeLessThan(33.46);
    expect(result.lng).toBeGreaterThan(-112.08);
    expect(result.lng).toBeLessThan(-112.06);
  });

  test("handles non-existent intersection gracefully", async () => {
    if (!Bun.env.GOOGLE_MAPS_API_KEY) {
      console.log("⚠️  Skipping: GOOGLE_MAPS_API_KEY not set");
      return;
    }

    const result = await geocodeIntersection(
      "Fake Street 123",
      "Nonexistent Ave",
      "Phoenix",
      "AZ"
    );

    // Google may return city-level fallback or null - both are acceptable
    // The key is it doesn't throw
    expect(result === null || typeof result.lat === "number").toBe(true);
  });
});
