import { ShopRoute, shopMetadata, type ShopRouteProps } from '@/components/shop/shopRoute';

export const generateMetadata = shopMetadata;

export default function Page(props: ShopRouteProps) {
  return <ShopRoute {...props} kind="shop" />;
}
