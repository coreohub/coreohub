
import React from 'react';
import { UserPlus, Shield, ShieldCheck, ShieldAlert, Mail, MoreHorizontal } from 'lucide-react';

const TeamManagement = () => {
  const team = [
    { id: '1', name: 'Ricardo Alencar', email: 'ricardo@coreohub.com', role: 'Proprietário', status: 'ativo' },
    { id: '2', name: 'Fernanda Lima', email: 'fernanda@coreohub.com', role: 'Editor', status: 'ativo' },
    { id: '3', name: 'Carlos Jota', email: 'carlos@eventos.com', role: 'Staff de Portaria', status: 'pendente' },
    { id: '4', name: 'Juliana Paes', email: 'ju@producao.com', role: 'Editor', status: 'ativo' },
  ];

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'Proprietário': return <ShieldCheck className="text-indigo-600" size={18} />;
      case 'Editor': return <Shield className="text-emerald-500" size={18} />;
      default: return <ShieldAlert className="text-slate-400" size={18} />;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gerenciamento de Equipe</h1>
          <p className="text-slate-500">Gerencie quem tem acesso ao painel do evento e suas permissões.</p>
        </div>
        <button className="bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all">
          <UserPlus size={20} /> Convidar Membro
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {team.map((member) => (
          <div key={member.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm group hover:border-indigo-200 transition-colors">
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-indigo-600 font-bold text-lg">
                {member.name.charAt(0)}
              </div>
              <button className="text-slate-300 hover:text-slate-600 p-1">
                <MoreHorizontal size={20} />
              </button>
            </div>
            
            <h3 className="font-bold text-slate-900">{member.name}</h3>
            <p className="text-xs text-slate-500 flex items-center gap-1.5 mb-4">
              <Mail size={12} /> {member.email}
            </p>

            <div className="flex items-center justify-between pt-4 border-t border-slate-50">
              <div className="flex items-center gap-2">
                {getRoleIcon(member.role)}
                <span className="text-sm font-semibold text-slate-700">{member.role}</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                member.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {member.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-indigo-50 border border-indigo-100 p-8 rounded-3xl">
        <div className="max-w-2xl">
          <h2 className="text-xl font-bold text-indigo-900 mb-2">Entenda as permissões</h2>
          <p className="text-indigo-700/80 mb-6 leading-relaxed">Cada papel tem limites específicos para garantir a segurança dos dados financeiros e configurações do evento.</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="bg-white/50 p-4 rounded-xl">
              <h4 className="font-bold text-indigo-900 text-sm mb-1">Proprietário</h4>
              <p className="text-xs text-indigo-700/70">Acesso total a tudo, inclusive financeiro e exclusão.</p>
            </div>
            <div className="bg-white/50 p-4 rounded-xl">
              <h4 className="font-bold text-indigo-900 text-sm mb-1">Editor</h4>
              <p className="text-xs text-indigo-700/70">Gerencia inscrições, cronograma e jurados.</p>
            </div>
            <div className="bg-white/50 p-4 rounded-xl">
              <h4 className="font-bold text-indigo-900 text-sm mb-1">Staff</h4>
              <p className="text-xs text-indigo-700/70">Apenas check-in e visualização de listas básicas.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeamManagement;
