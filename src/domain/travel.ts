// Travel cost composition with explicit assumptions:
//  * Flights are per traveler; the selected outbound+return components count.
//  * Hotel: rooms = ceil(travelers / 2) unless the component says otherwise;
//    the total stay cost is split evenly across travelers.
//  * Local expenses: a per-person-per-day ESTIMATE component (labeled).
//  * Any unknown required part leaves the total unverified (null high bound).
import { isEstimated, perPersonBounds } from "./money";
import type { Candidate, Component, CostSummary, Member } from "./types";

export function selectedFlights(candidate: Candidate, memberId: string): Component[] {
  return candidate.components.filter((c) => c.kind === "flight" && c.memberId === memberId && c.isSelected);
}

export function flightOptions(candidate: Candidate, memberId: string, direction: "outbound" | "return"): Component[] {
  return candidate.components.filter(
    (c) => c.kind === "flight" && c.memberId === memberId && c.data.direction === direction,
  );
}

export function selectedHotel(candidate: Candidate): Component | null {
  return candidate.components.find((c) => c.kind === "hotel" && c.isSelected) ?? null;
}

export function travelerIds(candidate: Candidate, members: Member[]): string[] {
  const withFlights = new Set(candidate.components.filter((c) => c.kind === "flight" && c.memberId).map((c) => c.memberId!));
  return withFlights.size > 0 ? members.filter((m) => withFlights.has(m.id)).map((m) => m.id) : members.map((m) => m.id);
}

export function hotelTotal(hotel: Component, travelers: number): { total: number | null; estimated: boolean } {
  const data = hotel.data;
  const nights = Number(data.nights ?? 0) || null;
  const rooms = Number(data.rooms ?? 0) || Math.ceil(travelers / 2);
  if (hotel.cost?.basis === "total" && hotel.cost.max != null) {
    return { total: hotel.cost.max, estimated: isEstimated(hotel.cost) };
  }
  const nightly = hotel.cost?.basis === "per_night" ? (hotel.cost.max ?? hotel.cost.min ?? null) : (data.nightlyRate as number | null) ?? null;
  if (nightly == null || nights == null) return { total: null, estimated: false };
  return { total: nightly * nights * rooms, estimated: isEstimated(hotel.cost) };
}

/** Per-person total for one traveler on a travel candidate. */
export function travelCostFor(candidate: Candidate, memberId: string, members: Member[]): CostSummary {
  const parts: CostSummary["parts"] = [];
  const unknownParts: string[] = [];
  let low = 0;
  let high = 0;
  let estimated = false;
  const travelers = travelerIds(candidate, members);

  const flights = selectedFlights(candidate, memberId);
  if (flights.length === 0) {
    unknownParts.push("Flights not selected");
  }
  for (const f of flights) {
    const amount = f.cost?.max ?? f.cost?.min ?? null;
    parts.push({ label: f.title, amount, sourceKind: f.sourceKind, estimated: isEstimated(f.cost) });
    if (amount == null) unknownParts.push(`${f.title}: price not verified`);
    else {
      low += amount;
      high += amount;
    }
    if (isEstimated(f.cost)) estimated = true;
  }

  const hotel = selectedHotel(candidate);
  if (hotel) {
    const { total, estimated: est } = hotelTotal(hotel, travelers.length);
    const share = total == null ? null : total / Math.max(1, travelers.length);
    parts.push({ label: `${hotel.title} (1/${travelers.length} share)`, amount: share, sourceKind: hotel.sourceKind, estimated: est });
    if (share == null) unknownParts.push("Hotel price not verified");
    else {
      low += share;
      high += share;
    }
    if (est) estimated = true;
  } else {
    unknownParts.push("Lodging not selected");
  }

  for (const local of candidate.components.filter((c) => c.kind === "local_estimate" && c.isSelected && (c.memberId == null || c.memberId === memberId))) {
    const { low: l, high: h } = perPersonBounds(local.cost, travelers.length);
    parts.push({ label: local.title, amount: h ?? l, sourceKind: local.sourceKind, estimated: true });
    if (l == null && h == null) unknownParts.push(`${local.title}: unknown`);
    else {
      low += l ?? h ?? 0;
      high += h ?? l ?? 0;
    }
    estimated = true;
  }

  return {
    low: parts.some((p) => p.amount != null) ? Math.round(low) : null,
    high: unknownParts.length > 0 ? null : Math.round(high),
    currency: "USD",
    estimated,
    unknownParts,
    parts,
  };
}
