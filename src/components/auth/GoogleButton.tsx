import Link from 'next/link';
import { signInWithGoogle } from '@/app/prihlaseni/actions';
import styles from './auth.module.css';

/** Přihlášení / registrace přes Google. Zobrazí se jen, když je Google v Supabase zapnutý. */
export function GoogleButton({ next, label = 'Pokračovat přes Google' }: { next: string; label?: string }) {
  return (
    <>
      <form action={signInWithGoogle}>
        <input type="hidden" name="dalsi" value={next} />
        <button type="submit" className={`tz-btn tz-btn-secondary tz-btn-lg ${styles.full}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 3.7 14.55 2.8 12 2.8 6.92 2.8 2.8 6.92 2.8 12s4.12 9.2 9.2 9.2c5.31 0 8.83-3.73 8.83-8.99 0-.6-.07-1.06-.15-1.51z" />
          </svg>
          {label}
        </button>
      </form>
      {/* U Googlu se účet založí rovnou, souhlas proto uvádíme tady (u e-mailu je to zaškrtávací políčko). */}
      <p className="t-small muted">
        Pokračováním přes Google souhlasíte s{' '}
        <Link href="/obchodni-podminky" target="_blank">obchodními podmínkami</Link> a berete na vědomí{' '}
        <Link href="/ochrana-osobnich-udaju" target="_blank">zásady ochrany osobních údajů</Link>.
      </p>
      <div className={`t-small ${styles.divider}`}>nebo e-mailem</div>
    </>
  );
}
