// Vercel BotID client (security review C2): attaches its check to the signup request only. See lib/newsletter/bot.ts.
import { initBotId } from "botid/client/core";

initBotId({ protect: [{ path: "/api/subscribe", method: "POST" }] });
