import { WS_BASE_URL } from '../config/api';

export interface RealtimeEvent {
  type: 'order_status' | 'delivery_status' | string;
  data: Record<string, any>;
}

type EventHandler = (event: RealtimeEvent) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private handlers = new Set<EventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 2000;
  private active = false;

  connect(token: string) {
    if (this.token === token && this.ws?.readyState === WebSocket.OPEN) return;
    this.token = token;
    this.active = true;
    this.reconnectDelay = 2000;
    this._open();
  }

  disconnect() {
    this.active = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  /** Returns an unsubscribe function. */
  addHandler(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private _open() {
    if (!this.active || !this.token) return;

    this.ws = new WebSocket(`${WS_BASE_URL}?token=${this.token}`);

    this.ws.onopen = () => {
      this.reconnectDelay = 2000;
    };

    this.ws.onmessage = ({ data }) => {
      try {
        const event: RealtimeEvent = JSON.parse(data);
        this.handlers.forEach((h) => h(event));
      } catch {}
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.active) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
        this._open();
      }, this.reconnectDelay);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }
}

export const wsService = new WebSocketService();
