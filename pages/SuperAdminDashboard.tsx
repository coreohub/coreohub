import React, { useState, useEffect } from 'react';
import {
  BarChart3, Users, DollarSign, Activity, Globe, ShieldAlert,
  ArrowUpRight, Settings, RefreshCw, Layers, CreditCard, HardDrive
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../services/supabase';

const growthData = [
  { name: 'Jan', revenue: 4000 },
  { name: 'Fev', revenue: 5200 },
  { name: 'Mar', revenue: 4800 },
  { name: 'Abr', revenue: 7100 },
  { name: 'Mai', revenue: 9500 },
];

const StatCard = ({ title, value, sub, icon: Icon, color }: any) => (
  <div className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/5 p-6 rounded-[2rem] hover:border-[#ff0068]/30 transition-all relative overflow-hidden group">
    <div className={`absolute -right-8 -bottom-8 w-32 h-32 blur-[50px] opacity-10 rounded-full ${color}`} />
    <div className="flex justify-between items-start mb-4">
      <div className={`p-3 rounded-2xl ${color} text-white shadow-lg`}><Icon size={22} /></div>
      <span className="text-[10px] font-black text-[#e3ff0a] uppercase tracking-widest flex items-center gap-1 bg-[#e3ff0a]/10 px-2 py-1 rounded-full">
        {sub} <ArrowUpRight size={10} />
      </span>
    </div>
    <h3 className="text-slate-500 text-[10px] font-black uppercase tracking-[0.2em]">{title}</h3>
    <div className="text-3xl font-black text-slate-900 dark:text-white mt-1 tracking-tighter">{value}</div>
  </div>
);

const SuperAdminDashboard = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalGmv: 0, totalRevenue: 0, activeEvents: 0, totalUsers: 0 });

  useEffect(() => {
    const fetchData = async () => {
      const { data: eventsData } = await supabase.from('events').select('*, profiles:created_by(full_name)');
      const { count: usersCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
      const { data: regsData } = await supabase.from('registrations').select('id');

      const gmv = (regsData?.length || 0) * 120;
      setStats({
        totalGmv: gmv,
        totalRevenue: gmv * 0.1,
        activeEvents: eventsData?.length || 0,
        totalUsers: usersCount || 0
      });
      setEvents(eventsData || []);
    };
    fetchData();
  }, []);

  return (
    <div className="space-y-10 pb-20 animate-in fade-in duration-700">
      <header className="flex justify-between items-center border-b border-slate-200 dark:border-white/5 pb-8">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-[#ff0068] rounded-[2rem] flex items-center justify-center shadow-2xl shadow-[#ff0068]/30">
            <Globe size={32} className="text-white" />
          </div>
          <div>
            <h1 className="text-4xl font-black tracking-tighter uppercase leading-none text-slate-900 dark:text-white">Command Center</h1>
            <p className="text-slate-500 font-black text-[10px] uppercase tracking-[0.4em] mt-2 flex items-center gap-2">
              <Activity size={12} className="text-[#e3ff0a]" /> Global System Monitoring Active
            </p>
          </div>
        </div>
        <div className="flex gap-4">
          <button className="px-6 py-3 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-3 hover:bg-slate-200 dark:hover:bg-white/10 transition-all text-slate-700 dark:text-white">
            <Settings size={18} /> Configurações
          </button>
          <div className="px-6 py-3 bg-[#ff0068]/10 border border-[#ff0068]/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[#ff0068] flex items-center gap-3">
            <ShieldAlert size={18} /> Nível Super Admin
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total GMV Global" value={`R$ ${stats.totalGmv.toLocaleString()}`} sub="+12.5%" icon={DollarSign} color="bg-[#ff0068]" />
        <StatCard title="Receita CoreoHub" value={`R$ ${stats.totalRevenue.toLocaleString()}`} sub="SaaS Fee" icon={CreditCard} color="bg-[#ff0068]" />
        <StatCard title="Eventos Ativos" value={stats.activeEvents} sub="Growth" icon={Layers} color="bg-cyan-500" />
        <StatCard title="Total Usuários" value={stats.totalUsers} sub="Base" icon={Users} color="bg-[#e3ff0a]" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 p-8 rounded-[3.5rem]">
          <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2 mb-10 text-slate-900 dark:text-white">
            <BarChart3 className="text-[#ff0068]" /> Fluxo de Receita
          </h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={growthData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF0068" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#FF0068" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#475569', fontSize: 10, fontWeight: 900 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#475569', fontSize: 10, fontWeight: 900 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '16px', color: '#fff' }} />
                <Area type="monotone" dataKey="revenue" stroke="#FF0068" fill="url(#colorRevenue)" strokeWidth={4} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-white/5 p-8 rounded-[3.5rem] flex flex-col justify-between">
          <div className="space-y-8">
            <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2 text-slate-900 dark:text-white">
              <HardDrive className="text-cyan-500" /> Infraestrutura Cloud
            </h2>
            <div className="space-y-6">
              <div className="p-5 bg-slate-200/60 dark:bg-black/40 rounded-3xl border border-slate-300 dark:border-white/5">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] font-black uppercase text-slate-500">Storage (Trilhas)</span>
                  <span className="text-cyan-500 font-black">78.4 GB</span>
                </div>
                <div className="w-full h-2 bg-slate-300 dark:bg-white/5 rounded-full overflow-hidden">
                  <div className="w-[78%] h-full bg-cyan-500 shadow-[0_0_10px_#06b6d4]" />
                </div>
              </div>
              <div className="p-5 bg-slate-200/60 dark:bg-black/40 rounded-3xl border border-slate-300 dark:border-white/5">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[10px] font-black uppercase text-slate-500">API Health</span>
                  <span className="text-[#e3ff0a] font-black">92%</span>
                </div>
                <div className="w-full h-2 bg-slate-300 dark:bg-white/5 rounded-full overflow-hidden">
                  <div className="w-[92%] h-full bg-[#e3ff0a] shadow-[0_0_10px_#e3ff0a]" />
                </div>
              </div>
            </div>
          </div>
          <button className="w-full py-5 bg-[#ff0068] text-white rounded-2xl font-black text-[11px] uppercase tracking-[0.3em] flex items-center justify-center gap-4 hover:bg-[#cc0055] transition-all shadow-xl shadow-[#ff0068]/20">
            <RefreshCw size={16} /> Otimizar Banco
          </button>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminDashboard;
