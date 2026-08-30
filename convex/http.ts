import { verifyWebhook } from "@clerk/backend/webhooks";
import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    if (!signingSecret) {
      console.error("Missing CLERK_WEBHOOK_SIGNING_SECRET in the Convex deployment.");
      return new Response("Webhook is not configured", { status: 500 });
    }

    try {
      const event = await verifyWebhook(request, { signingSecret });
      if (event.type === "user.created" || event.type === "user.updated") {
        const primaryEmail = event.data.email_addresses.find(
          ({ id }) => id === event.data.primary_email_address_id,
        )?.email_address;
        const name = [event.data.first_name, event.data.last_name].filter(Boolean).join(" ");
        await ctx.runMutation(internal.users.upsertFromClerk, {
          externalId: event.data.id,
          name: name || undefined,
          email: primaryEmail,
          imageUrl: event.data.image_url || undefined,
        });
      } else if (event.type === "user.deleted" && event.data.id) {
        await ctx.runMutation(internal.users.markDeletedFromClerk, {
          externalId: event.data.id,
        });
      }
      return new Response("Webhook received", { status: 200 });
    } catch (error) {
      console.error("Clerk webhook verification failed", error);
      return new Response("Invalid webhook", { status: 400 });
    }
  }),
});

export default http;
