/** Místo pro Můj profil / Přihlásit, než prohlížeč zjistí přihlášení (stejná šířka, bez textu). */
export function HeaderAccountPlaceholder() {
  return (
    <span className="tz-acct-btn" aria-hidden="true" style={{ visibility: 'hidden' }}>
      <span className="tz-shop-logo" style={{ width: 32, height: 32 }} />
      <span className="tz-acct-label">Můj profil</span>
    </span>
  );
}
