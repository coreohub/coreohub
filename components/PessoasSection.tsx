/**
 * PessoasSection — agrupa Jurados + Professores numa seção única "Jurados".
 *
 * Etapa 1.5: termo "Jurados" reflete realidade do mercado de dança BR (festivais
 * BR tipicamente trazem mesma pessoa pra julgar E dar workshop). Quando rolar
 * a feature de Workshops (Etapa 1), recebemos `teachers` populados e o dedup
 * mescla automaticamente.
 *
 * Hoje: só Jurados (workshops ainda não implementados).
 */

import React, { useMemo, useState } from 'react';
import { Award } from 'lucide-react';
import { PersonCard, PersonModal, type Person } from './PersonCard';

export interface JudgePublic {
  id: string;
  name: string;
  /** 'M' | 'F' | null — produtor define em /equipe-jurados.
   *  null = fallback heurístico pelo nome. */
  gender?: 'M' | 'F' | null;
  mini_bio?: string | null;
  avatar_url?: string | null;
  instagram?: string | null;
  competencias_generos?: string[] | null;
  competencias_formatos?: string[] | null;
}

export interface WorkshopTeacherPublic {
  id: string;
  professor_name: string;
  professor_bio?: string | null;
  professor_photo_url?: string | null;
  professor_instagram?: string | null;
  modalidade?: string | null;
}

interface PessoasSectionProps {
  judges?: JudgePublic[];
  teachers?: WorkshopTeacherPublic[];
}

/** Normaliza string pra match (lowercase + sem acentos + sem espaços extras) */
function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza handle do Instagram (remove @, URLs) */
function normalizeInstagram(s?: string | null): string {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/.*instagram\.com\//, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '')
    .trim();
}

export const PessoasSection: React.FC<PessoasSectionProps> = ({ judges = [], teachers = [] }) => {
  const [selected, setSelected] = useState<Person | null>(null);

  const people = useMemo<Person[]>(() => {
    // Mapa por chave de match (instagram > nome)
    const map = new Map<string, Person>();

    // 1) Insere jurados
    for (const j of judges) {
      const igKey = normalizeInstagram(j.instagram);
      const nameKey = normalize(j.name);
      const key = igKey || nameKey;
      if (!key) continue;
      map.set(key, {
        id: j.id,
        name: j.name,
        gender: j.gender ?? null,
        bio_short: j.mini_bio,
        photo_url: j.avatar_url,
        instagram: j.instagram,
        modalidadesJulgamento: j.competencias_generos ?? [],
        roles: ['judge'],
      });
    }

    // 2) Mergeia professores: se já existe pelo igKey ou nameKey, adiciona role
    for (const t of teachers) {
      const igKey = normalizeInstagram(t.professor_instagram);
      const nameKey = normalize(t.professor_name);
      const key = igKey || nameKey;
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        if (!existing.roles.includes('teacher')) {
          existing.roles.push('teacher');
        }
        // Se professor tem bio mais rica que jurado, sobrescreve (tipicamente
        // workshop tem bio mais completa)
        if (t.professor_bio && (!existing.bio_short || t.professor_bio.length > (existing.bio_short?.length ?? 0))) {
          existing.bio_short = t.professor_bio;
        }
        if (t.professor_photo_url && !existing.photo_url) {
          existing.photo_url = t.professor_photo_url;
        }
        // Modalidade do workshop fica em campo PRÓPRIO — nunca mesclada com
        // modalidadesJulgamento. É texto livre do produtor (ex.: "Hip Hop"),
        // sem vínculo com a lista oficial de gêneros do festival, então não
        // pode parecer competência de banca (ver comentário no tipo Person).
        if (t.modalidade && !existing.modalidadesWorkshop?.includes(t.modalidade)) {
          existing.modalidadesWorkshop = [...(existing.modalidadesWorkshop ?? []), t.modalidade];
        }
      } else {
        map.set(key, {
          id: t.id,
          name: t.professor_name,
          gender: null,
          bio_short: t.professor_bio,
          photo_url: t.professor_photo_url,
          instagram: t.professor_instagram,
          modalidadesWorkshop: t.modalidade ? [t.modalidade] : [],
          roles: ['teacher'],
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [judges, teachers]);

  if (people.length === 0) return null;

  return (
    <div id="jurados" className="space-y-4 scroll-mt-20">
      <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
        <Award size={24} className="text-[#ff0068]" /> Jurados
      </h2>
      <p className="text-xs text-slate-400">
        {teachers.length > 0
          ? 'Profissionais que vão julgar a mostra e ministrar workshops.'
          : 'Profissionais que vão avaliar as apresentações.'}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {people.map(p => (
          <PersonCard key={p.id} person={p} onClick={() => setSelected(p)} />
        ))}
      </div>
      <PersonModal person={selected} onClose={() => setSelected(null)} />
    </div>
  );
};
