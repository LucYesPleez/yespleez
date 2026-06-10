import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
const FROM       = 'onboarding@resend.dev'
const TO         = 'yespleez.aus@gmail.com'   // sandbox — replace with real recipient once domain is set up

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

    if (type === 'application_received') {
      subject = `Application received — ${data.eventName}`
      html    = `<p>Hey <strong>${data.artistName}</strong>,</p>
                 <p>Your application to <strong>${data.eventName}</strong> has been received. The promoter will be in touch.</p>
                 <p>— YesPleez</p>`

    } else if (type === 'new_application') {
      subject = `New application — ${data.eventName}`
      html    = `<p>New application for <strong>${data.eventName}</strong>.</p>
                 <p><strong>Artist:</strong> ${data.artistName}<br>
                    <strong>Email:</strong> ${data.artistEmail || '—'}<br>
                    ${data.note ? `<strong>Note:</strong> ${data.note}` : ''}</p>
                 <p>— YesPleez</p>`

    } else if (type === 'application_accepted') {
      subject = `You're in — ${data.eventName} ✓`
      html    = `<p>Hey <strong>${data.artistName}</strong>,</p>
                 <p><strong>${data.hostName || 'The promoter'}</strong> has accepted your application to play at <strong>${data.eventName}</strong>.</p>
                 <p>— YesPleez</p>`

    } else {
      return new Response(JSON.stringify({ error: 'Unknown type: ' + type }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from: FROM, to: TO, subject, html }),
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
