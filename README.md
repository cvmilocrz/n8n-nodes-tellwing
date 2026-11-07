# n8n-nodes-tellwing

The official [Tellwing](https://tellwing.com) node for [n8n](https://n8n.io): add subscribers, send transactional
email, record events that start your Tellwing automations, and start n8n workflows from Tellwing events.

## Install

In a self-hosted n8n: **Settings → Community Nodes → Install** and enter `n8n-nodes-tellwing`.

## Credentials

Create an API key in Tellwing (**Settings → API**) and add a **Tellwing API** credential in n8n:

| Field | Value |
|---|---|
| API Key | `tw_live_…` (or `tw_test_…` for the sandbox: nothing is sent) |
| Base URL | `https://api.tellwing.com/v1` |

The key needs these permissions: `subscribers:write`, `lists:read`, `templates:read`, `messages:send`,
`events:write`, `webhooks:read` and `webhooks:write`.

## Nodes

**Tellwing**

- **Subscriber → Create or Update**: adds or updates a person in a list. A consent source is required, so every
  subscriber keeps a record of how they agreed to hear from you.
- **Message → Send**: sends a transactional email with one of your templates (and its variables) or your own content.
- **Event → Record**: records an event for a subscriber (for example `order.paid`) and starts the Tellwing flows
  that listen for it, with the event data available in your emails.

Lists and templates are loaded from your Tellwing organization.

**Tellwing Trigger**

Starts a workflow when something happens in Tellwing (a new subscriber, an unsubscribe, a campaign sent, an email
delivered, opened, clicked, bounced…). Activating the workflow creates the webhook in Tellwing; deactivating it removes
it. Every delivery is verified with its signature before the workflow runs.

## Plans

The API is available from the Growth plan; the trigger (outgoing webhooks) from the Pro plan. Test keys work on every
plan against the sandbox.

## Links

- API reference: https://tellwing.com/docs
- Support: support@tellwing.com

## License

MIT
