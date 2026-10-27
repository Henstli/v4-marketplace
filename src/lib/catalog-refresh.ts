import { revalidatePath, updateTag } from 'next/cache';
import { HOME_TAG } from '@/lib/catalog';

/** Po změně nabídek: detail karet, katalog i úvodní stránka (žebříček a počty) hned z čerstvých dat. Jen v server actions. */
export function refreshCatalog() {
  revalidatePath('/karty', 'layout');
  revalidatePath('/');
  updateTag(HOME_TAG);
}
