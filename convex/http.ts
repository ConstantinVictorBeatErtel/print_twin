// HTTP endpoints: Tripo webhook receiver (optional) + simple health check.
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({ path: "/health", method: "GET", handler: httpAction(async () => new Response("ok")) });

// Tripo webhook (console → Settings → Webhooks → https://<deployment>.convex.site/tripo/webhook)
// Verify: header `t=<unix>,v1=<hex>` = HMAC-SHA256(secret, `${t}.${rawBody}`)
http.route({
  path: "/tripo/webhook", method: "POST",
  handler: httpAction(async (_ctx, req) => {
    const body = await req.text();
    console.log("tripo webhook", body.slice(0, 500));
    return new Response(null, { status: 200 });
  }),
});

export default http;
