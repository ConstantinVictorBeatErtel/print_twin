type Props = {
  label: string;
  value: string;
};

export function StatusChip({ label, value }: Props) {
  return (
    <span className="status-chip" title={`${label}: ${value}`}>
      <span className="status-chip-label">{label}</span>
      <span className="status-chip-value">{value}</span>
    </span>
  );
}
