# Tiny Sunny

A minimal Base44 white-label integration: describe an app in a chat, watch Base44 build it, answer
its questions, and see it in a preview.

It follows Base44's [tenancy model](https://docs.base44.com/developers/white-label/tenancy-and-credentials):
one Base44 account owns every app, and Tiny's server calls Base44 with that account's credentials.
They never reach the browser.

## From the docs to the code

Every Base44 call is one function in [server/base44.ts](server/base44.ts).

| Docs | Code |
| --- | --- |
| [The build turn](https://docs.base44.com/developers/white-label/the-build-turn) | `createApp`, `sendMessage`, `submitToolCallInput` |
| Watch it build, live | `openLiveSession`, and the socket in [components/useLiveChat.ts](components/useLiveChat.ts) |
| Answer the builder's questions | [components/ToolQuestion.tsx](components/ToolQuestion.tsx): a choice, values to enter, or an approval |
| [Embed the app](https://docs.base44.com/developers/white-label/embed-the-app) | `getPreviewUrl` and [components/AppPreview.tsx](components/AppPreview.tsx) |
| [Custom instructions](https://docs.base44.com/developers/white-label/custom-instructions) | `customInstructions`, sent with every new app |

The UI is [shadcn](https://ui.shadcn.com) components: [Workspace](components/Workspace.tsx) holds
the selected app, the [Header](components/Header.tsx) picks it, and the [Chat](components/Chat.tsx)
and [AppPreview](components/AppPreview.tsx) show it.

## The preview

The preview shows the app signed in as one app user, through an embed: Base44 won't sign the app's
owner into one.

- **Latest build** (`latest_preview`) shows first.
- **Live sandbox** (`live_preview`) takes over once the app is building, and shows each change as
  it lands.

## Run locally

Use Node.js 24. From the repository root:

```sh
npm install
cp examples/white-label-minimal/.env.example examples/white-label-minimal/.env.local
```

Fill in `.env.local` with the integration account's
[personal access token](https://docs.base44.com/Workspaces/Personal-access-tokens), created in your
white-label workspace (Builder plan or higher) with Full access to all apps, and the workspace ID.
The token is the only credential: it builds, opens live updates and signs viewers into previews.
Then:

```sh
npm run minimal:dev
```

Open [Tiny Sunny](http://127.0.0.1:3001).

## Kept out to stay minimal

- **Sign-in and app ownership.** Everyone sees every app. In production, sign your users in, record
  who created each app, and check it on every call: Base44 sees only the one account.
- **Publishing.** The builder is told it isn't available.
- **Closing the live session.** It expires after an hour.

## Deploy to Netlify

Use the repository root as the base directory and `examples/white-label-minimal` as the package
directory, and set the variables from `.env.example`.
