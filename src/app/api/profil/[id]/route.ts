import { getProfileCard } from '@/lib/profile';

// Data karty profilu pro okno po kliku na jméno (ProfileLink). Jen veřejné údaje z profilu.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  const card = await getProfileCard(id);
  if (!card) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json(card, { headers: { 'Cache-Control': 'private, max-age=30' } });
}
