import { redirect } from 'next/navigation';

type Props = { searchParams: Promise<{ h?: string; vse?: string }> };

/** Hlášení se přesunula do režimu podpory. */
export default async function OldReportsPage({ searchParams }: Props) {
  const q = new URLSearchParams((await searchParams) as Record<string, string>).toString();
  redirect(`/sprava/podpora/hlaseni${q ? `?${q}` : ''}`);
}
