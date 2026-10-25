import { CardTile } from '@/components/trezor';
import { getGame } from '@/lib/games';
import type { CardSummary } from '@/lib/types';

export function CardSummaryTile({ card }: { card: CardSummary }) {
  const game = getGame(card.game);
  return (
    <CardTile
      href={`/karty/${card.slug}`}
      name={card.name}
      set={`${card.setName} · ${card.number}`}
      game={game?.label}
      color={`var(--game-${card.game}-art, var(--surface-sunken))`}
      image={card.image}
      price={card.minPrice ?? 0}
      trend={card.trend}
    />
  );
}
