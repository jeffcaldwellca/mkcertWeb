# Running under systemd

`mkcert-web-ui.service` runs the app directly on a Linux host (without Docker)
as `www-data`, with the code tree read-only to the service.

Requirements: Node.js 22 or later at `/usr/bin/node`, `mkcert` and `openssl` on
the `PATH`.

## Install

```bash
# 1. Code owned by root; the service can't modify it
sudo git clone https://github.com/jeffcaldwellca/mkcertWeb.git /opt/mkcert-web-ui
cd /opt/mkcert-web-ui
sudo npm ci --omit=dev

# 2. The directories the app writes to, owned by the service user.
#    systemd refuses to start the unit if any of them is missing.
sudo install -d -o www-data -g www-data certificates config data ssl

# 3. Install and start the unit
sudo cp deploy/mkcert-web-ui.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mkcert-web-ui
```

Configuration goes in `Environment=` lines (`sudo systemctl edit mkcert-web-ui`)
or in `/opt/mkcert-web-ui/.env`, which the app reads at startup (it holds
secrets: `sudo chown root:www-data .env && sudo chmod 0640 .env`). See
[`.env.example`](../.env.example). The unit sets `NODE_ENV=production`,
`PORT=3000`, `ENABLE_HTTPS=true`, `HTTPS_PORT=3443` and `SSL_DOMAIN=localhost`.

## What the unit allows

- `ProtectSystem=strict`: the whole filesystem is read-only to the service
  except the paths below. `ProtectHome=yes` hides home directories.
- `ReadWritePaths`: `certificates/` (all certificates, PFX exports, the CA copy
  for download), `config/` (`settings.json`), `data/` (certificate notes) and
  `ssl/` (the HTTPS certificate) under `/opt/mkcert-web-ui`.
- `StateDirectory=mkcert-web-ui` with `CAROOT=/var/lib/mkcert-web-ui/ca`: the
  root CA lives outside the code tree, so redeploying the code never touches it.
- `PrivateTmp=yes`: upload staging and PFX password files stay in a private
  `/tmp`.
- `NoNewPrivileges=yes`.

Because the service can't write the system trust store, the **install** button
on the root-ca page fails under this unit; install the CA certificate
(`mkcert-rootCA.pem`, downloaded from the root-ca page) on client
machines instead.

## Upgrading from a unit that kept the CA in the service user's home

Older units let mkcert keep the CA under the service user's home (for
`www-data`, `/var/www/.local/share/mkcert`). Before restarting with this unit,
copy it to the new location, or mkcert will create a new CA and clients that
trust the old one will reject every certificate issued afterwards:

```bash
sudo install -d -o www-data -g www-data -m 0700 /var/lib/mkcert-web-ui/ca
sudo cp /var/www/.local/share/mkcert/rootCA.pem /var/www/.local/share/mkcert/rootCA-key.pem /var/lib/mkcert-web-ui/ca/
sudo chown www-data:www-data /var/lib/mkcert-web-ui/ca/rootCA*.pem
sudo chmod 0400 /var/lib/mkcert-web-ui/ca/rootCA-key.pem
```

Also create the runtime directories (step 2 above) if the old install didn't
have them.

## Enterprise CA

With `ENTERPRISE_CA_ENABLED=true`, SCEP manual enrollment signs with
`openssl … -CAcreateserial`, which writes a `.srl` file next to
`ENTERPRISE_CA_CERT_PATH`. Add that directory to `ReadWritePaths`, or
enrollment fails.
