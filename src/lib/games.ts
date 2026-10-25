export type GameId = 'sport' | 'pokemon' | 'magic' | 'yugioh' | 'onepiece' | 'lorcana' | 'riftbound' | 'cyberpunk';

export interface Game {
  id: GameId;
  name: string;
  /** Popisek verzálkami do zástupné plochy karty */
  label: string;
  /** Token tečky kategorie z design systému */
  dot: string;
  /** Spuštěno v první verzi */
  live: boolean;
}

// Pořadí zleva doprava všude na webu (lišta v hlavičce, filtr v katalogu, kategorie na úvodní stránce).
export const GAMES: Game[] = [
  { id: 'pokemon', name: 'Pokémon', label: 'POKÉMON', dot: 'var(--game-pokemon)', live: true },
  { id: 'magic', name: 'Magic: The Gathering', label: 'MAGIC', dot: 'var(--game-magic)', live: true },
  { id: 'riftbound', name: 'Riftbound', label: 'RIFTBOUND', dot: 'var(--game-riftbound)', live: false },
  { id: 'lorcana', name: 'Lorcana', label: 'LORCANA', dot: 'var(--game-lorcana)', live: false },
  { id: 'onepiece', name: 'One Piece', label: 'ONE PIECE', dot: 'var(--game-onepiece)', live: false },
  { id: 'cyberpunk', name: 'Cyberpunk', label: 'CYBERPUNK', dot: 'var(--game-cyberpunk)', live: false },
  { id: 'sport', name: 'Sport', label: 'SPORT', dot: 'var(--game-sport)', live: true },
];

export function getGame(id: string): Game | undefined {
  return GAMES.find((g) => g.id === id);
}
