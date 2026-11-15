// HTTP bridge only: no model calls, raw board commands, redirects or automatic retries.
export class PhoneClient {
  constructor(baseUrl) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Server URL must be an http(s) origin without credentials, path or query');
    }
    this.origin = url.origin;
  }

  async request(path, body, signal, image = false, limit = image ? 8 * 1024 * 1024 : 256 * 1024) {
    const timeout = AbortSignal.timeout(30_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetch(this.origin + path, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: combined,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const type = response.headers.get('content-type') || '';
      if (image && !type.toLowerCase().startsWith('image/jpeg')) {
        await response.body?.cancel();
        throw new Error('Expected a JPEG screenshot');
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) {
          throw new Error('Server response exceeds size limit');
        }
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      if (image) {
        if (data[0] !== 255 || data[1] !== 216) throw new Error('Invalid JPEG screenshot');
        return data;
      }
      return JSON.parse(data.toString('utf8'));
    } catch (error) {
      throw new Error(`${path}: ${error.message}. No automatic retry; an interrupted action may already have executed.`);
    }
  }

  status(signal) { return this.request('/api/status', undefined, signal); }
  screenshot(signal) { return this.request('/api/frame.jpg', undefined, signal, true); }

  async detection(signal) {
    const data = await this.request('/api/detection', undefined, signal, false, 12 * 1024 * 1024);
    const invalid = () => { throw new Error('/api/detection: Invalid detection response'); };
    const score = value => Number.isFinite(value) && value >= 0 && value <= 1;
    const error = value => value === null || typeof value === 'string';
    if (!data || !Number.isSafeInteger(data.width) || data.width <= 0
        || !Number.isSafeInteger(data.height) || data.height <= 0
        || typeof data.image !== 'string' || !Array.isArray(data.boxes)) invalid();
    const box = value => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
      && value[0] >= 0 && value[1] >= 0 && value[2] > value[0] && value[3] > value[1]
      && value[2] <= data.width && value[3] <= data.height;
    const image = Buffer.from(data.image, 'base64');
    if (!image.length || image.length > 8 * 1024 * 1024 || image.toString('base64') !== data.image
        || image[0] !== 255 || image[1] !== 216) throw new Error('/api/detection: Invalid JPEG image');
    const boxes = data.boxes.map(item => {
      if (!item || !Number.isSafeInteger(item.class_id) || item.class_id < 0
          || typeof item.class_name !== 'string' || !score(item.confidence) || !box(item.xyxy)) invalid();
      return { class_id: item.class_id, class_name: item.class_name, confidence: item.confidence, xyxy: item.xyxy,
        center: { x: (item.xyxy[0] + item.xyxy[2]) / (2 * data.width),
          y: (item.xyxy[1] + item.xyxy[3]) / (2 * data.height) } };
    });
    let ocr;
    if (data.ocr !== undefined) {
      const value = data.ocr;
      if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.regions) || !error(value.error)
          || !Number.isSafeInteger(value.skipped) || value.skipped < 0) invalid();
      ocr = { enabled: value.enabled, error: value.error, skipped: value.skipped, elapsed_ms: value.elapsed_ms,
        regions: value.regions.map(region => {
          if (!region || typeof region.class_name !== 'string' || !box(region.xyxy)
              || !Array.isArray(region.lines) || !error(region.error)) invalid();
          return { class_name: region.class_name, xyxy: region.xyxy, error: region.error,
            lines: region.lines.map(line => {
              if (!line || typeof line.text !== 'string' || !score(line.confidence)) invalid();
              return { text: line.text, confidence: line.confidence };
            }) };
        }) };
    }
    const detection = { width: data.width, height: data.height, boxes, elapsed_ms: data.elapsed_ms, ocr };
    if (Buffer.byteLength(JSON.stringify(detection)) > 512 * 1024) throw new Error('/api/detection: Detection metadata exceeds size limit');
    return { image, detection };
  }

  async action(args, signal) {
    const coordinate = (key) => {
      const value = args[key];
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${key} must be between 0 and 1`);
      return value;
    };
    let path, body = {};
    switch (args.action) {
      case 'tap':
      case 'double_tap': body = { x: coordinate('x'), y: coordinate('y') }; break;
      case 'swipe': body = { x1: coordinate('x1'), y1: coordinate('y1'), x2: coordinate('x2'), y2: coordinate('y2') }; break;
      case 'type':
      case 'key':
        if (typeof args.text !== 'string' || !args.text.length || args.text.length > 1000
            || !/^[\x20-\x7e\n\r\t]+$/.test(args.text)) {
          throw new Error('text must contain 1–1000 ASCII characters (firmware limitation)');
        }
        body = { text: args.text };
        break;
      case 'home': case 'back': break;
      case 'stop': path = '/api/agent/stop'; break;
      default: throw new Error('Unsupported phone action');
    }
    if (args.action !== 'stop') {
      const state = await this.status(signal);
      if (!state.device || !state.screen) throw new Error('Board and mirroring must both be connected');
      if (state.agent?.running) throw new Error('Built-in agent is running; stop it before Pi takes control');
      if (!state.calibrated) throw new Error('Calibrate the pointer in the web UI first');
    }
    return this.request(path || `/api/${args.action}`, body, signal);
  }
}
