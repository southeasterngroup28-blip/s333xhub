// S333XHUB — emails each fan-mail submission to the artist's private
// address. Deployed as a Supabase Edge Function; the app calls it right
// after a submission is saved.
//
// Required secrets (Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY   — from resend.com (sign up WITH the destination email)
//   FANMAIL_TO_EMAIL — the private inbox that receives submissions
import { createClient } from 'npm:@supabase/supabase-js@2';

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
    // their own submission and their own uploaded file — no admin key needed.
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
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'S333XHUB Fan Mail <onboarding@resend.dev>',
        to: [Deno.env.get('FANMAIL_TO_EMAIL')],
        subject: `Fan mail — ${row.kind} from ${senderName}`,
        html: `
          <h2>New fan mail</h2>
          <p><b>From:</b> ${senderName}</p>
          <p><b>Type:</b> ${row.kind}</p>
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
