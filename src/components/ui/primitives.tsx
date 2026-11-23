/** Small presentational building blocks shared by every panel. */
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={clsx(
        'flex min-h-0 flex-col rounded-lg border border-edge bg-panel/80 backdrop-blur-sm',
        className,
      )}
    >
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
          <div className="flex items-center gap-2">
            {icon && <span className="text-accent">{icon}</span>}
            <h2 className="panel-title">{title}</h2>
          </div>
          {actions}
        </header>
      )}
      <div className={clsx('min-h-0 flex-1', bodyClassName ?? 'p-3')}>{children}</div>
    </section>
  );
}

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-edge last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-panel2/60"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {icon && <span className="text-accent">{icon}</span>}
          <span className="panel-title">{title}</span>
        </span>
        <ChevronDown
          size={13}
          className={clsx('text-dim transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open && <div className="animate-fadeIn px-3 pb-3.5">{children}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  value,
  children,
  className,
}: {
  label: string;
  hint?: string;
  value?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx('mb-3 last:mb-0', className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label className="text-2xs font-medium uppercase tracking-wider text-muted">{label}</label>
        {value !== undefined && <span className="numeric text-xs text-ink">{value}</span>}
      </div>
      {children}
      {hint && <p className="mt-1 text-2xs leading-snug text-dim">{hint}</p>}
    </div>
  );
}

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  ariaLabel,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="range"
      className="w-full cursor-pointer"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Button({
  children,
  onClick,
  active,
  variant = 'default',
  size = 'md',
  title,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  variant?: 'default' | 'ghost' | 'accent';
  size?: 'sm' | 'md';
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'rounded border font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'px-2 py-1 text-2xs' : 'px-2.5 py-1.5 text-xs',
        variant === 'accent'
          ? 'border-accent bg-accent/15 text-accent2 hover:bg-accent/25'
          : active
            ? 'border-accent/70 bg-accent/15 text-accent2'
            : variant === 'ghost'
              ? 'border-transparent text-muted hover:bg-panel2 hover:text-ink'
              : 'border-edge bg-panel2 text-muted hover:border-edge2 hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between gap-3 py-1.5 text-left"
    >
      <span>
        <span className="block text-xs text-ink transition-colors group-hover:text-accent2">
          {label}
        </span>
        {hint && <span className="block text-2xs leading-snug text-dim">{hint}</span>}
      </span>
      <span
        className={clsx(
          'relative h-[17px] w-[30px] shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-accent bg-accent/30' : 'border-edge2 bg-panel2',
        )}
      >
        <span
          className={clsx(
            'absolute top-[2px] h-[11px] w-[11px] rounded-full transition-all duration-200',
            checked ? 'left-[15px] bg-accent2' : 'left-[2px] bg-dim',
          )}
        />
      </span>
    </button>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  title,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'dim';
  title?: string;
}) {
  return (
    <div title={title} className="rounded border border-edge/70 bg-panel2/50 px-2 py-1.5">
      <div className="text-2xs uppercase tracking-wider text-dim">{label}</div>
      <div
        className={clsx(
          'numeric mt-0.5 text-sm leading-tight',
          tone === 'good' && 'text-good',
          tone === 'warn' && 'text-warn',
          tone === 'bad' && 'text-bad',
          tone === 'dim' && 'text-muted',
          tone === 'default' && 'text-ink',
        )}
      >
        {value}
        {unit && <span className="ml-0.5 text-2xs text-dim">{unit}</span>}
      </div>
    </div>
  );
}

export function Pill({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium',
        tone === 'good' && 'border-good/40 bg-good/10 text-good',
        tone === 'warn' && 'border-warn/40 bg-warn/10 text-warn',
        tone === 'bad' && 'border-bad/40 bg-bad/10 text-bad',
        tone === 'default' && 'border-edge2 bg-panel2 text-muted',
      )}
    >
      {children}
    </span>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded border border-edge/60 bg-panel2/40 px-2 py-1.5 text-2xs leading-relaxed text-dim">
      {children}
    </p>
  );
}
