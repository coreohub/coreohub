
import React, { useState, useEffect } from 'react';
import { X, User, Lock, Delete, ChevronRight, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { ActiveJudge } from '../types';

interface ShiftChangeProps {
  onJudgeSelect: (judge: ActiveJudge) => void;
  currentActiveId?: string;
}

const PinPad = ({ onComplete, onCancel, judgeName }: { onComplete: (pin: string) => void, onCancel: () => void, judgeName: string }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handlePress = (val: string) => {
    if (pin.length < 4) {
      const newPin = pin + val;
      setPin(newPin);
      if (newPin.length === 4) {
        onComplete(newPin);
      }
    }
  };

  const handleBackspace = () => setPin(pin.slice(0, -1));

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(false), 500);
      return () => clearTimeout(timer);
    }
  }, [error]);

  return (
    <div className="flex flex-col items-center animate-in zoom-in-95 duration-300">
      <div className="mb-10 text-center">
        <h3 className="text-xl font-black text-white uppercase tracking-tighter mb-2">Identificação Necessária</h3>
        <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Olá, {judgeName}. Insira seu PIN (DDMM)</p>
      </div>

      <div className={`flex gap-4 mb-12 ${error ? 'animate-bounce text-rose-500' : ''}`}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`w-5 h-5 rounded-full border-2 transition-all duration-300 ${pin.length > i ? 'bg-brand-magenta border-brand-magenta scale-125' : 'border-white/20 bg-transparent'}`} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 w-72">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
          <button 
            key={n} 
            onClick={() => handlePress(n.toString())}
            className="h-20 rounded-3xl bg-white/5 border border-white/10 text-2xl font-black text-white hover:bg-white/20 active:scale-90 transition-all"
          >
            {n}
          </button>
        ))}
        <button onClick={onCancel} className="h-20 flex items-center justify-center text-slate-500 hover:text-white transition-colors">
          <X size={24} />
        </button>
        <button 
          onClick={() => handlePress('0')}
          className="h-20 rounded-3xl bg-white/5 border border-white/10 text-2xl font-black text-white hover:bg-white/20 active:scale-90 transition-all"
        >
          0
        </button>
        <button onClick={handleBackspace} className="h-20 flex items-center justify-center text-slate-500 hover:text-rose-500 transition-colors">
          <Delete size={24} />
        </button>
      </div>
    </div>
  );
};

const ShiftChangeOverlay: React.FC<ShiftChangeProps> = ({ onJudgeSelect, currentActiveId }) => {
  const [selectedJudge, setSelectedJudge] = useState<ActiveJudge | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Mock de jurados do evento (viria via Supabase Realtime)
  const availableJudges: ActiveJudge[] = [
    { id: 'j1', name: 'Carlos Mendes', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Carlos', competencies: { styles: ['Jazz', 'Ballet'], formats: ['Mostra Competitiva'] } },
    { id: 'j2', name: 'Juliana Silveira', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Juliana', competencies: { styles: ['Contemporâneo'], formats: ['Mostra Competitiva'] } },
    { id: 'j3', name: 'Rodrigo Souza', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Rodrigo', competencies: { styles: ['Urbanas'], formats: ['Batalhas'] } }
  ];

  const handlePinComplete = async (pin: string) => {
    if (!selectedJudge) return;
    setLoading(true);
    
    // Simulação da chamada RPC 'validate_judge_pin'
    // Em produção: const { data: isValid } = await supabase.rpc('validate_judge_pin', { p_judge_id: selectedJudge.id, p_pin: pin });
    setTimeout(() => {
      if (pin === '1234') { // Mock PIN
        setStatus('success');
        setTimeout(() => onJudgeSelect(selectedJudge), 800);
      } else {
        setStatus('error');
        setLoading(false);
        setTimeout(() => setStatus('idle'), 2000);
      }
    }, 1000);
  };

  if (status === 'success') {
    return (
      <div className="fixed inset-0 bg-[#020617] z-[100] flex flex-col items-center justify-center text-center p-8">
        <div className="w-24 h-24 bg-brand-lime rounded-[2.5rem] flex items-center justify-center text-slate-900 shadow-[0_0_50px_#E3FF0A] animate-bounce">
          <CheckCircle2 size={48} />
        </div>
        <h2 className="text-3xl font-black text-white uppercase tracking-tighter mt-10">Acesso Autorizado</h2>
        <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-2">Sincronizando competências do jurado...</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#020617]/95 backdrop-blur-3xl z-[90] flex items-center justify-center p-8 animate-in fade-in duration-500">
      <div className="max-w-4xl w-full flex flex-col items-center">
        {!showPin ? (
          <div className="w-full space-y-12 text-center animate-in slide-in-from-bottom-8">
            <div className="space-y-4">
               <div className="w-20 h-20 bg-brand-magenta/10 rounded-[2rem] flex items-center justify-center text-brand-magenta mx-auto border border-brand-magenta/20">
                  <User size={40} />
               </div>
               <h1 className="text-4xl font-black text-white uppercase tracking-tighter">Troca de Turno</h1>
               <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.4em]">Selecione sua identidade na banca</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
               {availableJudges.map((judge) => (
                 <button 
                  key={judge.id}
                  onClick={() => { setSelectedJudge(judge); setShowPin(true); }}
                  className={`relative p-8 rounded-[3rem] border transition-all flex flex-col items-center group ${
                    currentActiveId === judge.id 
                    ? 'bg-brand-magenta border-brand-magenta text-white shadow-2xl' 
                    : 'bg-white/5 border-white/5 text-slate-400 hover:border-white/20 hover:bg-white/10'
                  }`}
                 >
                   <div className="w-20 h-20 rounded-[2rem] bg-slate-800 mb-4 overflow-hidden border-4 border-white/10 shadow-lg">
                      <img src={judge.avatar_url} alt={judge.name} />
                   </div>
                   <h3 className="font-black uppercase tracking-tight text-sm mb-1">{judge.name}</h3>
                   <span className="text-[8px] font-black uppercase tracking-widest opacity-50">Jurado {judge.id.toUpperCase()}</span>
                   
                   {currentActiveId === judge.id && (
                     <div className="absolute top-4 right-4 bg-white/20 p-1 rounded-full"><CheckCircle2 size={12}/></div>
                   )}
                 </button>
               ))}
            </div>
            
            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Somente jurados autorizados pelo produtor aparecem nesta lista.</p>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center">
            {loading ? (
              <div className="flex flex-col items-center gap-6 py-20">
                <RefreshCw size={48} className="text-brand-magenta animate-spin" />
                <p className="text-[10px] font-black text-white uppercase tracking-widest animate-pulse">Validando Credenciais...</p>
              </div>
            ) : (
              <PinPad 
                judgeName={selectedJudge?.name || ''} 
                onCancel={() => { setShowPin(false); setStatus('idle'); }} 
                onComplete={handlePinComplete}
              />
            )}
            
            {status === 'error' && (
              <div className="mt-8 flex items-center gap-3 text-rose-500 bg-rose-500/10 px-6 py-3 rounded-2xl border border-rose-500/20 animate-bounce">
                <AlertCircle size={18} />
                <span className="text-[10px] font-black uppercase tracking-widest">PIN Incorreto. Tente novamente (DDMM).</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ShiftChangeOverlay;
