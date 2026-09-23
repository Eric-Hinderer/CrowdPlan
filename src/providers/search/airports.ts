// Minimal airport → IANA timezone table for converting provider local times
// into instants. Unknown airports fall back to the plan timezone and are
// flagged (tzAssumed) rather than silently treated as exact.
export const AIRPORT_TZ: Record<string, string> = {
  OMA: "America/Chicago", LNK: "America/Chicago", DSM: "America/Chicago", MCI: "America/Chicago", ORD: "America/Chicago",
  MDW: "America/Chicago", MSP: "America/Chicago", STL: "America/Chicago", DFW: "America/Chicago", DAL: "America/Chicago",
  IAH: "America/Chicago", HOU: "America/Chicago", AUS: "America/Chicago", SAT: "America/Chicago", MSY: "America/New_Orleans",
  BNA: "America/Chicago", MEM: "America/Chicago", MKE: "America/Chicago", OKC: "America/Chicago", TUL: "America/Chicago",
  LAS: "America/Los_Angeles", LAX: "America/Los_Angeles", SFO: "America/Los_Angeles", SAN: "America/Los_Angeles",
  SEA: "America/Los_Angeles", PDX: "America/Los_Angeles", SJC: "America/Los_Angeles", OAK: "America/Los_Angeles",
  DEN: "America/Denver", SLC: "America/Denver", ABQ: "America/Denver", PHX: "America/Phoenix",
  ATL: "America/New_York", JFK: "America/New_York", LGA: "America/New_York", EWR: "America/New_York", BOS: "America/New_York",
  MIA: "America/New_York", FLL: "America/New_York", MCO: "America/New_York", TPA: "America/New_York", CLT: "America/New_York",
  DCA: "America/New_York", IAD: "America/New_York", BWI: "America/New_York", PHL: "America/New_York", DTW: "America/Detroit",
  CLE: "America/New_York", PIT: "America/New_York", IND: "America/Indiana/Indianapolis", CVG: "America/New_York",
  RDU: "America/New_York", HNL: "Pacific/Honolulu", ANC: "America/Anchorage", CUN: "America/Cancun",
};

/** Destination/city name → primary airport code. */
export const CITY_AIRPORT: Record<string, string> = {
  "las vegas": "LAS", vegas: "LAS", chicago: "ORD", austin: "AUS", nashville: "BNA", denver: "DEN", "new york city": "JFK",
  "new york": "JFK", nyc: "JFK", miami: "MIA", "new orleans": "MSY", seattle: "SEA", "san diego": "SAN", orlando: "MCO",
  boston: "BOS", "kansas city": "MCI", phoenix: "PHX", "los angeles": "LAX", "san francisco": "SFO", "cancún": "CUN",
  cancun: "CUN", omaha: "OMA", lincoln: "LNK", "des moines": "DSM", minneapolis: "MSP", dallas: "DFW", houston: "IAH",
  atlanta: "ATL", "salt lake city": "SLC", honolulu: "HNL", "st. louis": "STL", "st louis": "STL",
};

export function airportFor(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.trim();
  const code = /\b([A-Z]{3})\b/.exec(t)?.[1];
  if (code && (AIRPORT_TZ[code] || /^[A-Z]{3}$/.test(t))) return code;
  const lower = t.toLowerCase().replace(/,.*$/, "").trim();
  return CITY_AIRPORT[lower] ?? null;
}
