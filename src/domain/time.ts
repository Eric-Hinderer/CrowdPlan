// Timezone-explicit helpers. All instants are epoch milliseconds (UTC);
// local dates/times are interpreted in the plan's IANA timezone.
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { WEEKDAYS, type Weekday } from "./types";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const TIME_RE = /^([01]\d|2[0-4]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isLocalTime(value: string): boolean {
  const m = TIME_RE.exec(value);
  return !!m && (m[1] !== "24" || m[2] === "00");
}

export function isLocalDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

export function minutesOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Local wall-clock date + time in tz -> instant. "24:00" means start of next day. DST-safe. */
export function zonedInstant(date: string, time: string, tz: string): number {
  if (time === "24:00") {
    return fromZonedTime(`${addDays(date, 1)}T00:00:00`, tz).getTime();
  }
  return fromZonedTime(`${date}T${time}:00`, tz).getTime();
}

/** Start of local day in tz. */
export function startOfLocalDay(date: string, tz: string): number {
  return zonedInstant(date, "00:00", tz);
}

export function localDate(instant: number, tz: string): string {
  return formatInTimeZone(instant, tz, "yyyy-MM-dd");
}

export function localTime(instant: number, tz: string): string {
  return formatInTimeZone(instant, tz, "HH:mm");
}

export function localMinutes(instant: number, tz: string): number {
  return minutesOfDay(localTime(instant, tz));
}

export function localWeekday(instant: number, tz: string): Weekday {
  const idx = Number(formatInTimeZone(instant, tz, "i")) % 7; // ISO: Mon=1..Sun=7
  return WEEKDAYS[idx];
}

export function weekdayOfDate(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  const a = new Date(`${start}T12:00:00Z`).getTime();
  const b = new Date(`${end}T12:00:00Z`).getTime();
  return Math.round((b - a) / DAY);
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Human-friendly local time, e.g. "7:00 PM". */
export function formatClock(instant: number, tz: string): string {
  return formatInTimeZone(instant, tz, "h:mm a");
}

export function formatClockShort(instant: number, tz: string): string {
  const s = formatInTimeZone(instant, tz, "h:mm a");
  return s.replace(":00 ", " ");
}

export function formatDay(instant: number, tz: string): string {
  return formatInTimeZone(instant, tz, "EEE MMM d");
}

export function formatRange(start: number, end: number, tz: string): string {
  const sameDay = localDate(start, tz) === localDate(end - 1, tz);
  if (sameDay) return `${formatDay(start, tz)}, ${formatClock(start, tz)}–${formatClock(end, tz)}`;
  return `${formatDay(start, tz)} ${formatClock(start, tz)} – ${formatDay(end, tz)} ${formatClock(end, tz)}`;
}

export function formatDateLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatTimeLabel(time: string): string {
  const mins = minutesOfDay(time);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
