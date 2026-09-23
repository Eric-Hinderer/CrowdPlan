import { describe, expect, it } from "vitest";
import { checkExternalUrl, parsePlaceUrl } from "@/domain/urls";

describe("user-supplied URLs", () => {
  it("rejects non-web schemes, credentials, private and IP hosts", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://example.com/x",
      "http://localhost:3000/admin",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://10.0.0.5/",
      "https://user:pass@example.com/",
      "http://intranet/",
      "https://printer.local/",
      "not a url",
    ]) {
      expect(checkExternalUrl(bad).ok, bad).toBe(false);
    }
  });

  it("accepts public https links and strips fragments", () => {
    const r = checkExternalUrl("https://www.firebirdsrestaurants.com/locations/nebraska/omaha/#menu");
    expect(r).toEqual({ ok: true, url: "https://www.firebirdsrestaurants.com/locations/nebraska/omaha/", host: "www.firebirdsrestaurants.com" });
  });

  it("extracts a place name and coordinates from Google Maps links", () => {
    const r = parsePlaceUrl("https://www.google.com/maps/place/Charleston's+Restaurant/@41.2586,-96.0981,17z/data=!3m1");
    expect(r).toMatchObject({ title: "Charleston's Restaurant", lat: 41.2586, lng: -96.0981, source: "google_maps" });
  });

  it("extracts names from Yelp links and keeps unknown sites nameless", () => {
    expect(parsePlaceUrl("https://www.yelp.com/biz/texas-roadhouse-omaha")).toMatchObject({ title: "Texas Roadhouse", source: "yelp" });
    expect(parsePlaceUrl("https://example.com/somewhere")).toMatchObject({ title: null, source: "web" });
  });
});
