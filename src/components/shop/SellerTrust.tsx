import { formatDate } from '@/lib/format';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { createPublicClient } from '@/lib/supabase/public';
import styles from './trust.module.css';

/**
 * Počítadla a hodnocení na profilu prodejce (DS Reports › Hodnocení a počítadlo):
 * zrušené objednávky po Zaplaceno za 12 měsíců, spory bez dohody a posledních 10 hodnocení s odpovědí prodejce.
 */
export async function SellerTrust({ sellerId }: { sellerId: string }) {
  if (!isSupabaseConfigured()) return null;
  const supabase = createPublicClient();
  const [{ data: trust }, { data: reviews }] = await Promise.all([
    supabase.rpc('seller_trust', { p_seller: sellerId }),
    supabase.from('reviews').select('order_id, rating, comment, reply, created_at').eq('seller_id', sellerId).order('created_at', { ascending: false }).limit(10),
  ]);
  const t = ((trust ?? []) as Array<{ cancelled_after_paid: number; disputes: number }>)[0];
  const list = (reviews ?? []) as Array<{ order_id: string; rating: number; comment: string | null; reply: string | null; created_at: string }>;
  const { data: flags } = list.length ? await supabase.rpc('review_flags', { p_orders: list.map((r) => r.order_id) }) : { data: [] };
  const cancelled = new Set(((flags ?? []) as Array<{ order_id: string; cancelled_after_paid: boolean }>).filter((f) => f.cancelled_after_paid).map((f) => f.order_id));
  const shown = list.filter((r) => r.comment?.trim() || cancelled.has(r.order_id));

  return (
    <section className={styles.wrap} aria-label="Spolehlivost a hodnocení">
      {t ? (
        <>
          <div className={styles.tiles}>
            <div className={styles.tile} data-bad={t.cancelled_after_paid > 0 ? '' : undefined}>
              <span className={styles.tileLabel}>ZRUŠENO PO ZAPLACENÍ</span>
              <span className={styles.tileValue} data-zero={t.cancelled_after_paid === 0 ? '' : undefined}>{t.cancelled_after_paid}</span>
            </div>
            {t.disputes > 0 ? (
              <div className={styles.tile} data-bad="">
                <span className={styles.tileLabel}>SPORY BEZ DOHODY</span>
                <span className={styles.tileValue}>{t.disputes}</span>
              </div>
            ) : null}
          </div>
          <p className="t-small muted">Objednávky, které prodejce zrušil, i když kupující potvrdil platbu, a spory, které skončily bez dohody. Za posledních 12 měsíců.</p>
        </>
      ) : null}
      {shown.length ? (
        <div className={styles.reviews}>
          <h2 className="t-heading-m">Hodnocení</h2>
          {shown.map((r) => (
            <figure key={r.order_id} className={styles.review}>
              <div className={styles.reviewTop}>
                <span className={styles.stars} data-low={r.rating <= 2 ? '' : undefined} aria-label={`${r.rating} z 5`}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                {cancelled.has(r.order_id) ? <span className={styles.tag}>Zrušeno po zaplacení</span> : null}
              </div>
              {r.comment?.trim() ? <blockquote>{r.comment.trim()}</blockquote> : null}
              <figcaption className="t-small muted">{formatDate(r.created_at)}</figcaption>
              {r.reply ? <div className={styles.reply}><strong>Odpověď prodejce:</strong> {r.reply}</div> : null}
            </figure>
          ))}
        </div>
      ) : null}
    </section>
  );
}
