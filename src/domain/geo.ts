// Straight-line distance and a clearly-labeled drive-time ESTIMATE. We never
// present these as routed travel times.

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Estimated urban drive minutes: road factor 1.3 over straight line at an
 * average 45 km/h, plus 5 minutes for parking/traffic lights.
 */
export function estimateDriveMinutes(km: number): number {
  return Math.round((km * 1.3 * 60) / 45 + 5);
}

export function hasCoords(p: { lat?: number | null; lng?: number | null } | null | undefined): p is { lat: number; lng: number } {
  return !!p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}
