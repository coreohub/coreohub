import React, { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'motion/react';

const Certificates = () => {
  const { id: eventId } = useParams();
  const [activeTab, setActiveTab] = useState<'design' | 'tags'>('design');
  const [activityType, setActivityType] = useState<'competitiva' | 'workshops' | 'participacao'>('competitiva');
  const [activeTags, setActiveTags] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('classic_premium');
  const constraintsRef = useRef<HTMLDivElement>(null);

  const addTagToCanvas = (tag: string) => {
    setActiveTags([...activeTags, { id: `${tag}-${Date.now()}`, tag, x: 0, y: 0, fontSize: 1.5 }]);
    setActiveTab('design');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white space-y-6 pb-32 p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-black tracking-tighter uppercase italic">Máquina de <span className="text-[#ff0068]">Certificados</span></h1>
      </div>

      <div className="flex bg-white dark:bg-white/5 p-1 rounded-2xl border border-slate-200 dark:border-white/10">
        {['competitiva', 'workshops', 'participacao'].map((type) => (
          <button key={type} onClick={() => setActivityType(type as any)} className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-[0.1em] transition-all ${activityType === type ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-lg' : 'text-slate-500'}`}>
            {type}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('design')} className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] transition-all ${activeTab === 'design' ? 'bg-[#ff0068] text-white' : 'bg-white dark:bg-white/5 text-slate-500'}`}>Design</button>
        <button onClick={() => setActiveTab('tags')} className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] transition-all ${activeTab === 'tags' ? 'bg-[#ff0068] text-white' : 'bg-white dark:bg-white/5 text-slate-500'}`}>Tags</button>
      </div>

      <div ref={constraintsRef} className="relative w-full aspect-[297/210] bg-white shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden">
        {activeTags.map((tag) => (
          <motion.div key={tag.id} drag dragConstraints={constraintsRef} className="absolute cursor-grab p-2 bg-blue-500/10 border border-dashed border-blue-500 rounded text-slate-900 font-serif font-bold" style={{ left: `${50 + tag.x}%`, top: `${tag.y}%`, fontSize: `${tag.fontSize}vw` }}>
            {tag.tag}
          </motion.div>
        ))}
      </div>

      {activeTab === 'tags' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {['{{NOME_PARTICIPANTE}}', '{{COREOGRAFIA}}', '{{ESTUDIO}}', '{{CLASSIFICACAO}}'].map(tag => (
            <button key={tag} onClick={() => addTagToCanvas(tag)} className="p-4 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:border-[#ff0068] transition-all">
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Certificates;
