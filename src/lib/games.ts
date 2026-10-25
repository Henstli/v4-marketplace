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

// Pořadí podle priorit obchodního plánu: hokej první.
export const GAMES: Game[] = [
  { id: 'sport', name: 'Hokej a sport', label: 'HOKEJ', dot: 'var(--game-sport)', live: true },
  { id: 'pokemon', name: 'Pokémon', label: 'POKÉMON', dot: 'var(--game-pokemon)', live: true },
  { id: 'magic', name: 'Magic: The Gathering', label: 'MAGIC', dot: 'var(--game-magic)', live: true },
  { id: 'onepiece', name: 'One Piece', label: 'ONE PIECE', dot: 'var(--game-onepiece)', live: false },
  { id: 'lorcana', name: 'Lorcana', label: 'LORCANA', dot: 'var(--game-lorcana)', live: false },
  { id: 'riftbound', name: 'Riftbound', label: 'RIFTBOUND', dot: 'var(--game-riftbound)', live: false },
  { id: 'cyberpunk', name: 'Cyberpunk', label: 'CYBERPUNK', dot: 'var(--game-cyberpunk)', live: false },
];

export function getGame(id: string): Game | undefined {
  return GAMES.find((g) => g.id === id);
}
