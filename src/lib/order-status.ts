// Popisy stavů objednávky pro kupujícího i prodejce.
export const ORDER_STATUS: Record<string, string> = {
  requested: 'Čeká na potvrzení prodejce',
  confirmed: 'Potvrzeno, domluvte platbu a předání',
  pending_payment: 'Čeká na platbu',
  paid: 'Zaplaceno, čeká na odeslání',
  shipped: 'Odesláno',
  delivered: 'Převzato',
  cancelled: 'Zrušeno',
  declined: 'Prodejce odmítl',
  expired: 'Vypršelo bez potvrzení',
};

/** Barva stavu (DS Status): čeká = warn, probíhá = info, převzato = ok, zrušeno = danger, vypršelo = muted. */
export const ORDER_TONE: Record<string, 'ok' | 'warn' | 'muted' | 'danger' | 'info'> = {
  requested: 'warn',
  pending_payment: 'warn',
  confirmed: 'info',
  paid: 'info',
  shipped: 'info',
  delivered: 'ok',
  cancelled: 'danger',
  declined: 'danger',
  expired: 'muted',
};

/** Krátké popisy do štítku v bublině objednávky ve zprávách (dlouhé se do bubliny nevejdou). */
export const ORDER_STATUS_SHORT: Record<string, string> = {
  requested: 'Čeká na potvrzení',
  confirmed: 'Potvrzeno',
  pending_payment: 'Čeká na platbu',
  paid: 'Zaplaceno',
  shipped: 'Odesláno',
  delivered: 'Převzato',
  cancelled: 'Zrušeno',
  declined: 'Odmítnuto',
  expired: 'Vypršelo',
};
