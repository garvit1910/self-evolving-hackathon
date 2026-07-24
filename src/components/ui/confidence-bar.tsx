export function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-[3px] w-24 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-accent" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="font-mono text-[10px] text-dim">{Math.round(value * 100)}%</span>
    </div>
  );
}
