/**
 * Rota /u/:code — redireciona pro evento associado ao short code (Fase 5).
 *
 * Look-up rápido em event_short_codes, depois navigate replace pra /evento/<slug>.
 * Se code não existir, redireciona pra /festivais (lista de festivais) em vez
 * de 404 pra suavizar UX de quem digitou errado.
 */

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { resolveShortCode } from '../services/eventShortCode';

export default function ShortCodeRedirect() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (!code) {
      navigate('/festivais', { replace: true });
      return;
    }
    (async () => {
      const resolved = await resolveShortCode(code.toLowerCase());
      if (resolved?.slug) {
        navigate(`/evento/${resolved.slug}`, { replace: true });
      } else if (resolved?.event_id) {
        navigate(`/evento/${resolved.event_id}`, { replace: true });
      } else {
        navigate('/festivais', { replace: true });
      }
    })();
  }, [code, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505]">
      <Loader2 size={32} className="animate-spin text-[#ff0068]" />
    </div>
  );
}
