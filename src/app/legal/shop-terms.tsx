import { LegalScreen } from '@/components/legal-screen';
import { SHOP_TERMS_SECTIONS } from '@/lib/legal-content';

export default function ShopTermsScreen() {
  return <LegalScreen title="Shop Terms & Shipping" sections={SHOP_TERMS_SECTIONS} />;
}
