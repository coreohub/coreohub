import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Ticket, GraduationCap, Tag } from 'lucide-react';

// Tabs de navegação compartilhadas entre as 3 telas do hub "Vendas"
// (Ingressos/Workshops/Cupons). Padrão Stripe Dashboard / Sympla Painel de
// Vendas: continuam sendo rotas separadas (cada uma mantém seu próprio state
// pesado e fetch), mas a navegação entre elas parece 1 hub único.
const TABS = [
  { path: '/vendas-ingressos',    label: 'Ingressos', icon: Ticket        },
  { path: '/workshops-do-evento', label: 'Workshops',  icon: GraduationCap },
  { path: '/cupons',              label: 'Cupons',     icon: Tag           },
] as const;

const VendasTabs: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-2xl mb-6 w-fit overflow-x-auto max-w-full">
      {TABS.map(tab => {
        const active = location.pathname === tab.path;
        const Icon = tab.icon;
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
              active
                ? 'bg-white dark:bg-white/10 text-[#ff0068] shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <Icon size={13} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default VendasTabs;
