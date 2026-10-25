import type { Metadata } from 'next';
import Link from 'next/link';
import { OperatorDetails } from '@/components/site/OperatorDetails';

export const metadata: Metadata = { title: 'Obchodní podmínky' };

const list = { paddingLeft: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } as const;

// Pracovní verze pro betu. Před ostrým spuštěním ji má zkontrolovat právník a doplnit údaje provozovatele (src/lib/operator.ts).
// Pravidla plateb a úschovy se doplní, až se zapnou skutečné platby.
export default function TermsPage() {
  return (
    <div className="container section">
      <article className="panel" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <h1 className="t-heading-l">Obchodní podmínky</h1>
        <p className="muted">Platí od 25. 10. 2026 · beta verze webu</p>

        <h2 className="t-heading-m">1. Kdo jsme a co upravují tyto podmínky</h2>
        <p>
          Web V4cards na adrese www.v4cards.com (dále „V4cards“ nebo „my“) provozuje <OperatorDetails />. Kontakt:{' '}
          <a href="mailto:podpora@v4cards.com">podpora@v4cards.com</a>.
        </p>
        <p>
          V4cards je online tržiště, na kterém si uživatelé navzájem prodávají a kupují sběratelské karty (sportovní karty
          a karetní hry jako Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece nebo Lorcana). Tyto podmínky upravují
          používání webu, uživatelský účet a pravidla pro prodej a nákup. Registrací s nimi souhlasíte.
        </p>
        <p>
          Web je ve <strong>zkušebním (beta) provozu</strong>. Některé funkce se mohou měnit nebo dočasně nefungovat.
          Zatím přes něj neprobíhají žádné platby (viz článek 8).
        </p>

        <h2 className="t-heading-m">2. Pojmy</h2>
        <ul style={list}>
          <li><strong>Uživatel</strong> je každý, kdo má na V4cards účet.</li>
          <li><strong>Prodejce</strong> je uživatel, který vystavil nabídku karty. Může jít o sběratele (soukromou osobu) nebo obchod (podnikatele).</li>
          <li><strong>Kupující</strong> je uživatel, který si kartu objednal.</li>
          <li><strong>Spotřebitel</strong> je člověk, který nakupuje mimo své podnikání.</li>
          <li><strong>Nabídka</strong> je konkrétní karta (nebo více kusů téže karty) vystavená prodejcem za uvedenou cenu.</li>
        </ul>

        <h2 className="t-heading-m">3. Role V4cards: jsme zprostředkovatel, ne prodávající</h2>
        <p>
          Kupní smlouvu uzavírá <strong>kupující přímo s prodejcem</strong>. V4cards není stranou této smlouvy, karty
          sami neprodáváme, nevlastníme je ani je neskladujeme. Za kartu, její popis, odeslání a vyřízení reklamace
          odpovídá prodejce. My provozujeme web, pomáháme s komunikací a při sporu se snažíme o férové řešení (článek 10).
        </p>
        <p>
          U každé nabídky uvádíme, zda je prodejce <strong>obchod</strong> (podnikatel), nebo <strong>sběratel</strong>{' '}
          (soukromá osoba). Údaj vychází z prohlášení prodejce. Pokud kupujete od sběratele, nevztahují se na nákup práva
          spotřebitele z unijního práva na ochranu spotřebitele, například právo odstoupit od smlouvy do 14 dnů.
        </p>

        <h2 className="t-heading-m">4. Uživatelský účet</h2>
        <ul style={list}>
          <li>Účet si může založit osoba starší 18 let. Mladší osoba jen se souhlasem zákonného zástupce.</li>
          <li>Každý může mít jen jeden účet. Údaje v účtu musí být pravdivé a aktuální.</li>
          <li>
            Přihlašovací údaje chraňte a nikomu je nesdělujte. Doporučujeme zapnout dvoufázové ověření. Za činnost na účtu
            odpovídá jeho držitel. Podezření na zneužití nám hned napište.
          </li>
          <li>Účet můžete kdykoli zrušit na stránce <Link href="/ucet">Účet</Link>. Rozpracované objednávky je potřeba nejdřív dokončit.</li>
        </ul>

        <h2 className="t-heading-m">5. Prodej karet</h2>
        <p>Prodejce vystavením nabídky prohlašuje a zavazuje se, že:</p>
        <ul style={list}>
          <li>kartu vlastní nebo s ní smí nakládat a má ji k dispozici k okamžitému odeslání;</li>
          <li>karta je pravá, není to padělek, kopie (proxy) ani neoznačená upravená karta;</li>
          <li>
            popis odpovídá skutečnosti: správná karta, edice, jazyk, varianta (např. foil), stav podle stupnice v článku 6
            a vlastní fotka, pokud ji přikládá;
          </li>
          <li>kartu po zaplacení odešle do 5 pracovních dnů, bezpečně zabalenou (obal, tuhá ochrana) a označí ji v objednávce jako odeslanou;</li>
          <li>při prodeji dodržuje právní předpisy, zejména daňové a spotřebitelské.</li>
        </ul>
        <p>
          <strong>Obchod</strong> (kdo karty prodává soustavně za účelem zisku) musí v profilu zvolit typ „obchod“ a
          uvést své identifikační údaje. Jako podnikatel vůči kupujícím-spotřebitelům plní povinnosti prodávajícího podle
          občanského zákoníku a zákona o ochraně spotřebitele, včetně práva na odstoupení od smlouvy a reklamace. Vydávání
          dokladů a odvod daní jsou věcí prodejce.
        </p>
        <p>
          Nové karty, které v katalogu chybí (např. hokejové), může prodejce navrhnout. Návrh před zveřejněním schvaluje
          správce a může ho upravit nebo zamítnout.
        </p>

        <h2 className="t-heading-m">6. Stav karet</h2>
        <p>Prodejce uvádí stav karty podle této stupnice:</p>
        <ul style={list}>
          <li><strong>MT (Mint):</strong> bezvadná karta, jako přímo z balíčku.</li>
          <li><strong>NM (Near Mint):</strong> téměř bezvadná, nanejvýš drobnost viditelná jen při pečlivé prohlídce.</li>
          <li><strong>EX (Excellent):</strong> mírné opotřebení, např. drobně odřené rohy nebo hrany.</li>
          <li><strong>GD (Good):</strong> viditelné opotřebení, odřeniny a otlaky, karta je celistvá.</li>
          <li><strong>LP (Light Played):</strong> výrazné opotřebení hran, povrchu nebo lehké ohnutí.</li>
          <li><strong>PL (Played):</strong> silně poškozená karta (ohyby, trhlinky, skvrny).</li>
        </ul>
        <p>Když si prodejce stavem není jistý, má uvést horší stupeň.</p>

        <h2 className="t-heading-m">7. Nákup a objednávka</h2>
        <ul style={list}>
          <li>Do košíku můžete vložit karty od více prodejců. Za každého prodejce vznikne samostatná objednávka.</li>
          <li>
            Před odesláním objednávky vidíte cenu karet, poštovné a celkovou částku. Ceny uvádí prodejce v korunách a jsou
            konečné; pokud je prodejce plátce DPH, obsahují DPH.
          </li>
          <li>
            Odesláním objednávky vzniká kupní smlouva mezi vámi a prodejcem. Objednávka prochází stavy zaplaceno →
            odesláno → doručeno. Po převzetí zásilky označte objednávku jako doručenou.
          </li>
          <li>Po dokončení objednávky můžete prodejce ohodnotit.</li>
        </ul>

        <h2 className="t-heading-m">8. Platby a poplatky</h2>
        <p>
          V beta verzi se <strong>neprovádějí žádné platby</strong>. Objednávky jsou zkušební a nic se za ně neplatí.
          Pravidla plateb, úschovy peněz do doručení a poplatků prodejců doplníme do těchto podmínek před spuštěním plateb.
          O změně vás předem upozorníme (článek 15).
        </p>
        <p>Používání V4cards je v beta verzi pro kupující i prodejce zdarma.</p>

        <h2 className="t-heading-m">9. Odstoupení od smlouvy</h2>
        <p>
          Kupujete-li jako spotřebitel od <strong>obchodu</strong>, můžete od smlouvy odstoupit bez udání důvodu do 14 dnů
          od převzetí karty. Odstoupení oznamte prodejci (zprávou nebo e-mailem), kartu mu do 14 dnů vraťte ve stavu, v
          jakém jste ji obdrželi, a prodejce vám do 14 dnů od odstoupení vrátí zaplacenou cenu včetně nejlevnějšího
          nabízeného poštovného. Náklady na vrácení karty nesete vy. Obchod může mít vlastní, výhodnější pravidla
          vrácení.
        </p>
        <p>
          U nákupu od <strong>sběratele</strong> (soukromé osoby) zákonné právo odstoupit do 14 dnů nemáte. Vrácení je
          možné jen po dohodě s prodejcem nebo když karta neodpovídá popisu (článek 10).
        </p>

        <h2 className="t-heading-m">10. Karta neodpovídá popisu (reklamace)</h2>
        <ul style={list}>
          <li>
            Když karta nedorazí, je jiná, než jaká byla nabízena, je v horším stavu, než uvedl prodejce, nebo není pravá,
            napište co nejdřív prodejci a přiložte fotky. Doporučujeme kartu zkontrolovat hned po převzetí.
          </li>
          <li>
            Obchod odpovídá spotřebiteli za vady podle občanského zákoníku. U použitých karet může obchod lhůtu pro
            uplatnění vad zkrátit na 12 měsíců, pokud to uvede předem. Reklamaci musí vyřídit do 30 dnů.
          </li>
          <li>Sběratel odpovídá za to, že karta odpovídá popisu v nabídce, podle obecných pravidel občanského zákoníku.</li>
          <li>
            Nepodaří-li se s prodejcem dohodnout, napište nám na <a href="mailto:podpora@v4cards.com">podpora@v4cards.com</a>.
            Spor posoudíme podle podkladů obou stran a navrhneme řešení. O nárocích z kupní smlouvy ale s konečnou platností
            rozhoduje soud nebo orgán mimosoudního řešení (článek 14).
          </li>
        </ul>

        <h2 className="t-heading-m">11. Hodnocení</h2>
        <p>
          Hodnocení musí být pravdivé a týkat se konkrétní objednávky. Hodnotit může jen kupující, který objednávku
          dokončil. Nepovolené je hodnotit sám sebe, nabízet za hodnocení odměnu nebo hodnocením vydírat. Hodnocení, které
          tato pravidla porušuje nebo obsahuje urážky či osobní údaje, můžeme skrýt.
        </p>

        <h2 className="t-heading-m">12. Co je na V4cards zakázané a jak to nahlásit</h2>
        <p>Zakázáno je zejména:</p>
        <ul style={list}>
          <li>prodávat padělky, kopie (proxy) nebo kradené karty a záměrně zkreslovat stav karty;</li>
          <li>nabízet cokoli jiného než sběratelské karty;</li>
          <li>vytvářet falešné nabídky, objednávky nebo hodnocení a manipulovat s cenami;</li>
          <li>obtěžovat ostatní uživatele, vkládat nezákonný obsah nebo cizí díla bez oprávnění;</li>
          <li>narušovat chod webu, automaticky stahovat data nebo zneužívat cizí účty.</li>
        </ul>
        <p>
          Nezákonný nebo zakázaný obsah (nabídku, fotku, hodnocení, profil) nám může kdokoli nahlásit na{' '}
          <a href="mailto:podpora@v4cards.com">podpora@v4cards.com</a>. Uveďte odkaz, popis problému a proč je obsah podle
          vás nezákonný, a své jméno a e-mail. Hlášení posoudíme bez zbytečného odkladu a o výsledku vás informujeme. Tato
          adresa je zároveň naším kontaktním místem podle nařízení EU o digitálních službách, komunikujeme česky,
          slovensky a anglicky.
        </p>

        <h2 className="t-heading-m">13. Omezení a zrušení účtu</h2>
        <p>
          Při porušení těchto podmínek můžeme podle závažnosti skrýt nabídku nebo hodnocení, omezit funkce účtu, účet
          dočasně pozastavit nebo ho zrušit. Rozhodnutí vám vždy oznámíme e-mailem s odůvodněním. Obchodu, který používá
          V4cards k podnikání, oznámíme zrušení účtu nejméně 30 dní předem, ledaže jde o závažné nebo opakované porušení
          pravidel nebo nám to ukládá zákon.
        </p>
        <p>
          Proti rozhodnutí se můžete do 6 měsíců ohradit na <a href="mailto:podpora@v4cards.com">podpora@v4cards.com</a>.
          Stížnost posoudí jiný člověk, než který rozhodl, a odpovíme vám bez zbytečného odkladu.
        </p>

        <h2 className="t-heading-m">14. Řazení nabídek, odpovědnost a spory</h2>
        <p>
          Nabídky u karty řadíme podle ceny od nejnižší. Výsledky katalogu řadíme podle shody s hledáním a karty s obrázkem
          dáváme před karty bez obrázku. Za lepší umístění si zatím nikdo nemůže připlatit, pokud se to změní, nabídky
          zřetelně označíme.
        </p>
        <p>
          Snažíme se, aby web fungoval spolehlivě, ale v beta verzi nezaručujeme nepřetržitý provoz. Neodpovídáme za
          obsah nabídek, za plnění smluv mezi uživateli ani za škodu vzniklou výpadkem webu, s výjimkou škody způsobené
          úmyslně nebo z hrubé nedbalosti a případů, kdy odpovědnost nelze vyloučit zákonem.
        </p>
        <p>
          Spotřebitel může spor s obchodem nebo s námi řešit mimosoudně u České obchodní inspekce (
          <a href="https://adr.coi.cz" target="_blank" rel="noreferrer">adr.coi.cz</a>), spotřebitel ze Slovenska u
          Slovenské obchodní inspekce (<a href="https://www.soi.sk" target="_blank" rel="noreferrer">soi.sk</a>). Dozor nad
          dodržováním spotřebitelských předpisů vykonává Česká obchodní inspekce, nad digitálními službami Český
          telekomunikační úřad.
        </p>

        <h2 className="t-heading-m">15. Duševní vlastnictví a změny podmínek</h2>
        <p>
          Názvy her, karet a ochranné známky (např. Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece, Lorcana, NHL)
          patří jejich vlastníkům. V4cards s nimi není nijak spojený. Obrázky karet v katalogu slouží jen k jejich
          identifikaci. Nahráním fotky nám udělujete bezplatnou nevýhradní licenci zobrazovat ji na V4cards po dobu
          zveřejnění.
        </p>
        <p>
          Podmínky můžeme změnit, například při spuštění plateb nebo kvůli nové legislativě. Změnu oznámíme e-mailem a na
          webu nejméně 15 dní předem. Pokud se změnou nesouhlasíte, můžete účet do jejího účinku zrušit.
        </p>

        <h2 className="t-heading-m">16. Závěrečná ustanovení</h2>
        <p>
          Tyto podmínky se řídí českým právem, zejména občanským zákoníkem (č. 89/2012 Sb.). Spotřebitel z jiné země EU
          (např. ze Slovenska) tím neztrácí ochranu, kterou mu dávají předpisy jeho země. Pokud by některé ustanovení bylo
          neplatné, ostatní zůstávají v platnosti. Jak zpracováváme osobní údaje, popisují{' '}
          <Link href="/ochrana-osobnich-udaju">zásady ochrany osobních údajů</Link>.
        </p>
      </article>
    </div>
  );
}
