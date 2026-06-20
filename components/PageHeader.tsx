import React from 'react';

// Header canônico de página interna (DESIGN_SYSTEM.md linha 61): h1
// `text-2xl md:text-3xl font-black uppercase tracking-tighter`, sem itálico
// (itálico é reservado a headers de modal). Centraliza aqui pra impedir o
// drift que cada página reimplementando o próprio <h1> foi acumulando.
interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, icon, actions }) => (
  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
    <div className="flex items-center gap-3 min-w-0">
      {icon}
      <div className="min-w-0">
        <h1 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
          {title}
        </h1>
        {subtitle && (
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">
            {subtitle}
          </p>
        )}
      </div>
    </div>
    {actions && <div className="flex gap-2">{actions}</div>}
  </div>
);

export default PageHeader;
