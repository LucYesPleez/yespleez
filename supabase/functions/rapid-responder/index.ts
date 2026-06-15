import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
const FROM       = 'onboarding@resend.dev'
const OWNER_EMAIL = 'yespleez.aus@gmail.com'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { type, data } = await req.json()

    let subject = ''
    let html    = ''
    let to      = OWNER_EMAIL

    if (type === 'application_received') {
      if (!data.artistEmail) return new Response(JSON.stringify({ error: 'artistEmail required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      to      = data.artistEmail
      subject = `Application received — ${data.eventName}`
      html    = `<p>Hey <strong>${data.artistName}</strong>,</p>
                 <p>Your application to <strong>${data.eventName}</strong> has been received. The promoter will be in touch.</p>
                 <p>— YesPleez</p>`

    } else if (type === 'new_application') {
      to      = OWNER_EMAIL
      subject = `New application — ${data.eventName}`
      html    = `<p>New application for <strong>${data.eventName}</strong>.</p>
                 <p><strong>Artist:</strong> ${data.artistName}<br>
                    <strong>Email:</strong> ${data.artistEmail || '—'}<br>
                    ${data.note ? `<strong>Note:</strong> ${data.note}` : ''}</p>
                 <p>— YesPleez</p>`

    } else if (type === 'application_accepted') {
      if (!data.artistEmail) return new Response(JSON.stringify({ error: 'artistEmail required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      to      = data.artistEmail
      subject = `You're in — ${data.eventName} ✓`
      html    = `<p>Hey <strong>${data.artistName}</strong>,</p>
                 <p><strong>${data.hostName || 'The promoter'}</strong> has accepted your application to play at <strong>${data.eventName}</strong>.</p>
                 <p>— YesPleez</p>`

    } else if (type === 'signup_confirmation') {
      if (!data.email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
      const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'signup', email: data.email, password: data.password }),
      })
      const linkData = await linkRes.json()
      if (!linkRes.ok || !linkData.action_link) {
        console.error('generate_link error:', JSON.stringify(linkData))
        return new Response(JSON.stringify({ error: linkData.message || 'Could not generate confirmation link' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
      to      = data.email
      subject = 'Confirm your YesPleez account'
      html    = `<p>Hey${data.name ? ` <strong>${data.name}</strong>` : ''},</p>
                 <p>Thanks for signing up to YesPleez! Click the button below to confirm your email address.</p>
                 <p><a href="${linkData.action_link}" style="background:#a855f7;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">CONFIRM EMAIL</a></p>
                 <p style="color:#888;font-size:12px;">If you didn't sign up for YesPleez, you can safely ignore this email.</p>
                 <p>— YesPleez</p>`

    } else if (type === 'password_reset') {
      if (!data.email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
      const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'recovery', email: data.email }),
      })
      const linkData = await linkRes.json()
      if (!linkRes.ok || !linkData.action_link) {
        console.error('generate_link error:', JSON.stringify(linkData))
        return new Response(JSON.stringify({ error: linkData.message || 'Could not generate reset link' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      }
      to      = data.email
      subject = 'Reset your YesPleez password'
      html    = `<p>Hey,</p>
                 <p>Click the link below to reset your YesPleez password. This link expires in 1 hour.</p>
                 <p><a href="${linkData.action_link}" style="background:#a855f7;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">RESET PASSWORD</a></p>
                 <p style="color:#888;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
                 <p>— YesPleez</p>`

    } else {
      return new Response(JSON.stringify({ error: 'Unknown type: ' + type }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from: FROM, to, subject, html }),
    })

    const result = await r.json()
    console.log('Resend response:', r.status, JSON.stringify(result))

    return new Response(JSON.stringify(result), {
      status: r.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    console.error('send-email error:', e.message)
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
