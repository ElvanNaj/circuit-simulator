'use client';

export interface PanelButtonProps {
  label: string;
  sub?: string;
  ledColor?: string;
  lit?: boolean;
  variant?: 'ch' | 'run' | 'util' | 'mini';
  className?: string;
  /** red "stopped" face for run buttons */
  stopMode?: boolean;
  onPress?: () => void;
  title?: string;
}

/** Front-panel push button with LED. */
export default function PanelButton({
  label,
  sub,
  ledColor = '#45e873',
  lit,
  variant,
  className = '',
  stopMode,
  onPress,
  title,
}: PanelButtonProps) {
  const variantClass =
    variant === 'ch' ? 'ch-btn' :
    variant === 'run' ? 'run-btn' :
    variant === 'util' ? 'util-btn' :
    variant === 'mini' ? 'mini-btn' : '';
  return (
    <button
      type="button"
      title={title}
      aria-pressed={!!lit}
      className={`panel-btn ${variantClass} ${lit ? 'led-on' : ''} ${stopMode && variant === 'run' ? 'stop-on' : ''} ${className}`}
      style={{ ['--led' as string]: ledColor }}
      onClick={onPress}
    >
      <span className="led" />
      <span className="btn-legend">
        <span>{label}</span>
        {sub && <span className="btn-sub">{sub}</span>}
      </span>
    </button>
  );
}
