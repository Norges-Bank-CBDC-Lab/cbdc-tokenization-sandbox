export const LiveResource = Object.freeze({
  AUCTIONS: 'auctions',
  BANKING: 'banking',
  BIDDERS: 'bidders',
  BONDS: 'bonds',
  CENTRAL_BANK: 'central-bank',
  OPERATIONS: 'operations',
  REGISTRY: 'registry',
});

export const LIVE_RESOURCE_KEYS = Object.freeze(Object.values(LiveResource));
const LIVE_RESOURCE_KEY_SET = new Set(LIVE_RESOURCE_KEYS);

/** Incremental SSE framing/parser independent of the network transport. */
export function createSseParser(onChanged) {
  let buffer = '';

  function parseFrame(frame) {
    let eventName = 'message';
    const dataLines = [];
    for (const line of frame.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventName = value;
      if (field === 'data') dataLines.push(value);
    }

    if (eventName !== 'changed' || dataLines.length === 0) return;
    try {
      const payload = JSON.parse(dataLines.join('\n'));
      if (!Array.isArray(payload?.changed)) return;
      const changed = [...new Set(payload.changed.filter((key) => LIVE_RESOURCE_KEY_SET.has(key)))];
      if (changed.length > 0) onChanged(changed);
    } catch {
      // Notifications are disposable; the next event or reconnect reconciles state.
    }
  }

  return {
    push(chunk) {
      buffer += chunk;
      for (;;) {
        const delimiter = buffer.match(/\r?\n\r?\n/);
        if (!delimiter || delimiter.index === undefined) break;
        const frame = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        parseFrame(frame);
      }
    },
  };
}
