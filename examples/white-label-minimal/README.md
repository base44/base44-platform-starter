# Tiny Sunny

A lean white-label builder on Base44: pick or create an app, chat with the builder, answer its
questions, and watch the preview. No database and no sign-in yet, so run it only where you trust
everyone who can reach it.

## Run locally

```sh
cp examples/white-label-minimal/.env.example examples/white-label-minimal/.env.local   # fill it in
npm run minimal:dev                                                                     # http://127.0.0.1:3001
```

## Where things are

| Folder | What it is |
| --- | --- |
| `sdk/` | A headless chat library: `useBase44Chat`, plus `<Message>` and `<Question>` with default parts you can replace |
| `server/base44.ts` | Tiny's server functions: one Base44 REST call each, with Tiny's credentials |
| `components/chats/headless/` | The chat built on the library |
| `components/chats/without-sdk/` | The same chat built by hand in chatscope, shadcn and assistant-ui, for comparison |
