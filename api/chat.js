import { generateText } from 'ai';

const SYSTEM = `You are Nova, an embodied spatial AI companion in a browser 3D/XR demo.
Be concise, natural, and useful. You may discuss only the scene context supplied by the application when referring to what the user can see.
The demo scene has a service device, a red reset button, and a replaceable cylindrical filter.
The task is to guide the user through servicing the device. The red button is the reset control; after resetting, the filter is the next component.
Do not claim to have camera vision. If scene context is insufficient, say so briefly.
Keep most replies to one or two short sentences because the response is spoken aloud.`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, provider: 'vercel-ai-gateway', model: 'openai/gpt-5.6-sol' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { message, scene } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const safeScene = scene && typeof scene === 'object' ? scene : {};

  try {
    const { text } = await generateText({
      model: 'openai/gpt-5.6-sol',
      system: SYSTEM,
      prompt: `CURRENT SCENE CONTEXT:\n${JSON.stringify(safeScene, null, 2)}\n\nUSER:\n${message.trim()}`,
      maxOutputTokens: 180,
      providerOptions: {
        gateway: {
          tags: ['project:spatial-ai-companion', 'feature:browser-demo'],
        },
      },
    });

    return res.status(200).json({ ok: true, text: text.trim() });
  } catch (error) {
    console.error('AI Gateway chat failed:', error);
    const status = Number(error?.statusCode || error?.status || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: error?.message || 'AI response failed',
    });
  }
}
