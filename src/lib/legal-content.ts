// Plain-language legal documents for S333XHUB.
// ⚠️ These are carefully written templates, not legal advice — have a
// lawyer review them before public launch. Update EFFECTIVE_DATE and
// GOVERNING_STATE when finalized.

export const APP_NAME = 'S333XHUB';
export const SUPPORT_EMAIL = 'southeasterngroup28@gmail.com';
export const EFFECTIVE_DATE = 'August 23, 2026';
export const GOVERNING_STATE = 'Florida';

export type LegalSection = { heading: string; body: string };

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: 'What this is',
    body: `${APP_NAME} is a private app run by one independent music artist ("the Artist", releasing as Mazze and S333XGOD). By creating an account you agree to these Terms and to our Privacy Policy. If you don't agree, don't use the app.`,
  },
  {
    heading: 'Who can use it',
    body: `You must be at least 17 years old to use ${APP_NAME}. By signing up you confirm you meet this requirement. Accounts are personal — don't share your login or use someone else's.`,
  },
  {
    heading: 'Your account',
    body: `Fan accounts are free. There are no subscriptions and never will be — some individual posts can be unlocked with a one-time purchase. You're responsible for what happens under your account. You can delete your account at any time in Settings, which permanently removes your data.`,
  },
  {
    heading: 'Purchases',
    body: `Unlocks are one-time purchases made through Apple's or Google's in-app purchase system, and they follow those stores' payment terms. An unlock gives you permanent personal access to that post inside the app — it is not a download, a license to redistribute, or ownership of the music. Refunds are handled by Apple or Google under their policies, not by us. If you reinstall the app or switch phones, use "Restore Purchases" to get your unlocks back at no charge.`,
  },
  {
    heading: 'The Artist’s content',
    body: `All music, photos, videos, and other content the Artist posts belongs to the Artist. You get a personal, non-transferable right to stream and view it inside the app. Recording, ripping, screenshotting to redistribute, re-uploading, or selling any of it is prohibited and may end your account.`,
  },
  {
    heading: 'Your content and behavior',
    body: `You can post messages in chat. You keep ownership of what you write, and you give us permission to display it inside the app. Don't post anything illegal, hateful, harassing, threatening, sexually explicit involving minors, spammy, or that infringes someone else's rights. Don't impersonate others. We filter objectionable language automatically.`,
  },
  {
    heading: 'Moderation',
    body: `You can report any post, message, or user, and block any user (blocking hides their messages from you). Reports are reviewed and acted on within 24 hours. The Artist and app operators may remove any content or suspend or terminate any account that breaks these rules, at their discretion.`,
  },
  {
    heading: 'Apple-specific terms',
    body: `If you use ${APP_NAME} on an Apple device: these Terms are between you and us, not Apple. Apple has no obligation to provide support or maintenance for the app, is not responsible for any product claims, third-party intellectual-property claims, or legal compliance relating to the app, and is a third-party beneficiary of these Terms with the right to enforce them. Where these Terms are silent, Apple's standard Licensed Application End User License Agreement applies.`,
  },
  {
    heading: 'No guarantees',
    body: `The app is provided "as is". We work to keep it available and bug-free but can't promise uninterrupted service. To the maximum extent the law allows, our total liability to you is limited to the amount you've paid in the app in the past 12 months.`,
  },
  {
    heading: 'Changes and contact',
    body: `We may update these Terms; meaningful changes will be announced in the app, and continuing to use it means you accept them. These Terms are governed by the laws of ${GOVERNING_STATE}, USA. Questions: ${SUPPORT_EMAIL}.`,
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: 'What we collect',
    body: `When you sign up: your email address and the display name you choose. When you use the app: the messages you send, your notification preferences, your block list, any reports you file, and a record of posts you've unlocked. If you allow notifications on the real app: a device push token. That's it — no contacts, no location, no tracking across other apps.`,
  },
  {
    heading: 'How we use it',
    body: `To run the app: showing your name on your messages, delivering chat, remembering your unlocks, sending only the notifications you've left enabled, and handling reports and blocks. We don't sell your data, and there is no advertising in the app.`,
  },
  {
    heading: 'Where it lives',
    body: `Your data is stored with Supabase (our database and file-storage provider) on servers in the United States. Purchases are processed by Apple or Google and our payment partner RevenueCat — we never see your card details. These providers process data on our behalf under their own security commitments.`,
  },
  {
    heading: 'Who can see what',
    body: `Your display name and messages are visible to other members in the chats you're in. Your email is never shown to other users. The Artist can see reported content in order to moderate. We share data with no one else, except if the law requires it.`,
  },
  {
    heading: 'How long we keep it',
    body: `As long as your account exists. Deleted messages are hidden immediately and purged in routine cleanups. When you delete your account, your profile, messages, preferences, and purchase records are permanently removed.`,
  },
  {
    heading: 'Deleting your account',
    body: `In the app: Settings → Delete my account. Without the app: email ${SUPPORT_EMAIL} from your account's email address, or use our account-deletion web page, and we'll delete your account within 30 days.`,
  },
  {
    heading: 'Children',
    body: `${APP_NAME} is for users 17 and older and is not directed at children. If we learn an account belongs to someone under 17 we will delete it.`,
  },
  {
    heading: 'Changes and contact',
    body: `If this policy changes in a meaningful way, we'll announce it in the app. Questions or requests about your data: ${SUPPORT_EMAIL}.`,
  },
];
