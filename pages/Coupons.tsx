
import React, { useState } from 'react';
import { Ticket, Plus, Trash2, Calendar, Users, Percent } from 'lucide-react';

const Coupons = () => {
  const [coupons, setCoupons] = useState([
    { id: '1', code: 'DANCEFIRST', discount: '20%', type: 'percentage', limit: 50, used: 12, expiry: '2024-12-31' },
    { id: '2', code: 'GROUPSAVE', discount: 'R$ 50', type: 'fixed', limit: 100, used: 45, expiry: '2024-10-15' },
    { id: '3', code: 'PREMIUM24', discount: '10%', type: 'percentage', limit: 10, used: 10, expiry: '2024-05-01' },
  ]);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cupons de Desconto</h1>
          <p className="text-slate-500">Crie códigos promocionais para incentivar inscrições antecipadas.</p>
        </div>
        <button className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-100">
          <Plus size={20} /> Novo Cupom
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center mb-4">
            <Ticket size={24} />
          </div>
          <h3 className="text-slate-500 text-sm font-medium">Cupons Ativos</h3>
          <p className="text-2xl font-bold">12</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="w-10 h-10 bg-green-50 text-green-600 rounded-lg flex items-center justify-center mb-4">
            <Users size={24} />
          </div>
          <h3 className="text-slate-500 text-sm font-medium">Total de Usos</h3>
          <p className="text-2xl font-bold">1,240</p>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center mb-4">
            <Percent size={24} />
          </div>
          <h3 className="text-slate-500 text-sm font-medium">Desconto Médio</h3>
          <p className="text-2xl font-bold">15%</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-400 text-xs font-bold uppercase tracking-wider">
              <th className="px-6 py-4">Código</th>
              <th className="px-6 py-4">Desconto</th>
              <th className="px-6 py-4">Uso / Limite</th>
              <th className="px-6 py-4">Expira em</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {coupons.map((coupon) => (
              <tr key={coupon.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4">
                  <span className="font-mono font-bold text-slate-900 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
                    {coupon.code}
                  </span>
                </td>
                <td className="px-6 py-4 font-bold text-indigo-600">{coupon.discount}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 max-w-[100px] h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-indigo-500" 
                        style={{ width: `${(coupon.used / coupon.limit) * 100}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium text-slate-600">{coupon.used}/{coupon.limit}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-600 flex items-center gap-2">
                  <Calendar size={14} className="text-slate-400" />
                  {new Date(coupon.expiry).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                    coupon.used >= coupon.limit ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {coupon.used >= coupon.limit ? 'Esgotado' : 'Ativo'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-slate-400 hover:text-rose-500 p-2 transition-colors">
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Coupons;
