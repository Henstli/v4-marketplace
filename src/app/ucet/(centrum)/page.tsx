import { redirect } from 'next/navigation';

// Přehled účtu byl zrušený (menu účtu 1. 11.): /ucet vede rovnou na Profil.
export default function AccountPage() {
  redirect('/ucet/vzhled');
}
