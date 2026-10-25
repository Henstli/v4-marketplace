import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '@/components/auth/auth.module.css';
import { ForgotForm } from './ForgotForm';

export const metadata: Metadata = { title: 'Zapomenuté heslo' };

export default function ForgotPasswordPage() {
  return (
    <div className="container section">
      <div className={`panel ${styles.wrap}`}>
        <div>
          <h1 className="t-heading-l">Zapomenuté heslo</h1>
          <p className="muted">Pošleme vám odkaz, přes který si nastavíte nové heslo.</p>
        </div>
        <ForgotForm />
        <p className="t-small muted"><Link href="/prihlaseni">Zpět na přihlášení</Link></p>
      </div>
    </div>
  );
}
