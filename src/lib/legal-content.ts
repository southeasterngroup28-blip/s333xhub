// Legal copy for S333XHUB. Source of truth for the in-app legal screens and
// the s333xgod site: node scripts/export-legal.mjs C:\dev\s333xgod.
// TODO before launch: one-hour lawyer read.

export const APP_NAME = 'S333XHUB';
export const SUPPORT_EMAIL = 'support@s333xhub.com';
export const EFFECTIVE_DATE = 'September 18, 2026';
export const GOVERNING_STATE = 'Florida';
export const OPERATOR_NAME = 'RONSO LLC';
export const OPERATOR_ADDRESS = '10437 NW 82nd St, Unit 12, Miami, FL 33178';

export type LegalSection = { heading: string; body: string };

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: 'What this is',
    body: `${APP_NAME} is operated by ${OPERATOR_NAME}, a ${GOVERNING_STATE} limited liability company ("RONSO", "we"), for the independent artist who releases music as Mazze and S333XGOD ("the Artist"). By creating an account you agree to these Terms and to our Privacy Policy. If you don't agree, don't use the app.`,
  },
  {
    heading: 'Who can use it',
    body: `You must be at least 17 years old to use ${APP_NAME}. By signing up you confirm you meet this requirement. Accounts are personal. Don't share your login or use someone else's.`,
  },
  {
    heading: 'Using the app',
    body: `We give you a personal, non-transferable license to install and use the app on Apple devices you own or control, for your own use. The app itself stays the property of RONSO.`,
  },
  {
    heading: 'Your account',
    body: `Fan accounts are free. There are no subscriptions. The only things that cost money are one-time post unlocks, show tickets, and pieces from S333XSHOP. You're responsible for what happens under your account. You can delete your account at any time in Settings. The Privacy Policy says what is removed and what is kept.`,
  },
  {
    heading: 'Post unlocks',
    body: `Unlocks are one-time purchases made through Apple's in-app purchase system and follow Apple's payment terms. An unlock gives you personal access to that post inside the app for as long as the app is available. It is not a download, a license to redistribute, or ownership of the music. Refunds for unlocks are handled by Apple under its policies, not by us. If you reinstall the app or switch phones, use "Restore purchases" in Settings to get your unlocks back at no charge.`,
  },
  {
    heading: 'Show tickets',
    body: `Some shows sell tickets inside the app. You pay through Stripe, not through the App Store, so this section applies instead of Apple's terms. Each purchase is one ticket. A ticket is tied to one show and one account, admits one person, and is a QR code under My Tickets that is scanned once at the door. A ticket that has already been scanned or refunded will be refused. Tickets cannot be transferred or resold. Your ticket shows the display name on your account at the time of purchase. Tickets are not refundable. The one exception is a show cancelled by the Artist or the venue. In that case the full price is refunded to the payment method you used, without you having to ask. If a show moves to a new date, your ticket is valid for the new date and is not refunded. If we cannot issue your ticket, for example because the last one sold while your payment was going through, no ticket is issued and your payment is refunded in full. Some shows link out to a venue's own box office. Those sales are the venue's and follow the venue's terms. Venue rules, including age limits, apply to entry.`,
  },
  {
    heading: 'S333XSHOP',
    body: `Numbered physical pieces from S333XSHOP are sold under the Shop Terms, which are part of these Terms.`,
  },
  {
    heading: "The Artist's content",
    body: `All music, photos, videos, and other content the Artist posts belongs to the Artist. You get a personal, non-transferable right to stream and view it inside the app. Recording, ripping, screenshotting to redistribute, re-uploading, or selling any of it is prohibited and may end your account.`,
  },
  {
    heading: 'Your content and behavior',
    body: `You can post messages, voice notes, photos and GIFs in chat, send the Artist direct messages, comment and vote on posts, set a profile photo and a background photo, and send fan mail (a photo, video or audio clip with a note, once a week). You own what you write, record and upload. You give RONSO and the Artist a license to store, show, send and moderate it inside the app and, for fan mail, to deliver it to the Artist. The license ends when the content is deleted, except for copies kept for moderation. Chat messages, comments and profile photos are shown inside the app to other members. Fan mail goes to the Artist privately and is not posted in the app. Don't post anything illegal, anything that harasses, threatens or demeans someone, anything sexually explicit, anything you don't have the right to share, or anything that pretends to be someone else. Content that sexualizes a minor closes the account and is reported to law enforcement. Spam is removed. Chat messages and comments pass through a word filter before they post.`,
  },
  {
    heading: 'Moderation',
    body: `You can report any post, comment, message, or user, and block any user (blocking hides their messages from you and stops direct messages between you). Reports are reviewed and acted on within 24 hours. RONSO and the Artist may remove or pin any content, and may suspend or terminate any account that breaks these rules, at their discretion.`,
  },
  {
    heading: 'Apple-specific terms',
    body: `If you use ${APP_NAME} on an Apple device: these Terms are between you and ${OPERATOR_NAME}, not Apple. Apple has no obligation to provide support or maintenance for the app, is not responsible for any product claims, third-party intellectual-property claims, or legal compliance relating to the app, and is a third-party beneficiary of these Terms with the right to enforce them. Where these Terms are silent, Apple's standard Licensed Application End User License Agreement applies.`,
  },
  {
    heading: 'No guarantees',
    body: `The app is provided "as is" and "as available", without any warranty, including implied warranties of merchantability, fitness for a purpose and non-infringement. We work to keep it available and bug-free but can't promise uninterrupted service. To the maximum extent the law allows, we are not liable for indirect or consequential loss, and our total liability to you is limited to the amount you've paid in the app, including for tickets and S333XSHOP pieces, in the past 12 months. Nothing here limits rights you have under applicable consumer law.`,
  },
  {
    heading: 'Changes and contact',
    body: `We may update these Terms; meaningful changes will be announced in the app, and continuing to use it means you accept them. These Terms are governed by the laws of ${GOVERNING_STATE}, USA. Questions: ${SUPPORT_EMAIL}, or by mail to ${OPERATOR_NAME}, ${OPERATOR_ADDRESS}.`,
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: 'Who we are',
    body: `This policy is issued by ${OPERATOR_NAME}, a ${GOVERNING_STATE} limited liability company ("we"), which operates ${APP_NAME} for the artist releasing as Mazze and S333XGOD ("the Artist").`,
  },
  {
    heading: 'What we collect',
    body: `Account: your email address, your password, the display name you choose, and a profile photo and a background photo if you add them. Using the app: messages, voice notes, photos and GIFs you send in chat, direct messages to the Artist, comments, reactions and poll votes, fan mail you send and the photo, video or audio attached to it, your notification settings, your block list, reports you file, and a record of posts you've unlocked. Tickets and pieces: your display name at the time of purchase, your shipping address for a piece, what you bought and its edition number, and Stripe's reference for the payment. We never receive your card number. Notifications: a device push token if you turn them on. Moderation: whether your account has been suspended. Crash reports: if the app crashes, we record the error, the app version and your device platform, with your account id, so we can fix it. GIF search, when available: the words you type in the GIF picker go to Tenor to return results. We do not collect your contacts or your location, and we do not track you across other apps.`,
  },
  {
    heading: 'How we use it',
    body: `To run the app: showing your name on your messages, delivering chat, remembering your unlocks, getting your ticket scanned and your piece shipped, sending only the notifications you've left enabled, and handling reports and blocks. We don't sell your data, and there is no advertising in the app.`,
  },
  {
    heading: 'Where it lives',
    body: `Accounts, messages, photos, orders and tickets are stored with Supabase on servers in the United States. Your password is stored in a form we cannot read. Post unlocks go through Apple's in-app purchase system; RevenueCat keeps the receipt record so unlocks can be restored. Shop orders and show tickets are paid through Stripe, which handles your card details and receives your name and email address for its customer record. We never see your card number. Push notifications are delivered through Expo's notification service. Fan mail reaches the Artist's inbox through Resend. GIF search, when available, runs through Tenor, a Google service. Each of these companies handles data only to provide its part of the service, not for its own use.`,
  },
  {
    heading: 'Who can see what',
    body: `Other fans see your display name, your profile photo if you set one, and the messages, voice notes, photos and comments you post in the chats and threads they are in. If the Artist puts you in the Top 3, your name and photo appear on the feed. If you buy a piece, your display name and edition number appear in that drop's registry, which every member can see. The Artist sees what fans send: the community chat, direct messages, fan mail, reports, and the name and address on any order, so it can be shipped. In a direct message the Artist can see when you last opened it, and you can see the same. Your email address is never shown to other fans. For a physical order we give your name and address to the shipping carrier. Beyond that we share nothing, unless the law requires it.`,
  },
  {
    heading: 'How long we keep it',
    body: `For as long as your account exists. A message or comment the Artist removes is hidden from the app but kept for moderation. When you delete your account in the app, your profile, profile photo, background photo, messages, comments, votes, notification preferences, block list, reports and unlock history are erased immediately. Photos and voice notes you sent in chat and the files attached to your fan mail are removed within 30 days. If you ask by email, everything is removed within 30 days. Three things stay: shop orders and show tickets (your name, shipping address, what you bought and what you paid) are kept for as long as tax and accounting law requires, up to seven years, with your account no longer attached to them; fan mail already sent to the Artist stays in the Artist's inbox; and crash reports are kept without your account id.`,
  },
  {
    heading: 'Deleting your account',
    body: `In the app, open Settings, scroll to the bottom, and tap Delete account. Confirm once and the account is gone. Without the app, email ${SUPPORT_EMAIL} from your account's email address, or use the account-deletion page on our site, and we'll delete your account within 30 days.`,
  },
  {
    heading: 'Children',
    body: `${APP_NAME} is for users 17 and older and is not directed at children. If we learn an account belongs to someone under 17 we will delete it.`,
  },
  {
    heading: 'Changes and contact',
    body: `If this policy changes in a meaningful way, we'll announce it in the app. Questions or requests about your data: ${SUPPORT_EMAIL}, or by mail to ${OPERATOR_NAME}, ${OPERATOR_ADDRESS}.`,
  },
];

export const SHOP_TERMS_SECTIONS: LegalSection[] = [
  {
    heading: 'Who you are buying from',
    body: `S333XSHOP is run by ${OPERATOR_NAME}, a ${GOVERNING_STATE} limited liability company, on behalf of the artist releasing as Mazze and S333XGOD (the Artist). Every order is a contract with ${OPERATOR_NAME}. "We" and "us" on this page means ${OPERATOR_NAME}. Pieces are made and numbered by the Artist and shipped by ${OPERATOR_NAME}.`,
  },
  {
    heading: 'What you are buying',
    body: `S333XSHOP sells physical, hand-finished collectible pieces made by the Artist in numbered limited runs. Each piece is one of a fixed run (for example, #7 of 50) and runs are never reproduced. Every piece is made to order or in small batches. Minor variations are part of what makes each one unique, not defects.`,
  },
  {
    heading: 'Prices and payment',
    body: `Prices are shown in US dollars and include standard shipping within the United States. Payment is processed by Stripe. We never see or store your card details. Applicable sales tax is calculated and added at checkout.`,
  },
  {
    heading: 'Limits and the registry',
    body: `Drops are limited to one piece per fan. Your edition number and display name appear in the drop's public registry inside the app. That visibility is part of owning a numbered piece.`,
  },
  {
    heading: 'Shipping',
    body: `Every piece ships within 5 business days of your order. You'll get a notification the moment yours ships. The tracking number appears on the drop page in the app. We ship within the United States only. Make sure your shipping address is correct at checkout; packages returned because of an incorrect address can be reshipped at your cost.`,
  },
  {
    heading: 'Damaged, lost, or wrong items',
    body: `If your piece arrives damaged, email ${SUPPORT_EMAIL} within 7 days of delivery with photos of the piece and the packaging. We'll replace it if the run allows, or refund you in full. If tracking shows your package lost in transit, we'll work with the carrier and make it right. If we ship you the wrong number, we'll fix it at no cost to you.`,
  },
  {
    heading: 'Returns and refunds',
    body: `Because every piece is a numbered limited collectible, all sales are final. There are no returns or exchanges for change of mind. This does not affect the damaged and lost protections above, and nothing here limits your rights under applicable consumer law. Approved refunds go back to your original payment method; the refunded number returns to the run.`,
  },
  {
    heading: 'Order issues and contact',
    body: `For order status, address changes before shipping, or damage claims, email ${SUPPORT_EMAIL} with your drop number and edition number. We answer within 2 business days.`,
  },
  {
    heading: 'Governing law',
    body: `These shop terms are part of the ${APP_NAME} Terms of Service and are governed by the laws of ${GOVERNING_STATE}, USA.`,
  },
];
