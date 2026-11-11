// Base UI components (design direction A2). They only use design tokens
// (src/index.css), so the look can be adjusted in one place.
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { Icon, type IconName } from '../icons';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ---- Button -------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** "On" state for toolbar toggles (accent-coloured text, no fill). */
  active?: boolean;
  icon?: IconName;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-ink',
  secondary: 'border border-line text-ink hover:bg-hover',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
  danger: 'border border-line text-danger hover:bg-hover',
};
const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[13px]',
  md: 'h-9 px-3 text-sm',
  lg: 'h-11 px-4 text-[15px]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', active, icon, className, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        variants[variant], sizes[size], active && '!text-accent', className,
      )}
      aria-pressed={active}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
});

/** Square icon-only button; `label` is required for accessibility (also the tooltip). */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'icon' | 'children'> & { icon: IconName; label: string }>(
  function IconButton({ icon, label, className, size = 'md', variant = 'ghost', ...rest }, ref) {
    const box = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
    return (
      <Button ref={ref} variant={variant} size={size} aria-label={label} title={label} className={cx(box, '!px-0', className)} {...rest}>
        <Icon name={icon} />
      </Button>
    );
  },
);

// ---- Toggle (switch) -----------------------------------------------------------------
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className={cx('inline-flex min-h-9 cursor-pointer items-center gap-3', disabled && 'opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line-strong')}
      >
        <span className={cx('absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform', checked && 'translate-x-4')} />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

// ---- Slider ---------------------------------------------------------------------------
export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number;
  onChange: (value: number) => void;
  label?: ReactNode;
  format?: (value: number) => string;
}

export function Slider({ value, onChange, label, format, min = 0, max = 1, step = 0.01, className, ...rest }: SliderProps) {
  return (
    <label className={cx('flex min-h-9 items-center gap-3', className)}>
      {label && <span className="w-16 shrink-0 text-ink-2">{label}</span>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer" {...rest} />
      {format && <span className="w-12 shrink-0 text-right font-mono text-xs text-ink-2 tabular-nums">{format(value)}</span>}
    </label>
  );
}

// ---- Field -----------------------------------------------------------------------------
export const inputClass = 'h-9 w-full rounded-control border border-line bg-surface px-2.5 text-ink outline-none focus:border-accent';

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

// ---- Panel (a titled section inside a side panel) -------------------------------------
export interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, actions, children, className }: PanelProps) {
  return (
    <section className={cx('border-b border-line', className)}>
      {(title || actions) && (
        <header className="flex items-center gap-2 px-4 pt-3 pb-1">
          {title && <h3 className="flex-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>}
          {actions}
        </header>
      )}
      <div className="px-4 pb-3">{children}</div>
    </section>
  );
}

// ---- SidePanel (docked on desktop, sliding over the content on phones) ------------------
export interface SidePanelProps {
  title: ReactNode;
  side: 'left' | 'right';
  onClose: () => void;
  children: ReactNode;
  /** Width on desktop (CSS length). */
  width?: string;
  /** Float over the content instead of taking space next to it. */
  overlay?: boolean;
  footer?: ReactNode;
}

export function SidePanel({ title, side, onClose, children, width = '300px', overlay, footer }: SidePanelProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside
      style={{ ['--panel-w' as string]: width }}
      className={cx(
        'z-30 flex min-h-0 flex-col bg-surface',
        side === 'left' ? 'border-r border-line' : 'border-l border-line',
        // phones: always an overlay over the content
        'max-md:absolute max-md:inset-y-0 max-md:w-[min(92vw,var(--panel-w))] max-md:shadow-xl',
        side === 'left' ? 'max-md:left-0' : 'max-md:right-0',
        overlay ? 'md:absolute md:inset-y-0 md:w-[var(--panel-w)] md:shadow-[8px_0_24px_rgb(0_0_0/0.06)]' : 'md:w-[var(--panel-w)] md:shrink-0',
        overlay && (side === 'left' ? 'md:left-0' : 'md:right-0'),
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-4">
        <h2 className="flex-1 truncate text-[13px] font-semibold">{title}</h2>
        <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && <footer className="shrink-0 border-t border-line">{footer}</footer>}
    </aside>
  );
}

// ---- Popover (small menu above/below a button) -------------------------------------------
/**
 * Closes on Escape and on a click outside. Pass the button that opens it as `anchor`, so that button can
 * toggle it: a click on it then doesn't count as "outside" (which would close and at once reopen it).
 */
export function Popover({ open, onClose, children, className, anchor }: {
  open: boolean; onClose: () => void; children: ReactNode; className?: string; anchor?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor?.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => window.addEventListener('pointerdown', onDown));
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return (
    <div ref={ref} className={cx('absolute z-40 min-w-44 rounded-panel border border-line bg-surface p-1 shadow-[0_8px_24px_rgb(0_0_0/0.12)]', className)}>
      {children}
    </div>
  );
}

export function MenuItem({ children, onClick, active, danger }: { children: ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cx('flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left hover:bg-hover', active && 'text-accent', danger && 'text-danger')}>
      <span className="w-4">{active && <Icon name="check" size={14} />}</span>
      {children}
    </button>
  );
}

// ---- TrackItem -----------------------------------------------------------------------
export interface TrackItemProps {
  name: string;
  detail?: string;
  icon?: IconName;
  selected?: boolean;
  muted?: boolean;
  solo?: boolean;
  onSelect?: () => void;
  onToggleMute?: () => void;
  onToggleSolo?: () => void;
}

export function TrackItem({ name, detail, icon = 'guitar', selected, muted, solo, onSelect, onToggleMute, onToggleSolo }: TrackItemProps) {
  return (
    <div className={cx('group flex min-h-12 items-center gap-2.5 border-l-2 pr-2 pl-3.5', selected ? 'border-accent bg-hover' : 'border-transparent hover:bg-hover')}>
      <span className={selected ? 'text-accent' : 'text-ink-2'}><Icon name={icon} /></span>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 py-2 text-left" aria-current={selected}>
        <div className={cx('truncate', selected && 'font-semibold')}>{name}</div>
        {detail && <div className="truncate text-xs text-muted">{detail}</div>}
      </button>
      {(onToggleSolo || onToggleMute) && (
        <div className={cx('flex gap-0.5', !(selected || solo || muted) && 'opacity-0 group-hover:opacity-100 max-md:opacity-100')}>
          {onToggleSolo && (
            <button type="button" onClick={onToggleSolo} aria-pressed={solo} aria-label={`Solo ${name}`}
              className={cx('h-7 w-6 rounded-control text-[11px] font-semibold', solo ? 'text-accent' : 'text-muted hover:text-ink')}>S</button>
          )}
          {onToggleMute && (
            <button type="button" onClick={onToggleMute} aria-pressed={muted} aria-label={`Mute ${name}`}
              className={cx('h-7 w-6 rounded-control text-[11px] font-semibold', muted ? 'text-danger' : 'text-muted hover:text-ink')}>M</button>
          )}
        </div>
      )}
    </div>
  );
}
