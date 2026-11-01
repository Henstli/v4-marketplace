import { redirect } from 'next/navigation';

// Předplatné prodejců je v režimu podpory (menu účtu 1. 11.).
export default function Page() {
  redirect('/sprava/podpora/predplatne');
}
