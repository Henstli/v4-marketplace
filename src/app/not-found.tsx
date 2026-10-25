import { ButtonLink } from '@/components/trezor';

export default function NotFound() {
  return (
    <div className="container section">
      <div className="panel" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h1 className="t-heading-l">Stránka nenalezena</h1>
        <p className="muted">Tahle adresa neexistuje. Kartu zkuste najít ve vyhledávání.</p>
        <div><ButtonLink href="/karty">Procházet karty</ButtonLink></div>
      </div>
    </div>
  );
}
