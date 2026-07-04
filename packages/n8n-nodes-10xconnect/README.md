# n8n-nodes-10xconnect

n8n community nodes for [10xConnect](https://app.10xconnect.io) — LinkedIn outreach
campaigns, leads, the unified inbox, and event triggers.

**Status: in-repo skeleton, not yet published to npm.** It builds and installs
locally; resource coverage grows as the public API stabilizes.

## What's included

- **Credential `10xConnect API`** — base URL + a `10xc_` workspace API key
  (create one in the app: Settings → API). Sent as `Authorization: Bearer`.
  The credential test calls `GET /webhooks`.
- **10xConnect (action node)** — campaigns (list / get / analytics / pause /
  resume), leads (list), conversations (list / get / reply). Replies queue
  through 10xConnect's safety-governed dispatch engine — never instant raw sends.
- **10xConnect Trigger** — starts workflows on `reply`, `accepted_invite`,
  `message_sent`, `hot_lead`, `campaign_completed`, `status_change`. Activating
  the workflow registers an outbound webhook via `POST /webhooks` automatically;
  deactivating removes it.

## Local install (before npm publish)

```bash
pnpm --filter n8n-nodes-10xconnect build
# copy the package into your n8n custom nodes dir:
#   ~/.n8n/custom/  (create it if missing)
cp -r packages/n8n-nodes-10xconnect ~/.n8n/custom/n8n-nodes-10xconnect
cd ~/.n8n/custom/n8n-nodes-10xconnect && npm install --omit=dev
# restart n8n
```

Then create the `10xConnect API` credential (base URL e.g.
`http://localhost:3001/api/v1`, plus your key) and drop the nodes into a
workflow.

## Publishing (later)

`npm publish` from this directory (drop `"private": true` first). n8n picks up
community packages by the `n8n-community-node-package` keyword.
