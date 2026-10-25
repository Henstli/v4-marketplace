import { ButtonLink } from '@/components/trezor';

export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div className="container section">
      <div className="panel" style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <p className="t-label muted">PŘIPRAVUJEME</p>
        <h1 className="t-heading-l">{title}</h1>
        <p className="muted">{text}</p>
        <div><ButtonLink href="/karty" variant="secondary">Zpět na karty</ButtonLink></div>
      </div>
    </div>
  );
}
