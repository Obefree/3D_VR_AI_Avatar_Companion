const TOOLS = [
  tool('look_at', 'Turn the companion toward a known spatial target.', {
    targetId: { type: 'string', enum: ['device', 'red_button', 'filter'] },
  }, ['targetId']),
  tool('point_at', 'Point at a known spatial target when the user asks where or which object.', {
    targetId: { type: 'string', enum: ['device', 'red_button', 'filter'] },
  }, ['targetId']),
  tool('highlight', 'Highlight a known target so the user can find it easily.', {
    targetId: { type: 'string', enum: ['device', 'red_button', 'filter'] },
    seconds: { type: 'number', minimum: 0.25, maximum: 8 },
  }, ['targetId']),
  tool('move_near', 'Move the companion to a safe demo pose near a known target.', {
    targetId: { type: 'string', enum: ['device', 'red_button', 'filter'] },
  }, ['targetId']),
];

function tool(name, description, properties, required) {
  return {
    type: 'function',
    name,
    description,
    parameters: { type: 'object', properties, required, additionalProperties: false },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');
  if (!process.env.OPENAI_API_KEY) return res.status(503).send('OPENAI_API_KEY is not configured on this deployment.');

  const { sdp } = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  if (!sdp) return res.status(400).send('Missing SDP offer.');

  const session = {
    type: 'realtime',
    model: 'gpt-realtime-2.1',
    output_modalities: ['audio'],
    instructions: 'You are Nova, a concise embodied spatial AI companion. Use scene context supplied by the client. Never invent target IDs. Use spatial tools when the user asks where something is, asks you to show an object, or requests guidance. Keep spoken answers short.',
    audio: {
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true },
      },
      output: { voice: 'marin' },
    },
    tool_choice: 'auto',
    tools: TOOLS,
  };

  try {
    const form = new FormData();
    form.set('sdp', sdp);
    form.set('session', JSON.stringify(session));

    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    const body = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/sdp');
    return res.send(body);
  } catch (error) {
    console.error(error);
    return res.status(500).send('Failed to create realtime session.');
  }
}
