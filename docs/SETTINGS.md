# Settings

The **settings** page edits the server configuration and saves it to
`config/settings.json`. The server reads that file once at startup, so saved
changes apply after a restart.

![Settings page](screenshots/settings.png)

## Requirements

The settings API (and therefore the page) works only when authentication is
on: `ENABLE_AUTH=true` (or `ENABLE_OIDC=true`). Otherwise every
`/api/settings` request returns 403 and the page shows that message. This stops
anyone on the network from reading or rewriting credentials when the app runs
without a login.

## Where a value comes from

From highest to lowest priority:

1. **Environment variables that are set**, including those loaded from `.env`,
   docker-compose `environment:` and the host environment.
2. **`config/settings.json`**, written by the settings page.
3. **Defaults** in `src/config/index.js`.

An environment variable that is not set never hides a saved value. But a
variable that *is* set (even in `.env`) wins over the saved one, so if a change
you saved doesn't take effect after a restart, check whether the same setting
is also set in the environment. `view running config` on the settings page shows
what the process actually loaded.

## Using the page

- **Sections.** The left pane lists the sections in four groups: SERVER
  (`server`), ACCESS (`authentication`, `rate limits`), ALERTS (`email`, `ntfy`,
  `webhook`, `monitoring`) and APPEARANCE (`theme`). For authentication, email,
  ntfy, webhook and monitoring, the dot shows whether the feature is switched on
  in the form. `find setting…` filters by label or config key.
- **Fields.** Each field shows its config key (for example
  `email.smtp.host`), which is also the key in `settings.json`.
- **Unsaved changes.** The sticky footer counts changed fields, and each
  section with changes is marked `edited`. `discard` reverts them; `save changes`
  writes them. Leaving the page with unsaved changes asks for confirmation.
- **Secrets.** Passwords, the session secret, the OIDC client secret and ntfy
  credentials come back masked. Leave a masked or empty secret alone to keep the
  stored value.
- **Other actions.** `reset to defaults` deletes `config/settings.json` (after a
  confirmation). `reload` re-reads the saved values. `view running config` shows
  the configuration the server loaded at startup, with copy and download
  buttons.
- **Test buttons.** The ntfy and webhook sections have a test button. It uses
  the running configuration, so restart after saving before testing new values.
  The [notifications](../README.md#pages) page has the same tests.

## Sections

| Section | Keys | Notes |
|---|---|---|
| server | `server.port`, `server.httpsPort`, `server.host`, `server.sslDomain`, `server.enableHttps`, `server.forceHttps`, `paths.certificates`, `paths.uploaded` | `server.host` is reported by `GET /api/config` but the server listens on all interfaces regardless. `paths.uploaded` is where uploads are saved. `paths.certificates` only changes which folder the expiry monitor scans; the certificate list and routes always use `certificates/` in the working directory. |
| authentication | `auth.*`, `oidc.*` | Basic auth and OpenID Connect. OIDC needs basic auth enabled too. |
| rate limits | `rateLimit.{cli,api,auth}.{window,max}` | Windows in milliseconds. |
| email | `email.enabled`, `email.smtp.*`, `email.from`, `email.to`, `email.subject` | `email.to` is comma-separated. |
| ntfy | `ntfy.*` | Token auth takes priority over username/password. |
| webhook | `webhook.enabled`, `webhook.url` | Custom request headers are not editable here; see below. |
| monitoring | `monitoring.enabled`, `monitoring.checkInterval` (cron, UTC), `monitoring.warningDays`, `monitoring.criticalDays`, `monitoring.includeUploaded` | |
| theme | `theme.mode`, `theme.darkMode`, `theme.primaryColor` | Only `theme.mode` is used: it is the default theme for browsers that haven't picked one. The other two are stored but nothing reads them. |

### Webhook headers

To send custom headers (for example an `Authorization` header), add them to
`config/settings.json` by hand and restart:

```json
{ "webhook": { "enabled": true, "url": "https://hooks.dev.local/mkcert", "headers": { "Authorization": "Bearer <token>" } } }
```

The settings API never returns header values (they are masked) and doesn't
change them when you save other settings.

## API

`GET/POST/DELETE /api/settings`, `GET /api/settings/running`,
`GET /api/settings/export` and `POST /api/settings/import` are described in
[API.md](API.md#settings). Export and import have no buttons on the page. The
export masks secrets; importing that file leaves the stored secrets unchanged.

```bash
# after logging in and fetching a CSRF token (see API.md)
curl -b jar -H "X-CSRF-Token: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"monitoring":{"warningDays":45}}' http://localhost:3000/api/settings
```

Only keys the settings page knows are saved; anything else in the body is
dropped.

## Troubleshooting

- **The server won't start after editing `settings.json` by hand.** A file that
  isn't valid JSON stops startup with `Failed to load …/config/settings.json`.
  Fix the JSON or delete the file.
- **A saved change has no effect.** Restart the server, then check `view running
  config`. If the value still differs, the same setting is set as an
  environment variable (see [Where a value comes from](#where-a-value-comes-from)).
- **Settings are lost when a container is recreated.** Mount a volume at
  `/app/config` (see `docker-compose.yml` and [DOCKER.md](DOCKER.md)).
- **Settings don't save.** Check that the server can write to `config/` (under
  the systemd unit it must be in `ReadWritePaths`; see
  [deploy/README.md](../deploy/README.md)).
