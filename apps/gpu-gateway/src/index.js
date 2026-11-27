// Cloudflare Worker entry: every request goes to one Durable Object, which holds all gateway state.
import { Gateway } from "./gateway.js";

export class GatewayState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.gateway = new Gateway(ctx.storage, env.FILES, env);
  }

  async fetch(request) {
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 10 * 60_000);
    return this.gateway.handle(request);
  }

  async alarm() {
    await this.gateway.sweep();
    await this.ctx.storage.setAlarm(Date.now() + 10 * 60_000);
  }
}

export default {
  async fetch(request, env) {
    const stub = env.GATEWAY_STATE.get(env.GATEWAY_STATE.idFromName("main"));
    return stub.fetch(request);
  },
};
