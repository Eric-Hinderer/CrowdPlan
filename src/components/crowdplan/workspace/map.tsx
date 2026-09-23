"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { LngLatBounds, Map as MapLibre, Marker, NavigationControl, Popup } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { CandidateEvaluation } from "@/domain/types";
import type { CandidateRow } from "@/lib/plan-data";
import { useWorkspace } from "./context";

// OpenFreeMap: free vector tiles, no API key or per-request billing.
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** Map of located options and (rounded) participant starting points: "Where is everything relative to us?" */
export function PlanMap({ candidates, evaluations, compact }: { candidates: CandidateRow[]; evaluations: CandidateEvaluation[]; compact?: boolean }) {
  const ws = useWorkspace();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new MapLibre({
      container: ref.current,
      style: STYLE,
      center: [candidates[0]?.lng ?? -96, candidates[0]?.lat ?? 41.25],
      zoom: 11,
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const bounds = new LngLatBounds();
    const statusOf = new Map(evaluations.map((e) => [e.candidateId, e]));
    for (const c of candidates) {
      if (c.lat == null || c.lng == null) continue;
      const e = statusOf.get(c.id);
      const el = document.createElement("div");
      el.className = "grid place-items-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-md";
      el.style.cssText = `width:28px;height:28px;background:${!e || e.status === "FEASIBLE" ? "var(--brand)" : e.status === "UNVERIFIED" ? "var(--warn)" : "var(--blocked)"}`;
      el.textContent = e?.rank ? String(e.rank) : "•";
      el.setAttribute("aria-label", c.title);
      new Marker({ element: el }).setLngLat([c.lng, c.lat]).setPopup(new Popup({ offset: 16 }).setText(`${c.title}${c.address ? ` — ${c.address}` : ""}`)).addTo(map);
      bounds.extend([c.lng, c.lat]);
    }
    for (const m of ws.bundle.members) {
      if (m.origin_lat == null || m.origin_lng == null) continue;
      const el = document.createElement("div");
      el.style.cssText = `width:14px;height:14px;border-radius:9999px;border:2px solid white;background:${m.color};box-shadow:0 0 0 1px rgba(0,0,0,.2)`;
      el.title = `${m.display_name} (approximate)`;
      new Marker({ element: el }).setLngLat([m.origin_lng, m.origin_lat]).addTo(map);
      bounds.extend([m.origin_lng, m.origin_lat]);
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [candidates, evaluations, ws.bundle.members]);

  return <div ref={ref} className={compact ? "h-56 overflow-hidden rounded-2xl border border-rule" : "h-80 overflow-hidden rounded-2xl border border-rule"} role="region" aria-label="Map of options and where people are coming from" />;
}
