"use client";

import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export { cn };

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-ink hover:brightness-110 active:brightness-95 shadow-[0_2px_0_color-mix(in_oklab,var(--brand)_55%,black)]",
  secondary: "bg-surface text-ink border border-rule hover:border-ink-3",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
  danger: "bg-blocked text-white hover:brightness-110",
  quiet: "text-brand hover:underline underline-offset-4 px-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; loading?: boolean }>(
  function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[filter,transform,background,border-color] disabled:opacity-50 disabled:pointer-events-none active:translate-y-px select-none",
          size === "sm" && "h-9 px-3 text-sm",
          size === "md" && "h-11 px-4",
          size === "lg" && "h-13 px-6 text-lg",
          variants[variant],
          className,
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner /> : null}
        {children}
      </button>
    );
  },
);

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("size-4 animate-spin", className)} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-rule bg-surface px-3.5 text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 transition",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-xl border border-rule bg-surface px-3.5 py-3 text-ink placeholder:text-ink-3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 transition resize-none",
        className,
      )}
      {...props}
    />
  );
});

export function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: string; error?: string | null; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm text-blocked">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="t-small text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Accessible sheet built on the native <dialog> element (focus trap + Esc for free). */
export function Sheet({ open, onClose, title, children, labelledBy }: { open: boolean; onClose: () => void; title: string; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const id = labelledBy ?? `sheet-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="flex max-h-[92dvh] flex-col">
        <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-3">
          <h2 id={id} className="t-heading">
            {title}
          </h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{open ? children : null}</div>
      </div>
    </dialog>
  );
}

export function Avatar({ name, color, size = 32, ring }: { name: string; color: string; size?: number; ring?: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-bold text-white", ring && "ring-2 ring-paper")}
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
      title={name}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ people, max = 5, size = 28 }: { people: Array<{ id: string; name: string; color: string }>; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  return (
    <span className="inline-flex items-center" aria-label={people.map((p) => p.name).join(", ")}>
      {shown.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i ? -size * 0.3 : 0 }}>
          <Avatar name={p.name} color={p.color} size={size} ring />
        </span>
      ))}
      {people.length > max ? <span className="ml-1.5 text-sm text-ink-3">+{people.length - max}</span> : null}
    </span>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-rule px-5 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-sm text-ink-2">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-xl border border-blocked/30 bg-blocked/8 px-3.5 py-2.5 text-sm text-blocked">
      {children}
    </p>
  );
}
