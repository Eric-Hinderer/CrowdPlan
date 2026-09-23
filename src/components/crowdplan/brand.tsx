import Link from "next/link";

export function LogoMark({ size = 28 }: { size?: number }) {
  // Three people's circles; the shared overlap is highlighted.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <clipPath id="cp-a">
          <circle cx="12" cy="13" r="8" />
        </clipPath>
        <clipPath id="cp-b">
          <circle cx="20" cy="13" r="8" />
        </clipPath>
      </defs>
      <circle cx="12" cy="13" r="8" fill="none" stroke="var(--brand)" strokeWidth="2.4" />
      <circle cx="20" cy="13" r="8" fill="none" stroke="var(--brand)" strokeWidth="2.4" />
      <circle cx="16" cy="20" r="8" fill="none" stroke="var(--brand)" strokeWidth="2.4" />
      <g clipPath="url(#cp-a)">
        <g clipPath="url(#cp-b)">
          <circle cx="16" cy="20" r="8" fill="var(--highlight)" />
        </g>
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 rounded-lg" aria-label="CrowdPlan home">
      <LogoMark />
      <span className="text-[1.15rem] font-bold tracking-[-0.03em]" style={{ fontStretch: "88%" }}>
        CrowdPlan
      </span>
    </Link>
  );
}
