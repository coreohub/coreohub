import React from 'react';

interface BrandIconProps {
  size?: number;
  className?: string;
  variant?: 'full' | 'icon';
}

const BrandIcon: React.FC<BrandIconProps> = ({ size = 32, className = '', variant = 'icon' }) => {
  const img = (
    <img
      src="/coreohub-avatar.png"
      alt="CoreoHub"
      width={size}
      height={size}
      className={`rounded-xl object-contain ${variant === 'icon' ? className : ''}`}
      style={{ width: size, height: size }}
    />
  );

  if (variant === 'full') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {img}
        <span
          className="font-black uppercase tracking-tighter text-slate-900 dark:text-white"
          style={{ fontSize: size * 0.5 }}
        >
          Coreo<span className="text-[#ff0068]">Hub</span>
        </span>
      </div>
    );
  }

  return img;
};

export default BrandIcon;
