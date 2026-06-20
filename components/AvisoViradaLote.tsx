import React from 'react';
import { formatDataBRComDia } from '../utils/lotes';

interface AvisoViradaLoteProps {
  preco: number;
  dataVirada: string;
  dias: number;
  formatPreco: (n: number) => string;
}

// Texto "Sobe pra R$X em [data]" — duplicado em vitrine de ingressos/inscrições
// + card de workshop + detalhe do workshop. O wrapper (tamanho/cor) varia por
// contexto, então o caller decide o <p>; este componente só resolve o texto.
const AvisoViradaLote: React.FC<AvisoViradaLoteProps> = ({ preco, dataVirada, dias, formatPreco }) => (
  <>
    {dias < 1
      ? <>Sobe pra {formatPreco(preco)} amanhã</>
      : <>Sobe pra {formatPreco(preco)} em {formatDataBRComDia(dataVirada)}</>}
  </>
);

export default AvisoViradaLote;
