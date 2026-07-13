import { envVariables } from './env-vars';
import { LIVE_RESOURCE_KEYS, type LiveResourceKey } from './live-event-contract';

export { LIVE_RESOURCE_KEYS, type LiveResourceKey } from './live-event-contract';
type Subscriber = (frame: string) => void;

export class LiveEventBroadcaster {
  private readonly subscribers = new Set<Subscriber>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly heartbeatMs: number) {}

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    this.startHeartbeat();

    return () => {
      this.subscribers.delete(subscriber);
      this.stopHeartbeatWhenIdle();
    };
  }

  publishChanged(resources: Iterable<LiveResourceKey>): void {
    const requested = new Set(resources);
    const changed = LIVE_RESOURCE_KEYS.filter((resource) => requested.has(resource));
    if (changed.length === 0) return;

    this.broadcast(`event: changed\ndata: ${JSON.stringify({ changed })}\n\n`);
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) return;
    this.heartbeatTimer = setInterval(() => this.broadcast(': heartbeat\n\n'), this.heartbeatMs);
  }

  private stopHeartbeatWhenIdle(): void {
    if (this.subscribers.size > 0 || this.heartbeatTimer === null) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private broadcast(frame: string): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(frame);
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
    this.stopHeartbeatWhenIdle();
  }
}

export const liveEvents = new LiveEventBroadcaster(envVariables.NB_BOND_API_SSE_HEARTBEAT_MS);

export function publishLiveChange(resources: Iterable<LiveResourceKey>): void {
  liveEvents.publishChanged(resources);
}
