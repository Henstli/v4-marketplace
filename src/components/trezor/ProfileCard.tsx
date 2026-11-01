// DS Trezor › ProfileCard: profil jako sběratelská karta (kolo 1).
// Čistá prezentace bez dat ze serveru, jde použít na stránce profilu i v okně po kliku na jméno.
import type { Plan } from '@/lib/plans';
import { bannerRect, circleRect, cropStyle, type Presence, type ProfileCardData, type ProfilePhoto } from '@/lib/profile-card';
import { initials } from './Shop';

const PRESENCE_LABEL: Record<Presence, string> = { online: 'Online', offline: 'Offline', dnd: 'Nerušit' };

export function PresenceDot({ presence }: { presence: Presence }) {
  return <i className={`tz-presence tz-presence-${presence}`} role="img" aria-label={PRESENCE_LABEL[presence]} title={PRESENCE_LABEL[presence]} />;
}

export function TierLabel({ plan }: { plan: Plan }) {
  if (plan === 'free') return null;
  return <span className={`tz-tierlabel tz-tierlabel-${plan}`}>{plan.toUpperCase()}</span>;
}

export function TypeLine({ lead, style, city, frame }: { lead: string; style: string | null; city: string | null; frame: string }) {
  return (
    <span className={`tz-typeline tz-typeline-${frame}`}>
      <span className="tz-typeline-text">
        {lead}
        {style ? <><span className="tz-typeline-dash" aria-hidden="true">—</span>{style}</> : null}
      </span>
      {city ? <span className="tz-typeline-city">{city}</span> : null}
    </span>
  );
}

/** Odznak věrnosti, size = čtverec kolem mince v px (mince má asi dvě třetiny, křídla vyšších úrovní přesahují) */
export function LoyaltyBadge({ level, name, label, size = 34 }: { level: string; name: string; label?: string; size?: number }) {
  const title = `Odznak věrnosti: ${name}${label ? ` (${label} s Plus nebo Pro)` : ''}`;
  return (
    <span className="tz-loyalty" style={{ ['--lb' as string]: `${size}px` }} title={title}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/odznaky/${level}.svg`} alt={title} width={Math.round(size * 1.2667)} height={Math.round(size * 1.2667)} decoding="async" />
    </span>
  );
}

/** Kulatá profilovka z výřezu fotky (DS Trezor › ProfileCard › Profilovka), jinak iniciály */
export function ProfileAvatar({ name, photo, size = 40 }: { name: string; photo: ProfilePhoto | null; size?: number }) {
  return (
    <span className="tz-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo ? <img className="tz-crop" src={photo.src} alt="" style={cropStyle(circleRect(photo.crop))} /> : initials(name)}
    </span>
  );
}

function pct(v: number | null) {
  return v == null ? '–' : `${Number.isInteger(v) ? v : v.toFixed(1).replace('.', ',')} %`;
}

export function ProfileCard({ data, headingLevel = 2 }: { data: ProfileCardData; headingLevel?: 1 | 2 | 3 }) {
  const H = `h${headingLevel}` as 'h1' | 'h2' | 'h3';
  const no = data.memberNo != null ? String(data.memberNo).padStart(4, '0') : null;
  return (
    <article className="tz-pcard" aria-label={`Karta profilu ${data.name}`}>
      <div className="tz-pcard-in">
        <header className="tz-pcard-head">
          <div className="tz-pcard-who">
            <div className="tz-pcard-namerow">
              <H className="tz-pcard-name" style={{ margin: 0 }}>{data.name}</H>
              <PresenceDot presence={data.presence} />
            </div>
            {data.status ? <span className="tz-pcard-status">{data.status}</span> : null}
          </div>
          <span className="tz-pcard-tier"><TierLabel plan={data.plan} /></span>
        </header>
        <div className="tz-pcard-art">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {data.photo ? <img className="tz-crop" src={data.photo.src} alt="" style={cropStyle(bannerRect(data.photo.crop))} />
            : data.avatar ? <img src={data.avatar} alt="" />
            : <span className="tz-pcard-initials" aria-hidden="true">{initials(data.name)}</span>}
        </div>
        <div className="tz-pcard-type"><TypeLine lead={data.typeLead} style={data.typeStyle} city={data.city} frame={data.frame} /></div>
        <div className="tz-pcard-text">
          {data.about ? <p>{data.about}</p> : <p className="tz-pcard-empty">Zatím bez popisu.</p>}
        </div>
        <div className="tz-pcard-badges" aria-label="Odznaky">
          {data.loyalty ? <LoyaltyBadge level={data.loyalty.id} name={data.loyalty.name} label={data.loyalty.label} size={34} /> : null}
        </div>
        <div className="tz-pcard-stats">
          <div className="tz-pcard-stat"><span>Hodnocení</span><b data-good={data.rating != null ? '' : undefined}>{pct(data.rating)}</b></div>
          <div className="tz-pcard-stat"><span>Recenze</span><b>{data.reviews.toLocaleString('cs-CZ')}</b></div>
          <div className="tz-pcard-stat"><span>V nabídce</span><b>{data.listings.toLocaleString('cs-CZ')}</b></div>
        </div>
        <footer className="tz-pcard-foot">
          <span>V4cards</span>
          {no ? <span>{no} / {data.memberYear ?? ''}</span> : null}
        </footer>
      </div>
    </article>
  );
}
