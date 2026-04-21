import React from 'react';

interface BrandIconProps {
  size?: number;
  className?: string;
  variant?: 'full' | 'icon';
}

const BrandIcon: React.FC<BrandIconProps> = ({ size = 32, className = '', variant = 'icon' }) => {
  if (variant === 'full') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Dance Pró Festival"
        >
          {/* Base hexagon */}
          <polygon
            points="16,2 28,9 28,23 16,30 4,23 4,9"
            fill="#ff0068"
            opacity="0.15"
          />
          <polygon
            points="16,2 28,9 28,23 16,30 4,23 4,9"
            fill="none"
            stroke="#ff0068"
            strokeWidth="1.5"
          />
          {/* Music wave symbol */}
          <path
            d="M10 19 Q13 13 16 16 Q19 19 22 13"
            stroke="#ff0068"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          {/* Center dot */}
          <circle cx="16" cy="16" r="2" fill="#ff0068" />
        </svg>
        <span
          className="font-black uppercase tracking-tighter text-slate-900 dark:text-white"
          style={{ fontSize: size * 0.5 }}
        >
          Dance <span className="text-[#ff0068]">Pró</span>
        </span>
      </div>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Dance Pró Festival"
    >
      <polygon
        points="16,2 28,9 28,23 16,30 4,23 4,9"
        fill="#ff0068"
        opacity="0.15"
      />
      <polygon
        points="16,2 28,9 28,23 16,30 4,23 4,9"
        fill="none"
        stroke="#ff0068"
        strokeWidth="1.5"
      />
      <path
        d="M10 19 Q13 13 16 16 Q19 19 22 13"
        stroke="#ff0068"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16" cy="16" r="2" fill="#ff0068" />
    </svg>
  );
};

export default BrandIcon;
