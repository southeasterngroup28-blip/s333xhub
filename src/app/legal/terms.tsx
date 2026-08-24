import { LegalScreen } from '@/components/legal-screen';
import { TERMS_SECTIONS } from '@/lib/legal-content';

export default function TermsScreen() {
  return <LegalScreen title="Terms of Service" sections={TERMS_SECTIONS} />;
}
