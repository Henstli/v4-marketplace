import { redirect } from 'next/navigation';

// Schvalování karet je v režimu podpory (menu účtu 1. 11.).
export default function Page() {
  redirect('/sprava/podpora/karty');
}
