/**
 * Floating overlay chrome.
 *
 * The sky fills the window; every control floats above it. Two rules keep that
 * workable:
 *
 *  - Containers are `pointer-events-none` and only the panels themselves turn
 *    events back on, so the sky stays draggable in the gaps between panels.
 *  - Every panel collapses to its own header, so the view can be cleared
 *    without losing track of what is where.
 */
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';

/**
 * Shared glass treatment, so every floating surface reads as one system.
 *
 * Deliberately see-through: the sky is the point, and a panel that hides it is
 * a panel in the way. A heavy blur keeps text legible over a moving star field
 * without needing an opaque fill.
 */
export const GLASS =
  'border border-white/[0.07] bg-[#080b14]/45 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.45)]';

export function DockPanel({
  title,
  icon,
  open,
  onToggle,
  children,
  className,
  bodyClassName,
  actions,
}: {
  title: string;
  icon?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className={clsx(
        'pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-xl',
        GLASS,
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
        >
          {icon && <span className="shrink-0 text-accent">{icon}</span>}
          <span className="panel-title truncate group-hover:text-muted">{title}</span>
          <ChevronDown
            size={12}
            className={clsx(
              'ml-auto shrink-0 text-dim transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </button>
        {actions && <div className="flex shrink-0 items-center gap-1 pr-2">{actions}</div>}
      </header>
      {open && (
        <div className={clsx('min-h-0 flex-1 animate-fadeIn border-t border-white/[0.06]', bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}

/** A compact read-only value for the heads-up display. */
export function HudChip({
  children,
  className,
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  return (
    <span
      className={clsx(
        'numeric inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-2xs',
        GLASS,
        tone === 'good' && 'text-good',
        tone === 'warn' && 'text-warn',
        tone === 'bad' && 'text-bad',
        tone === 'default' && 'text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Label/value pair inside a HudChip. */
export function HudValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-dim">{label}</span>
      <span className="text-ink">{children}</span>
    </span>
  );
}

/** Thin vertical rule between HUD values. */
export function HudSep() {
  return <span className="text-edge2">|</span>;
}
