# Revised plan: Keystone as the only frontend, with Misskey and Sharkey as backend-only test targets

The design should have one frontend, Keystone, and two independently selectable backends: Misskey and Sharkey. We should not depend on either server’s built-in web interface for normal Keystone operation or authentication.

I checked the current Keystone code and the corresponding Misskey and Sharkey server implementations. There are two separate pieces of work: preventing their built-in web routes from being served, and implementing authentication in Keystone itself.

## 1. Separate the frontend from the backend

Misskey and Sharkey do not normally run their frontend as a separate application process. Their server registers a `ClientServerService` alongside the API, streaming, file, and federation services. Consequently, stopping or omitting a separate frontend process is not the same as disabling the built-in web interface.

Sources: [Misskey ](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/ServerService.ts)[`ServerService.ts`](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/ServerService.ts) · [Sharkey ](https://github.com/DDVD233/sharkey/blob/stable/packages/backend/src/server/ServerService.ts)[`ServerService.ts`](https://github.com/DDVD233/sharkey/blob/stable/packages/backend/src/server/ServerService.ts).

For the strict separation we want, add a small, explicit backend-only switch to both local server checkouts.

In each `packages/backend/src/server/ServerService.ts`, replace the unconditional registration:

```
fastify.register(this.clientServerService.createServer);
```

with:

```
if (process.env.KEYSTONE_BACKEND_ONLY !== "1") {
  fastify.register(this.clientServerService.createServer);
}
```

Run each server with `KEYSTONE_BACKEND_ONLY=1` and rebuild it as required by that repository's development workflow.

This leaves Keystone-independent server services registered, including the API, streaming, file handling, ActivityPub, NodeInfo and well-known routes. Sharkey's additional API services remain registered too. The `ClientServerService` routes—including its built-in web UI and MiAuth authorization page—are no longer exposed by the server.

Scope of this change: it disables the built-in frontend routes; it does not necessarily remove the frontend package from the monorepo or eliminate every frontend-related build dependency. That larger build-system separation is not necessary to test Keystone against the API.

The environment switch is a small local patch, not an existing upstream configuration option. Keep the same patch in both server checkouts and cover it with a smoke test.

## 2. Give Keystone its own authentication and authorization flow

You are right that relying on Misskey's `/miauth/{session}` page would undermine the goal. The normal MiAuth protocol sends the user to that instance-hosted page, then uses `/api/miauth/{session}/check` to retrieve the granted token.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://misskey-hub.net\&sz=32)

Misskey

+1



We should therefore reimplement the user-facing authorization flow in Keystone, while reusing the backend API's token-issuance mechanism where appropriate. Do not navigate to the Misskey or Sharkey MiAuth page.

The proposed flow is:

1\. Keystone login screen

User enters credentials for the selected local instance.

2\. Instance sign-in API

Keystone calls `/api/signin` and handles the returned sign-in state.

3\. Keystone permission screen

Show the requested access and allow the user to grant or cancel it.

4\. Obtain a scoped application token

Use the authenticated session with `miauth/gen-token`, then check the generated token through the MiAuth check API.

5\. Keystone session

Fetch the current user, store the scoped token, and continue using the API.

The API implementations contain both the sign-in flow and the MiAuth token-generation endpoint: [Misskey sign-in implementation](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/SigninApiService.ts) and [MiAuth token generator](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/miauth/gen-token.ts). Sharkey has corresponding implementations in its `stable` branch.

There are important implementation details:

- The sign-in API uses a multi-step response model. Handle its response rather than assuming every account can authenticate with one username/password request. CAPTCHA, two-factor authentication and passkeys may require additional steps.
- A successful native sign-in returns an `i` value, not Keystone's currently assumed `{ token, user }` response. Treat that value as a temporary credential for the authorization exchange, obtain the scoped application token, and fetch the current user separately.
- Do not persist the temporary sign-in credential as Keystone's normal session token. Store the token issued for Keystone with only the permissions it needs. Derive the permission list from the implemented features and the two backends' API definitions.
- Never log credentials or tokens. Clear temporary credentials from application state as soon as they are no longer needed.

This lets Keystone own the entire login and grant UI, without depending on the instance-hosted frontend. For a public client used with arbitrary instances, direct credential collection needs a separate security review; this first version is specifically for testing against your own instances.

## 3. Make the selected backend configurable

Keystone's current Vite configuration already proxies `/api` and `/files` to `127.0.0.1:3000`. Its API helper posts JSON to `/api/${endpoint}` and automatically adds the stored credential as `i`.

Sources: [Keystone Vite config](https://github.com/estyseesghosts/keystone/blob/main/frontend/vite.config.ts) · [Keystone API client](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/api/client.ts).

Change the proxy target to use a server-side development environment variable. Keep the existing Vite plugins and build configuration:

```
import { defineConfig, loadEnv } from "vite";
import solidPlugin from "vite-plugin-solid";
import devtools from "solid-devtools/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = (
    env.KEYSTONE_BACKEND_URL ?? "http://127.0.0.1:3000"
  ).replace(/\/+$/, "");

  return {
    plugins: [devtools(), solidPlugin()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target, changeOrigin: true },
        "/files": { target, changeOrigin: true },
        "/proxy": { target, changeOrigin: true },
        "/streaming": {
          target,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    build: { target: "esnext" },
  };
});
```

Use separate Vite mode files, for example:

`frontend/.env.misskey`

```
KEYSTONE_BACKEND_URL=http://127.0.0.1:3000
```

`frontend/.env.sharkey`

```
KEYSTONE_BACKEND_URL=http://127.0.0.1:3200
```

The port `3200` is only an example; substitute your local Sharkey port.

Run the same Keystone frontend against either target:

```
npm run dev -- --mode misskey
npm run dev -- --mode sharkey
```

Restart Vite when switching targets. The target variable is read by Vite's development server, not exposed as a `VITE_*` variable to application code.

A proxy only handles relative paths. Absolute media URLs returned by an instance may still load directly from that instance; the adapter must account for this if the browser cannot reach those URLs. Do not change the instance's canonical `url` setting just to accommodate Keystone.

## 4. Introduce a Misskey-family adapter, without breaking Pinetree

The existing Keystone API types explicitly describe the Pinetree contract. Do not replace that contract globally or make Pinetree pretend to be Misskey.

Implement a backend boundary with these responsibilities:

| Component              | Responsibility                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Pinetree adapter       | Preserve the current Pinetree-specific API and sign-in behavior.                       |
| Misskey-family adapter | Handle native sign-in, token grant, API requests, and Misskey-family response shapes.  |
| Shared UI models       | Present consistent user, note, file and notification structures to SolidJS components. |
| Backend configuration  | Select the test target and ensure tokens are scoped to its origin.                     |

Use the same Misskey-family adapter for Misskey and Sharkey first. Where behavior differs, add explicit capability checks or tested compatibility handling rather than forking the entire frontend. Do not assume their responses are identical just because endpoint names match.

For the initial milestone, adapt the API calls already used by Keystone: `i`, timelines, `users/show`, note creation and deletion, reactions, following and notifications. Validate fields against each server, particularly where Keystone currently expects Pinetree-specific response shapes.

## 5. Verification criteria

Run the following against both local instances. Do not count the backend-only switch or successful compilation as proof of compatibility.

| Test              | Required result                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Backend-only mode | The server's normal web UI and `/miauth/{session}` page are not served; API routes remain available.   |
| Keystone login    | Login and token grant complete entirely within Keystone, with no redirect to the built-in instance UI. |
| Session isolation | A Misskey token is never sent to Sharkey, and vice versa.                                              |
| Identity          | The resulting scoped token can retrieve the current user.                                              |
| Read operations   | Home/Local timelines, note details, profiles and notifications render actual backend responses.        |
| Write operations  | Posting, replying, reacting, renoting and following succeed and are reflected by the backend.          |
| Media             | Existing file URLs load. Uploads are tested once implemented in Keystone.                              |
| Streaming         | Once implemented, the WebSocket proxy connects and authenticated events reach Keystone.                |

Use dedicated test accounts and verify successful writes by refreshing from the server rather than relying only on optimistic UI updates.

## Implementation order

1. Add the backend-only switch to both Misskey and Sharkey server checkouts and verify that API, files and streaming remain accessible.
2. Add configurable Vite backend targets so the same Keystone build can switch between the two.
3. Build the Keystone-owned sign-in and permission-grant flow; exchange the temporary sign-in credential for a scoped application token.
4. Adapt the current screens to the Misskey-family API and run the same tests against both servers.
5. Add streaming, media uploads and broader feature support in subsequent work.

The target architecture is Keystone-only at the UI layer, with Misskey and Sharkey operating as API/federation backends. The server-side switch disables their built-in web routes; Keystone provides the user-facing authentication and permission grant rather than relying on those routes.
