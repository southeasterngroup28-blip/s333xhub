// S333XHUB — emails each fan-mail submission to the artist's private
// address. Deployed as a Supabase Edge Function; the app calls it right
// after a submission is saved.
//
// Required secrets (Dashboard → Edge Functions → fanmail-email → Secrets):
//   RESEND_API_KEY   — from resend.com (sign up WITH the destination email)
//   FANMAIL_TO_EMAIL — the private inbox that receives submissions
import { createClient } from 'npm:@supabase/supabase-js@2';

// Browsers send a CORS "preflight" request before the real one; answer it.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { fan_mail_id } = await req.json();
    if (!fan_mail_id) return new Response('missing fan_mail_id', { status: 400, headers: corsHeaders });

    // Who is calling? Must be a signed-in user.
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );
    const { data: userData } = await anonClient.auth.getUser();
    if (!userData?.user) return new Response('unauthorized', { status: 401, headers: corsHeaders });

    // Trusted client for reading the row and signing the file link.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: row } = await admin
      .from('fan_mail')
      .select('id, user_id, kind, storage_path, note, created_at')
      .eq('id', fan_mail_id)
      .single();
    // Only the submission's own sender can trigger its email.
    if (!row || row.user_id !== userData.user.id) {
      return new Response('not found', { status: 404, headers: corsHeaders });
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('display_name')
      .eq('id', row.user_id)
      .single();

    const { data: signed } = await admin.storage
      .from('fan-mail')
      .createSignedUrl(row.storage_path, 60 * 60 * 24 * 7); // 7-day link

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
          <p><a href="${signed?.signedUrl}">Open the file</a> (link works for 7 days)</p>
        `,
      }),
    });
    if (!response.ok) {
      return new Response(`email failed: ${await response.text()}`, {
        status: 502,
        headers: corsHeaders,
      });
    }
    return new Response('ok', { headers: corsHeaders });
  } catch (error) {
    return new Response(String(error), { status: 500, headers: corsHeaders });
  }
});
