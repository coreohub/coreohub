/**
 * PersonCard — card reutilizável pra exibir jurados/professores na vitrine pública.
 *
 * Etapa 1.5 do backlog (workshops/certificados memory). Renderiza no nível
 * "Padrão": foto + nome + bio curta + chips de modalidades + ícones de redes.
 *
 * Suporta dedup: se a mesma pessoa é jurada E professora, recebe múltiplos
 * roles e exibe chip duplo "Jurada • Professora".
 */

import React, { useEffect } from 'react';
import { Instagram, Globe, Award, Music2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export type GenderRole = 'M' | 'F';

export interface Person {
  id: string;
  name: string;
  /** Gênero do jurado/professor pra flexionar role chip (Jurado/Jurada).
   *  Configurável pelo produtor em /equipe-jurados.
   *  Se null/undefined, fallback heurístico pelo nome. */
  gender?: GenderRole | null;
  bio_short?: string | null;
  bio_long?: string | null;
  photo_url?: string | null;
  instagram?: string | null;
  site_url?: string | null;
  modalidades?: string[];          // gêneros que avalia/ensina
  roles: Array<'judge' | 'teacher'>;  // role interno; label é flexionado por gênero no render
  /** Só relevante pro role 'judge'. tecnico = avalia por especialidade
   *  (default). artistico = olhar geral (impacto cênico/interpretação). */
  tipo_juri?: 'tecnico' | 'artistico' | null;
}

// Heurística pt-BR (fallback): nomes terminados em 'a' são femininos com poucas exceções.
const MALE_EXCEPTIONS = new Set([
  'joshua', 'noah', 'isaías', 'elias', 'tobias', 'luca', 'andrea',
]);
const FEMALE_EXCEPTIONS = new Set([
  'carmen', 'beatriz', 'inês', 'ines', 'ester', 'esther', 'isis', 'íris',
  'ruth', 'mercedes', 'lurdes', 'lourdes', 'judith', 'edith',
]);

function detectGenderFromName(name: string): GenderRole {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (MALE_EXCEPTIONS.has(first)) return 'M';
  if (FEMALE_EXCEPTIONS.has(first)) return 'F';
  return /[aã]$/i.test(first) ? 'F' : 'M';
}

/** Resolve o gênero efetivo: explícito do produtor → heurística pelo nome */
function resolveGender(person: Person): GenderRole {
  if (person.gender === 'M' || person.gender === 'F') {
    return person.gender;
  }
  return detectGenderFromName(person.name);
}

function roleLabel(role: 'judge' | 'teacher', gender: GenderRole): string {
  if (role === 'judge')   return gender === 'F' ? 'Jurada'    : 'Jurado';
  if (role === 'teacher') return gender === 'F' ? 'Professora' : 'Professor';
  return role;
}

interface PersonCardProps {
  person: Person;
  onClick?: () => void;
}

export const PersonCard: React.FC<PersonCardProps> = ({ person, onClick }) => {
  const initials = person.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase())
    .join('');

  const gender = resolveGender(person);

  const instagramHandle = person.instagram?.replace(/^@/, '').replace(/.*instagram\.com\//, '');
  const instagramUrl = instagramHandle ? `https://instagram.com/${instagramHandle}` : null;

  // <div role="button"> em vez de <button> porque temos <a>s aninhados
  // (Instagram/site) — HTML inválido ter <a> dentro de <button>.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className="group text-left bg-white/5 border border-white/10 rounded-2xl overflow-hidden hover:border-[#ff0068]/40 focus:border-[#ff0068]/60 focus:outline-none focus:ring-2 focus:ring-[#ff0068]/40 transition-colors cursor-pointer"
    >
      {/* Foto */}
      <div className="aspect-square bg-gradient-to-br from-[#ff0068]/20 to-purple-500/20 relative overflow-hidden">
        {person.photo_url ? (
          <img
            src={person.photo_url}
            alt={person.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl font-black text-white/40 tracking-tighter">{initials}</span>
          </div>
        )}
        {/* Overlay gradient pra legibilidade do nome em fotos claras */}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
      </div>

      <div className="p-4 space-y-2">
        {/* Nome + roles */}
        <div className="space-y-1">
          <h3 className="font-black uppercase tracking-tight text-white text-sm leading-tight line-clamp-2">
            {person.name}
          </h3>
          <div className="flex flex-wrap gap-1">
            {person.roles.includes('judge') && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#ff0068]/15 text-[#ff0068] text-[8px] font-black uppercase tracking-widest">
                <Award size={9} /> {roleLabel('judge', gender)}
              </span>
            )}
            {person.roles.includes('judge') && person.tipo_juri === 'artistico' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[8px] font-black uppercase tracking-widest">
                Artístico
              </span>
            )}
            {person.roles.includes('teacher') && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 text-[8px] font-black uppercase tracking-widest">
                <Music2 size={9} /> {roleLabel('teacher', gender)}
              </span>
            )}
          </div>
        </div>

        {/* Bio curta */}
        {person.bio_short && (
          <p className="text-[11px] text-slate-300 line-clamp-3 leading-snug">
            {person.bio_short}
          </p>
        )}

        {/* Chips de modalidades */}
        {person.modalidades && person.modalidades.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {person.modalidades.slice(0, 3).map(mod => (
              <span
                key={mod}
                className="px-1.5 py-0.5 bg-white/5 rounded text-[9px] font-bold text-slate-400 uppercase tracking-wider"
              >
                {mod}
              </span>
            ))}
            {person.modalidades.length > 3 && (
              <span className="px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                +{person.modalidades.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Redes sociais */}
        {(instagramUrl || person.site_url) && (
          <div className="flex items-center gap-2 pt-1 border-t border-white/5">
            {instagramUrl && (
              <a
                href={instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-slate-500 hover:text-[#ff0068] transition-colors"
                aria-label={`Instagram de ${person.name}`}
              >
                <Instagram size={14} />
              </a>
            )}
            {person.site_url && (
              <a
                href={person.site_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-slate-500 hover:text-[#ff0068] transition-colors"
                aria-label={`Site de ${person.name}`}
              >
                <Globe size={14} />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface PersonModalProps {
  person: Person | null;
  onClose: () => void;
}

export const PersonModal: React.FC<PersonModalProps> = ({ person, onClose }) => {
  const gender: GenderRole = person ? resolveGender(person) : 'M';
  // ESC fecha o modal + lock body scroll quando aberto
  useEffect(() => {
    if (!person) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [person, onClose]);

  return (
    <AnimatePresence>
      {person && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby="person-modal-name"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="bg-[#0b0b0f] border border-white/10 rounded-3xl max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            <div className="aspect-video bg-gradient-to-br from-[#ff0068]/20 to-purple-500/20 relative">
              {person.photo_url && (
                <img src={person.photo_url} alt={person.name} className="w-full h-full object-cover" />
              )}
              <button
                onClick={onClose}
                aria-label="Fechar"
                className="absolute top-3 right-3 p-2 bg-black/40 hover:bg-black/60 backdrop-blur rounded-full text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <h2 id="person-modal-name" className="text-2xl font-black uppercase tracking-tight text-white leading-tight">
                  {person.name}
                </h2>
                <div className="flex gap-1 mt-2">
                  {person.roles.includes('judge') && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#ff0068]/15 text-[#ff0068] text-[9px] font-black uppercase tracking-widest">
                      <Award size={10} /> {roleLabel('judge', gender)}
                    </span>
                  )}
                  {person.roles.includes('judge') && person.tipo_juri === 'artistico' && (
                    <span className="inline-flex items-center px-2 py-1 rounded bg-violet-500/15 text-violet-300 text-[9px] font-black uppercase tracking-widest">
                      Artístico
                    </span>
                  )}
                  {person.roles.includes('teacher') && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-500/15 text-purple-300 text-[9px] font-black uppercase tracking-widest">
                      <Music2 size={10} /> {roleLabel('teacher', gender)}
                    </span>
                  )}
                </div>
              </div>

              {(person.bio_long || person.bio_short) && (
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                  {person.bio_long || person.bio_short}
                </p>
              )}

              {person.modalidades && person.modalidades.length > 0 && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Modalidades</p>
                  <div className="flex flex-wrap gap-1.5">
                    {person.modalidades.map(mod => (
                      <span
                        key={mod}
                        className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs font-bold text-slate-300"
                      >
                        {mod}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(person.instagram || person.site_url) && (
                <div className="flex items-center gap-3 pt-2 border-t border-white/5">
                  {person.instagram && (
                    <a
                      href={`https://instagram.com/${person.instagram.replace(/^@/, '').replace(/.*instagram\.com\//, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-slate-300 transition-colors"
                    >
                      <Instagram size={14} /> @{person.instagram.replace(/^@/, '').replace(/.*instagram\.com\//, '')}
                    </a>
                  )}
                  {person.site_url && (
                    <a
                      href={person.site_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-slate-300 transition-colors"
                    >
                      <Globe size={14} /> Site
                    </a>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
