// Base UI components. Every component styles itself only with design tokens
// (see src/index.css), so the phase-4 design pass can restyle them in one place.
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ---- Button -------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Highlighted "on" state, for toolbar buttons. */
  active?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-ink',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger text-white hover:opacity-90',
};
// touch targets stay ≥ 40px on md/lg/icon
const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
  icon: 'h-10 w-10 justify-center',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', active, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex select-none items-center gap-2 rounded-control font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        active && 'bg-accent-soft text-accent-ink',
        className,
      )}
      aria-pressed={active}
      {...rest}
    />
  );
});

// ---- Toggle (switch) -----------------------------------------------------------------
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className={cx('inline-flex min-h-10 cursor-pointer items-center gap-3 text-sm', disabled && 'opacity-50')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-accent',
          checked ? 'bg-accent' : 'bg-line',
        )}
      >
        <span className={cx('absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
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
  /** Formats the value shown next to the slider. */
  format?: (value: number) => string;
}

export function Slider({ value, onChange, label, format, min = 0, max = 1, step = 0.01, className, ...rest }: SliderProps) {
  return (
    <label className={cx('flex min-h-10 items-center gap-3 text-sm', className)}>
      {label && <span className="w-20 shrink-0 text-ink-2">{label}</span>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer accent-accent"
        {...rest}
      />
      {format && <span className="w-12 shrink-0 text-right font-mono text-xs text-ink-2">{format(value)}</span>}
    </label>
  );
}

// ---- Panel ----------------------------------------------------------------------------
export interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, actions, children, className }: PanelProps) {
  return (
    <section className={cx('rounded-panel border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          {title && <h2 className="flex-1 text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

// ---- TrackItem -----------------------------------------------------------------------
export interface TrackItemProps {
  name: string;
  detail?: string;
  selected?: boolean;
  muted?: boolean;
  solo?: boolean;
  onSelect?: () => void;
  onToggleMute?: () => void;
  onToggleSolo?: () => void;
}

export function TrackItem({ name, detail, selected, muted, solo, onSelect, onToggleMute, onToggleSolo }: TrackItemProps) {
  return (
    <div
      className={cx('flex min-h-12 items-center gap-2 rounded-control px-3', selected ? 'bg-accent-soft' : 'hover:bg-surface-2')}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 py-2 text-left" aria-current={selected}>
        <div className={cx('truncate text-sm font-medium', selected && 'text-accent-ink')}>{name}</div>
        {detail && <div className="truncate text-xs text-muted">{detail}</div>}
      </button>
      {onToggleSolo && (
        <Button size="sm" variant="ghost" active={solo} onClick={onToggleSolo} aria-label={`Solo ${name}`} className="w-9 justify-center px-0">
          S
        </Button>
      )}
      {onToggleMute && (
        <Button size="sm" variant="ghost" active={muted} onClick={onToggleMute} aria-label={`Mute ${name}`} className="w-9 justify-center px-0">
          M
        </Button>
      )}
    </div>
  );
}
