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
