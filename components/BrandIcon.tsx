import React from 'react';

interface BrandIconProps {
  size?: number;
  className?: string;
  variant?: 'full' | 'icon';
}

// Monograma "C" neon rosa — abstração do logo oficial do CoreoHub.
// Três arcos concêntricos ao redor de um ponto central, em #ff0068.
const CMark: React.FC<{ size: number; className?: string }> = ({ size, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-label="CoreoHub"
  >
    <defs>
      <radialGradient id="coreoGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#ff0068" stopOpacity="0.45" />
        <stop offset="100%" stopColor="#ff0068" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="32" cy="32" r="28" fill="url(#coreoGlow)" />
    <path
      d="M46 20 A16 16 0 1 0 46 44"
      stroke="#ff0068"
      strokeWidth="3.5"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M44 14 A20 20 0 0 0 24 22"
      stroke="#ff0068"
      strokeWidth="2.5"
      strokeLinecap="round"
      fill="none"
      opacity="0.85"
    />
    <path
      d="M24 42 A20 20 0 0 0 44 50"
      stroke="#ff0068"
      strokeWidth="2.5"
      strokeLinecap="round"
      fill="none"
      opacity="0.85"
    />
    <circle cx="32" cy="32" r="3" fill="#ff0068" />
    <circle cx="32" cy="32" r="1.2" fill="#ffffff" />
  </svg>
);

const BrandIcon: React.FC<BrandIconProps> = ({ size = 32, className = '', variant = 'icon' }) => {
  if (variant === 'full') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <CMark size={size} />
        <span
          className="font-black uppercase tracking-tighter text-slate-900 dark:text-white"
          style={{ fontSize: size * 0.5 }}
        >
          Coreo<span className="text-[#ff0068]">Hub</span>
        </span>
      </div>
    );
  }

  return <CMark size={size} className={className} />;
};

export default BrandIcon;
