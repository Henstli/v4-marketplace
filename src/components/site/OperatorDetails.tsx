import { OPERATOR } from '@/lib/operator';

function Field({ value, missing }: { value: string; missing: string }) {
  return value ? <>{value}</> : <strong>[DOPLNIT: {missing}]</strong>;
}

/** Identifikace provozovatele. Prázdné údaje z OPERATOR se zobrazí jako výrazný zástupný text. */
export function OperatorDetails() {
  return (
    <>
      <Field value={OPERATOR.name} missing="jméno nebo název firmy" />, IČO <Field value={OPERATOR.ico} missing="IČO" />, se
      sídlem <Field value={OPERATOR.address} missing="adresa sídla" />, <Field value={OPERATOR.register} missing="zápis v rejstříku" />
    </>
  );
}
