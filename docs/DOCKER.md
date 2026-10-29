# Docker

The image is [`jeffcaldwellca/mkcertweb`](https://hub.docker.com/r/jeffcaldwellca/mkcertweb)
(linux/amd64 and linux/arm64). It runs Node.js 24 on Alpine with openssl and an
mkcert binary built from the v1.4.4 source, as the unprivileged `nodejs` user
(UID/GID 1001), and starts with `node server.js`.

## Quick start

```bash
git clone https://github.com/jeffcaldwellca/mkcertWeb.git
cd mkcertWeb
docker compose up -d        # or docker-compose up -d
```

Open <http://localhost:3000>. `docker-compose.yml` pulls
`jeffcaldwellca/mkcertweb:latest`, maps ports 3000 and 3443, and creates four
named volumes.

**First run:** the image ships without a root CA, so each container makes its
own. Open **root-ca** and press `generate`. The CA is created in the
`mkcert_ca` volume; adding it to the container's own trust store fails without
root, which is expected. Download `rootCA.pem` from the same page and install it
on the machines that should trust your certificates.

## Volumes

| Mount point | Holds | Volume in `docker-compose.yml` |
|---|---|---|
| `/app/certificates` | generated, uploaded, archived and SCEP certificates | `mkcert_certificates` |
| `/app/data` | certificate notes (`certificate-notes.json`) | `mkcert_data` |
| `/app/config` | settings saved from the UI (`settings.json`) | `mkcert_config` |
| `/home/nodejs/.local/share/mkcert` | the root CA (`rootCA.pem`, `rootCA-key.pem`); the image sets `CAROOT` to this path | `mkcert_ca` |

Without these volumes the CA, certificates and settings are lost whenever the
container is recreated.

## docker run

```bash
docker run -d --name mkcert-web-ui \
  -p 3000:3000 \
  -v mkcert_certificates:/app/certificates \
  -v mkcert_data:/app/data \
  -v mkcert_config:/app/config \
  -v mkcert_ca:/home/nodejs/.local/share/mkcert \
  -e ENABLE_AUTH=true -e AUTH_USERNAME=demo -e AUTH_PASSWORD='change-me' \
  -e SESSION_SECRET="$(openssl rand -hex 48)" \
  jeffcaldwellca/mkcertweb:latest
```

To build the image yourself: `docker build -t mkcert-web-ui .` (or
`npm run docker:build`).

## Configuration

Configure the container with environment variables: the `environment:` list in
`docker-compose.yml` (or a `docker-compose.override.yml`), or `-e` with
`docker run`. A `.env` file in the project directory is **not** passed into the
container by the provided compose file, and `.dockerignore` keeps it out of the
image. Every variable is listed in [`.env.example`](../.env.example).

The image sets these defaults, so they always come from the environment:

| Variable | Image default |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` / `HTTPS_PORT` | `3000` / `3443` |
| `ENABLE_HTTPS` / `FORCE_HTTPS` | `false` / `false` |
| `SSL_DOMAIN` | `localhost` |
| `THEME_MODE` | `dark` |
| `ENABLE_AUTH` | `false` |
| `AUTH_USERNAME` | `admin` |
| `CAROOT` | `/home/nodejs/.local/share/mkcert` |

Because environment variables that are set override settings saved in the UI
(see [SETTINGS.md](SETTINGS.md#where-a-value-comes-from)), changing those values
on the settings page has no effect in the container; change the environment
instead. The settings page itself needs `ENABLE_AUTH=true`.

Not set by the image: `AUTH_PASSWORD` (or `AUTH_PASSWORD_HASH`) and
`SESSION_SECRET`. With auth on and no password, a random one is printed to the
container log at each start (`docker compose logs mkcert-web-ui`). Without a
session secret, sessions end on every restart.

To serve on another host port, change the `ports:` mapping (for example
`"8080:3000"`); `PORT` is the port inside the container.

## Running as another UID

To run as a different user (for example `user: "2000:2000"`), bind-mount the
four directories from host paths that user owns. The directories inside the
image belong to UID 1001.

```yaml
services:
  mkcert-web-ui:
    image: jeffcaldwellca/mkcertweb:latest
    user: "2000:2000"
    volumes:
      - /srv/mkcert/certificates:/app/certificates
      - /srv/mkcert/data:/app/data
      - /srv/mkcert/config:/app/config
      - /srv/mkcert/ca:/home/nodejs/.local/share/mkcert
```

```bash
sudo mkdir -p /srv/mkcert/{certificates,data,config,ca}
sudo chown -R 2000:2000 /srv/mkcert
```

`CAROOT` is fixed in the image, so mkcert finds the CA even when the UID has no
home directory.

## HTTPS and reverse proxies

- `ENABLE_HTTPS=true` makes the app also listen on 3443 with an mkcert
  certificate for `SSL_DOMAIN`, created in `/app/ssl` at startup and signed by
  the container's CA. Add `FORCE_HTTPS=true` to redirect plain-HTTP requests
  there (301). Requests from inside the container (the health check) and
  `/scep` are not redirected, and nothing is redirected if the HTTPS server
  failed to start.
- Behind a reverse proxy, terminate TLS at the proxy and forward to port 3000.
  The app trusts `X-Forwarded-*` from loopback, link-local and private
  addresses.
- The Content-Security-Policy includes `upgrade-insecure-requests`, so browsers
  load the page's scripts and styles over HTTPS. Reaching the UI over plain HTTP
  from another machine (for example `http://192.168.1.20:3000`) can leave the
  page unstyled. Use HTTPS or a proxy in that case.

## Operations

```bash
docker compose logs -f              # logs (generated passwords, errors)
docker compose pull && docker compose up -d   # update to the latest image
docker compose exec mkcert-web-ui sh          # shell in the container
docker compose exec mkcert-web-ui mkcert -CAROOT
```

Back up a volume (repeat for `mkcert_data`, `mkcert_config` and `mkcert_ca`;
compose prefixes volume names with the project name, see `docker volume ls`):

```bash
docker run --rm -v mkcertweb_mkcert_certificates:/data -v "$PWD":/backup alpine \
  tar czf /backup/certificates.tar.gz -C /data .
```

The `mkcert_ca` volume contains the CA private key. Store its backups as
securely as the key itself.

The health check requests `/` every 30 seconds.

## Production checklist

- `ENABLE_AUTH=true` with a strong `AUTH_PASSWORD` (or `AUTH_PASSWORD_HASH`)
  and a `SESSION_SECRET`.
- HTTPS, either `ENABLE_HTTPS=true` or a TLS-terminating proxy.
- All four volumes mounted and backed up.
- Don't expose the UI to the internet with authentication off.
- Pull updates regularly. The Docker Hub image is published with each release
  (`docker-build-push.sh`). CI also publishes `ghcr.io/jeffcaldwellca/mkcertweb`,
  whose `:latest` is rebuilt from `main` every week to pick up base-image patches.
