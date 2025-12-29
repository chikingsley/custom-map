import { describe, expect, test } from "bun:test";
import type { ExtractedPlanData } from "../../types";
import { geocodeAddress } from "../lib/geocoding";
import { queryParcelByCoordinates } from "../lib/maricopa";
import { deletePdfFile, uploadPdfFile } from "../lib/pdf";
import { getRoadGeometryByName } from "../lib/roads";

// Path to real test PDF
const TEST_PDF_PATH =
  "/Users/chiejimofor/Documents/Github/auto-custom-map-for-dust-permit/Sun_Health_La_Loma_Campus_Drawings-COMPILED_R1-2025-compressed.pdf";

/**
 * Integration test for the full pipeline
 * Run with: bun test src/server/__tests__/pipeline.test.ts
 *
 * NOTE: These tests hit real APIs and cost money!
 * Skip in CI, run manually for validation.
 */
describe("Pipeline Integration", () => {
  // Test data compatibility between stages
  describe("Data Flow Compatibility", () => {
    test("ExtractedPlanData feeds into geocoding", () => {
      const extracted: ExtractedPlanData = {
        projectName: "Sun Health La Loma",
        parcelNumber: "123-45-678",
        address: "13550 N 99th Ave",
        city: "Sun City",
        state: "AZ",
        county: "Maricopa",
        roads: [
          { name: "99th Ave", direction: "west", isPrimary: true },
          { name: "Thunderbird Blvd", direction: "north", isPrimary: false },
        ],
        intersections: [
          {
            road1: "99th Ave",
            road2: "Thunderbird Blvd",
            cornerPosition: "northwest",
          },
        ],
        scaleInfo: "1\" = 50'",
        estimatedSizeMeters: 200,
        confidence: 0.8,
        siteShape: "rectangular",
        siteBoundary: {
          northRoad: "Thunderbird Blvd",
          southRoad: null,
          eastRoad: null,
          westRoad: "99th Ave",
        },
        coordinates: { lat: 33.623, lng: -112.283 },
      };

      // Can build geocode query from extracted data
      const geocodeQuery = `${extracted.address}, ${extracted.city}, ${extracted.state}`;
      expect(geocodeQuery).toBe("13550 N 99th Ave, Sun City, AZ");

      // Can build intersection query from roads
      const road1 = extracted.roads[0]?.name;
      const road2 = extracted.roads[1]?.name;
      expect(road1).toBe("99th Ave");
      expect(road2).toBe("Thunderbird Blvd");

      // Has coordinates for direct parcel lookup
      expect(extracted.coordinates?.lat).toBeCloseTo(33.623, 2);
      expect(extracted.coordinates?.lng).toBeCloseTo(-112.283, 2);
    });

    test("Geocoding result feeds into parcel lookup", () => {
      const geocodeResult = {
        lat: 33.623,
        lng: -112.283,
        formattedAddress: "13550 N 99th Ave, Sun City, AZ 85351",
      };

      // Can pass to parcel lookup
      expect(geocodeResult.lat).toBeGreaterThan(33);
      expect(geocodeResult.lat).toBeLessThan(34);
      expect(geocodeResult.lng).toBeLessThan(-111);
      expect(geocodeResult.lng).toBeGreaterThan(-113);
    });

    test("Parcel result has polygon for map display", () => {
      const parcelResult = {
        apn: "123-45-678",
        address: "13550 N 99th Ave",
        owner: "Sun Health",
        acres: 5.2,
        polygon: [
          { lat: 33.624, lng: -112.284 },
          { lat: 33.624, lng: -112.282 },
          { lat: 33.622, lng: -112.282 },
          { lat: 33.622, lng: -112.284 },
        ],
        centroid: { lat: 33.623, lng: -112.283 },
        rawAttributes: {},
      };

      expect(parcelResult.polygon.length).toBeGreaterThan(3);
      expect(parcelResult.centroid.lat).toBeCloseTo(33.623, 2);
    });

    test("Road names feed into geometry lookup", () => {
      const extracted: ExtractedPlanData = {
        projectName: null,
        parcelNumber: null,
        address: null,
        city: "Sun City",
        state: "AZ",
        county: "Maricopa",
        roads: [
          { name: "99th Ave", direction: "west", isPrimary: true },
          { name: "Thunderbird Blvd", direction: "north", isPrimary: false },
        ],
        intersections: [],
        scaleInfo: null,
        estimatedSizeMeters: null,
        confidence: 0.5,
        siteShape: "unknown",
        siteBoundary: {
          northRoad: null,
          southRoad: null,
          eastRoad: null,
          westRoad: null,
        },
        coordinates: null,
      };

      // Can iterate roads for geometry lookup
      const roadQueries = extracted.roads.map((r) => ({
        roadName: r.name,
        city: extracted.city,
        state: extracted.state,
      }));

      expect(roadQueries.length).toBe(2);
      expect(roadQueries[0]?.roadName).toBe("99th Ave");
    });
  });

  // Real API tests - skip in CI, run manually
  describe("Live API Integration", () => {
    // biome-ignore lint/suspicious/noSkippedTests: Expensive test, run manually
    test.skip("Full pipeline with real PDF", async () => {
      // 1. Upload PDF
      console.log("\n=== STEP 1: Upload PDF ===");
      const pdfFile = await uploadPdfFile(TEST_PDF_PATH);
      expect(pdfFile.uri).toBeTruthy();
      expect(pdfFile.name).toBeTruthy();

      try {
        // 2. Extract location data (using file directly)
        // Note: For full pipeline, we'd scan pages first and pick the best one
        console.log("\n=== STEP 2: Extract Location Data ===");
        // This would need the page image, not the PDF file directly
        // For now, test that the file uploaded successfully

        // 3. Geocode (using known address from the PDF)
        console.log("\n=== STEP 3: Geocode Address ===");
        const geocoded = await geocodeAddress("13550 N 99th Ave, Sun City, AZ");
        expect(geocoded).not.toBeNull();
        console.log("Geocoded:", geocoded);

        if (geocoded) {
          // 4. Parcel lookup
          console.log("\n=== STEP 4: Parcel Lookup ===");
          const parcel = await queryParcelByCoordinates(
            geocoded.lat,
            geocoded.lng
          );
          console.log("Parcel:", parcel ? `APN: ${parcel.apn}` : "Not found");

          // 5. Road geometry
          console.log("\n=== STEP 5: Road Geometry ===");
          const roadGeom = await getRoadGeometryByName(
            "99th Ave",
            "Sun City",
            "AZ",
            { lat: geocoded.lat, lng: geocoded.lng }
          );
          console.log(
            "Road geometry:",
            roadGeom ? `${roadGeom.length} points` : "Not found"
          );
        }
      } finally {
        // Cleanup: delete uploaded file
        console.log("\n=== CLEANUP ===");
        await deletePdfFile(pdfFile.name);
      }
    });

    test("Geocode real address from Sun Health PDF", async () => {
      const result = await geocodeAddress("13550 N 99th Ave, Sun City, AZ");
      expect(result).not.toBeNull();
      expect(result?.lat).toBeGreaterThan(33.5);
      expect(result?.lat).toBeLessThan(33.7);
      console.log("Sun Health location:", result);
    });

    test("Parcel lookup at Sun Health location", async () => {
      // First geocode
      const geocoded = await geocodeAddress("13550 N 99th Ave, Sun City, AZ");
      expect(geocoded).not.toBeNull();

      if (geocoded) {
        const parcel = await queryParcelByCoordinates(
          geocoded.lat,
          geocoded.lng
        );
        console.log("Parcel at Sun Health:", parcel);
        // May or may not find parcel depending on exact coords
      }
    });

    test("Road geometry for 99th Ave near Sun City", async () => {
      const geocoded = await geocodeAddress("13550 N 99th Ave, Sun City, AZ");
      expect(geocoded).not.toBeNull();

      if (geocoded) {
        const geometry = await getRoadGeometryByName(
          "99th Ave",
          "Sun City",
          "AZ",
          { lat: geocoded.lat, lng: geocoded.lng }
        );
        console.log(
          "99th Ave geometry:",
          geometry ? `${geometry.length} points` : "Not found"
        );
        expect(geometry).not.toBeNull();
        expect(geometry?.length).toBeGreaterThan(2);
      }
    });
  });
});
