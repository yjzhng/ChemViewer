interface Props {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}

/** Plain on/off toggle switch (used in the header and Settings). */
export function Switch({ checked, onChange, label }: Props) {
  return (
    <button
      className={`switch${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      title={label}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  );
}
