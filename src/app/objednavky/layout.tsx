import { AccountShell } from '@/components/account/AccountShell';

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
