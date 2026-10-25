import { csvLine, TEMPLATE_HEADER } from '@/lib/import/rows';

// Šablona pro hromadné nahrávání: hlavička a dva vzorové řádky. Středník a BOM, ať ji český Excel otevře správně.
export function GET() {
  const lines = [
    csvLine(TEMPLATE_HEADER),
    csvLine(['Pokémon', 'Charizard ex', 'OBF', 'Obsidian Flames', '125/197', 'NM', 'Angličtina', 1250, 2, '', '']),
    csvLine(['Magic: The Gathering', 'Lightning Bolt', 'M10', 'Magic 2010', '146', 'EX', 'Angličtina', 45, 4, '', 'Foil']),
  ];
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="v4cards-sablona.csv"',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
