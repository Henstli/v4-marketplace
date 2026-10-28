import { redirect } from 'next/navigation';

/** Záznam akcí je karta v Týmu (DS Support › Tým). */
export default function AuditLogPage() {
  redirect('/sprava/podpora/tym?karta=zaznam');
}
