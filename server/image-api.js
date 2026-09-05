export const IMAGE_MODEL = 'gpt-image-2';
const MAX_BODY = 36 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;

function fail(status, message) { return Object.assign(new Error(message), { status }); }

export function decodeImage(value, label) {
  const match = typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw fail(400, `${label} must be a PNG, JPEG, or WebP image.`);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE) throw fail(413, `${label} must be under 8 MB.`);
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : match[1] === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw fail(400, `${label} has invalid image contents.`);
  return new Blob([bytes], { type: `image/${match[1]}` });
}

export function createImageApi({ getApiKey, fetchImpl = fetch, timeoutMs = 240_000 }) {
  let busy = false;
  return async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (path !== '/api/image-status' && path !== '/api/image-edit') return next();
    const send = (status, body) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // Local same-origin endpoint: never expose the key or allow cross-site paid requests.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
      send(403, { error: 'Use image generation from the viewer on this server.' }); return;
    }
    if (path === '/api/image-status' && req.method === 'GET') {
      send(200, { configured: Boolean(getApiKey()?.trim()), model: IMAGE_MODEL }); return;
    }
    if (path !== '/api/image-edit' || req.method !== 'POST') { send(405, { error: 'Method not allowed.' }); return; }
    const apiKey = getApiKey()?.trim();
    if (!apiKey) { send(503, { error: 'Add OPENAI_API_KEY to .env.local and restart the server to enable generation.' }); return; }
    if (busy) { send(429, { error: 'An image is already generating. Wait for it to finish before trying again.' }); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { send(415, { error: 'Send JSON with an image and description.' }); return; }
    busy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw fail(413, 'The images are too large. Try smaller images.');
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400, 'Invalid JSON request.'); }
      if (!body || typeof body.description !== 'string' || !body.description.trim() || body.description.length > 8000) {
        throw fail(400, 'Enter a description between 1 and 8,000 characters.');
      }
      const form = new FormData();
      form.set('model', IMAGE_MODEL);
      form.set('quality', 'high');
      form.set('background', 'transparent');
      form.set('output_format', 'png');
      form.set('size', '1024x1024');
      form.set('n', '1');
      form.append('image[]', decodeImage(body.image, 'Annotated screenshot'), 'annotated-view.png');
      if (body.cleanImage) form.append('image[]', decodeImage(body.cleanImage, 'Clean screenshot'), 'clean-view.png');
      if (body.reference) form.append('image[]', decodeImage(body.reference, 'Design reference'), 'design-reference');
      form.set('prompt', [
        'Create a polished isolated object image based on the user request below.',
        'Image 1 is a screenshot of a Gaussian splat scene with the user’s screen-space annotations. Marks may indicate the target object, outline, or requested changes; interpret them as instructions, never reproduce the ink itself.',
        body.cleanImage ? 'Image 2 is the identical scene without annotations, for appearance and context.' : '',
        body.reference ? `Image ${body.cleanImage ? 3 : 2} is a design/style reference; apply it to the requested object.` : '',
        'Output only the requested object, fully visible and centered with some padding. Remove the surrounding room and all unrelated objects. Use a real transparent alpha background, not a checkerboard or a solid background. No text, labels, UI, annotation marks, or ground plane. Follow the user’s requested inclusions, exclusions, and geometry.',
        `User request: ${body.description.trim()}`,
      ].filter(Boolean).join('\n\n'));
      const upstream = await fetchImpl('https://api.openai.com/v1/images/edits', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal,
      });
      const result = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        const message = upstream.status === 401 ? 'OpenAI rejected the API key. Check OPENAI_API_KEY on the server.'
          : upstream.status === 403 ? 'This OpenAI project does not have access to GPT Image 2. Check model access and organization verification.'
            : upstream.status === 429 ? 'OpenAI rate limit or quota reached. Check billing and try again later.'
              : 'OpenAI could not generate this image. Check the request, model access, and transparent-background support, then try again.';
        throw fail(upstream.status >= 500 ? 502 : upstream.status, message);
      }
      const output = result?.data?.[0]?.b64_json;
      if (!output || !Buffer.from(output, 'base64').subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
        throw fail(502, 'OpenAI did not return a PNG. Please try again.');
      }
      send(200, { image: `data:image/png;base64,${output}`, model: IMAGE_MODEL });
    } catch (error) {
      send(error.status || (controller.signal.aborted ? 504 : 502), {
        error: error.status ? error.message : controller.signal.aborted ? 'Generation timed out. Please try again.' : 'Could not reach OpenAI. Check the server connection and try again.',
      });
    } finally {
      busy = false;
      clearTimeout(timer);
      res.off('close', disconnect);
    }
  };
}
