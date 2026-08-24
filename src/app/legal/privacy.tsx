import { LegalScreen } from '@/components/legal-screen';
import { PRIVACY_SECTIONS } from '@/lib/legal-content';

export default function PrivacyScreen() {
  return <LegalScreen title="Privacy Policy" sections={PRIVACY_SECTIONS} />;
}
