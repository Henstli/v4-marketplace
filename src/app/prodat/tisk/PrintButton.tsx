'use client';

import { Button } from '@/components/trezor';

export function PrintButton() {
  return <Button onClick={() => window.print()}>Vytisknout</Button>;
}
