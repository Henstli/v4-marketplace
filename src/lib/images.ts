// Malé náhledy obrázků karet pro místa, kde je karta jen pár desítek pixelů (našeptávač).
// Zdroje katalogu mají menší varianty na stejné adrese, stačí změnit její část.
export function thumbUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  if (url.startsWith('https://cards.scryfall.io/')) return url.replace('/normal/', '/small/').replace('/large/', '/small/');
  if (url.startsWith('https://assets.tcgdex.net/')) return url.replace(/\/high\.(webp|png|jpg)$/, '/low.$1');
  if (url.startsWith('https://images.pokemontcg.io/')) return url.replace(/_hires\.png$/, '.png');
  if (url.startsWith('https://cards.lorcast.io/')) return url.replace('/large/', '/normal/');
  if (url.startsWith('https://cmsassets.rgpub.io/')) return `${url}${url.includes('?') ? '&' : '?'}w=300`;
  return url;
}
