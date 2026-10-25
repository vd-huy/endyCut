import { type ReactNode } from 'react'

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange,
  onCommitStart
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
  onCommitStart?: () => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-ink-300">{label}</span>
      <input
        type="range"
        className="flex-1"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => onCommitStart?.()}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="w-14 shrink-0 text-right tabular-nums text-ink-400">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </label>
  )
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-ink-700/60 px-3 py-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

export function IconButton({
  children,
  onClick,
  active,
  title,
  disabled
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-accent/20 text-accent' : 'text-ink-300 hover:bg-ink-700 hover:text-white'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}
