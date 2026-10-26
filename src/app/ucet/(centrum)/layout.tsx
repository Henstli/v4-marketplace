import { AccountShell } from '@/components/account/AccountShell';

export default function AccountCenterLayout({ children }: { children: React.ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
