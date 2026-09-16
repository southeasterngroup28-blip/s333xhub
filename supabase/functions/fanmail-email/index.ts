// S333XHUB: emails each fan-mail submission to the artist's private
// address. Deployed as a Supabase Edge Function (`supabase functions deploy
// fanmail-email`); the app calls it right after a submission is saved.
//
// Required secrets (Dashboard > Edge Functions > Secrets):
//   RESEND_API_KEY     from resend.com, with s333xhub.com verified as a sending domain
//   FANMAIL_TO_EMAIL   the private inbox that receives submissions
//   FANMAIL_FROM_EMAIL optional; defaults to fanmail@s333xhub.com
import { createClient } from 'npm:@supabase/supabase-js@2';

/** The same three words the app's Fan Mail screen uses for a submission's kind. */
const FAN_MAIL_KIND_LABEL: Record<string, string> = {
  picture: 'Photo',
  video: 'Video',
  audio: 'Beat',
};

// Browsers send a CORS "preflight" request before the real one; answer it.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function reply(body: string, status = 200) {
  return new Response(body, { status, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return reply('ok');
  }
  try {
    const { fan_mail_id } = await req.json();
    if (!fan_mail_id) return reply('missing fan_mail_id', 400);

    // Act AS the calling fan: row-level security already lets senders read
    // their own submission and their own uploaded file. No admin key needed.
    const client = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user) return reply(`unauthorized: ${userError?.message}`, 401);

    const { data: row, error: rowError } = await client
      .from('fan_mail')
      .select('id, user_id, kind, storage_path, note, created_at')
      .eq('id', fan_mail_id)
      .single();
    if (rowError || !row) return reply(`row lookup failed: ${rowError?.message}`, 404);

    const { data: profile } = await client
      .from('profiles')
      .select('display_name')
      .eq('id', row.user_id)
      .single();

    const { data: signed, error: signError } = await client.storage
      .from('fan-mail')
      .createSignedUrl(row.storage_path, 60 * 60 * 24 * 7); // 7-day link
    if (signError || !signed) return reply(`sign failed: ${signError?.message}`, 500);

    const senderName = profile?.display_name ?? 'a fan';
    const label = FAN_MAIL_KIND_LABEL[row.kind] ?? row.kind;
    const from = Deno.env.get('FANMAIL_FROM_EMAIL') ?? 'fanmail@s333xhub.com';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `S333XHUB <${from}>`,
        to: [Deno.env.get('FANMAIL_TO_EMAIL')],
        subject: `Fan mail: ${label} from ${senderName}`,
        html: `
          <h2>New fan mail</h2>
          <p><b>From:</b> ${senderName}</p>
          <p><b>Type:</b> ${label}</p>
          ${row.note ? `<p><b>Note:</b> ${row.note.replace(/</g, '&lt;')}</p>` : ''}
          <p><a href="${signed.signedUrl}">Open the file</a> (link works for 7 days)</p>
        `,
      }),
    });
    if (!response.ok) {
      return reply(`email failed: ${await response.text()}`, 502);
    }
    return reply('ok');
  } catch (error) {
    return reply(String(error), 500);
  }
});
