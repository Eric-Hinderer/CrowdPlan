// Provider-neutral search contracts. UI and domain code depend on these
// normalized shapes only, never on SerpAPI response shapes.
import type { Money, WeeklyHours } from "@/domain/types";

export interface Provenance {
  provider: string; // e.g. "serpapi:google_maps"
  fetchedAt: string; // ISO
  sourceUrl: string | null;
  providerRef: string | null;
}

export interface NormalizedPlace extends Provenance {
  title: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  priceText: string | null;
  cost: Money | null;
  categories: string[];
  hours: WeeklyHours | null;
  website: string | null;
  phone: string | null;
  thumbnail: string | null;
}

export interface NormalizedEvent extends Provenance {
  title: string;
  whenText: string | null;
  startDate: string | null;
  venueName: string | null;
  address: string | null;
  description: string | null;
  ticketUrl: string | null;
  thumbnail: string | null;
}

export interface NormalizedWebResult extends Provenance {
  title: string;
  snippet: string | null;
  displayedLink: string | null;
}

export interface NormalizedFlight extends Provenance {
  from: string;
  to: string;
  airline: string | null;
  flightNumbers: string[];
  /** epoch ms, converted from airport-local times */
  departAt: number;
  arriveAt: number;
  departTz: string | null;
  arriveTz: string | null;
  /** true when an airport timezone was unknown and the plan timezone was assumed */
  tzAssumed: boolean;
  departLocal: string;
  arriveLocal: string;
  stops: number;
  durationMinutes: number | null;
  price: number | null;
  currency: string;
}

export interface NormalizedHotel extends Provenance {
  name: string;
  lat: number | null;
  lng: number | null;
  nightlyRate: number | null;
  totalRate: number | null;
  rating: number | null;
  reviewCount: number | null;
  hotelClass: number | null;
  amenities: string[];
  thumbnail: string | null;
}

export type SearchEngine = "google_maps" | "google_events" | "google" | "google_flights" | "google_hotels";

export type SearchOutcome<T> =
  | { status: "ok"; data: T; fetchedAt: string; cached: boolean; stale?: boolean }
  | { status: "not_configured" }
  | { status: "budget_exhausted"; stale?: { data: T; fetchedAt: string } }
  | { status: "error"; message: string; stale?: { data: T; fetchedAt: string } };
