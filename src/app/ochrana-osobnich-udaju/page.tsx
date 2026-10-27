import type { Metadata } from 'next';
import Link from 'next/link';
import { OperatorDetails } from '@/components/site/OperatorDetails';

export const metadata: Metadata = { title: 'Ochrana osobních údajů' };

// Pracovní verze pro betu. Před ostrým spuštěním ji má zkontrolovat právník a doplnit údaje provozovatele.
export default function PrivacyPage() {
  return (
    <div className="container section">
      <article className="panel" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h1 className="t-heading-l">Ochrana osobních údajů</h1>
        <p className="muted">Platí od 25. 10. 2026 · beta verze webu</p>

        <h2 className="t-heading-m">Kdo údaje zpracovává</h2>
        <p>
          Správcem osobních údajů je provozovatel webu V4cards: <OperatorDetails />. S dotazy k osobním údajům se obracejte přes stránku Účet nebo na e-mail <a href="mailto:podpora@v4cards.com">podpora@v4cards.com</a>.
        </p>

        <h2 className="t-heading-m">Jaké údaje a proč</h2>
        <ul style={{ paddingLeft: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <li>
            <strong>Účet:</strong> e-mail, přezdívka, heslo (ukládáme jen v zašifrované podobě) a případně nastavení
            dvoufázového ověření. Při přihlášení přes Google od Googlu dostaneme jméno a e-mail. Účel: založení a
            zabezpečení účtu (plnění smlouvy).
          </li>
          <li>
            <strong>Profil prodejce:</strong> jméno nebo název obchodu, typ prodejce a země. Zobrazují se u vašich
            nabídek. Účel: provoz marketplace (plnění smlouvy podle{' '}
            <Link href="/obchodni-podminky">obchodních podmínek</Link>).
          </li>
          <li>
            <strong>Nabídky, objednávky a hodnocení:</strong> co prodáváte a kupujete, ceny a stav objednávek. Účel:
            zprostředkování obchodu mezi kupujícím a prodejcem (plnění smlouvy) a vedení záznamů (právní povinnost).
          </li>
          <li>
            <strong>Návrhy karet:</strong> údaje o kartě a fotka, kterou nahrajete. Po schválení se fotka zobrazí v
            katalogu.
          </li>
          <li>
            <strong>Technické údaje:</strong> cookies nutné pro přihlášení a košík. Reklamní ani sledovací cookies
            nepoužíváme.
          </li>
        </ul>

        <h2 className="t-heading-m">Komu údaje předáváme</h2>
        <p>
          Údaje ukládáme u poskytovatele databáze Supabase (servery v Irsku, EU). Web běží na hostingu Vercel. Při
          přihlášení přes Google zpracovává údaje i Google. Kupujícímu a prodejci předáme údaje nutné k vyřízení
          objednávky: jméno a po potvrzení objednávky i e-mail, aby se mohli domluvit na platbě a předání. E-maily
          posíláme přes službu Resend. Údaje neprodáváme.
        </p>

        <h2 className="t-heading-m">Jak dlouho</h2>
        <p>
          Po dobu trvání účtu. Po jeho zrušení údaje smažeme, kromě záznamů o objednávkách, které musíme uchovávat podle
          zákona.
        </p>

        <h2 className="t-heading-m">Vaše práva</h2>
        <p>
          Máte právo na přístup ke svým údajům, jejich opravu, výmaz, omezení zpracování, přenositelnost a právo vznést
          námitku. Stížnost můžete podat u Úřadu pro ochranu osobních údajů (uoou.gov.cz).
        </p>
      </article>
    </div>
  );
}
