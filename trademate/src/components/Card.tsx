import type { ReactNode } from "react";

export function Card({
  title,
  icon,
  badge,
  children,
  muted = false,
}: {
  title?: string;
  icon?: ReactNode;
  badge?: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border border-white/5 bg-ink-900/90 p-4 shadow-[var(--card-shadow)] ${
        muted ? "opacity-70" : ""
      }`}
    >
      {(title || badge) && (
        <header className="mb-3 flex items-center gap-2">
          {icon && <span className="text-gold-400 [&>svg]:h-4.5 [&>svg]:w-4.5">{icon}</span>}
          <h2 className="text-sm font-semibold tracking-wide text-white">{title}</h2>
          {badge && (
            <span className="ml-auto rounded-full border border-gold-500/30 bg-gold-500/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-gold-300">
              {badge}
            </span>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
