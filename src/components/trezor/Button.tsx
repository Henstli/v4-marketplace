import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import Link from 'next/link';
import { cx } from './cx';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = hlavní akce (jedna na obrazovku), secondary = vedlejší, ghost = navigace */
  variant?: Variant;
  /** md = 44 px, lg = 52 px */
  size?: Size;
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} {...rest} className={cx('tz-btn', `tz-btn-${variant}`, `tz-btn-${size}`, className)} />;
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: Variant;
  size?: Size;
}

/** Odkaz, který vypadá jako tlačítko. */
export function ButtonLink({ variant = 'primary', size = 'md', className, href, ...rest }: ButtonLinkProps) {
  return <Link href={href} {...rest} className={cx('tz-btn', `tz-btn-${variant}`, `tz-btn-${size}`, className)} />;
}
