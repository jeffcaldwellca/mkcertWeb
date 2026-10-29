# SCEP

mkcert Web UI includes a small SCEP (Simple Certificate Enrollment Protocol,
RFC 8894) server. SCEP clients can fetch the CA certificate and enroll for
certificates signed by the mkcert root CA. It is meant for
development and test networks; it has no revocation (CRL/OCSP) and keeps
challenge passwords in memory.

![SCEP page](screenshots/scep.png)

## Endpoints

The protocol endpoint is `/scep` on the same port as the UI. It needs no login
and is exempt from CSRF.

| Request | Response |
|---|---|
| `GET /scep?operation=GetCACaps` | `text/plain`: `Renewal`, `SHA-256`, `AES` (SHA-1 and DES3 are not offered) |
| `GET /scep?operation=GetCACert` | The mkcert root CA certificate, DER-encoded, `application/x-x509-ca-cert` |
| `POST /scep?operation=PKIOperation` | A PKCS#7 `CertRep` (`application/x-pki-message`) |

`PKIOperation` accepts the PKCS#7 message as the raw request body
(`Content-Type: application/x-pki-message` or `application/octet-stream`) or as
a multipart field named `message`, up to 10 MB. For each request the server:

1. decrypts the request with the mkcert CA key and reads the CSR, transaction
   ID, nonce and challenge password;
2. checks the challenge password: it must match an unexpired, unused challenge,
   and is marked used on success. With `SCEP_ALLOW_OPEN_ENROLLMENT=true`, a
   request without a password is accepted;
3. checks every CN, DNS name and IP in the CSR. Each must be a valid hostname or
   IP and, if `SCEP_ALLOWED_DOMAINS` is set, match one of its suffixes;
4. signs the CSR with the mkcert root CA (`openssl x509 -req`, SHA-256,
   825 days) and returns it in a signed, encrypted `CertRep`.

A rejected request gets a `CertRep` failure (`badRequest`, or `badCertId` when
the CSR's names are refused). If the CA files can't be read the response is an
empty 500. Certificates issued this way are returned to the client only; they
are not saved under `certificates/`.

The rate limit is the `api` tier for `GET /scep` and the `cli` tier (10 per
15 minutes by default) for `POST /scep`.

### Configuration

| Variable | Default | Effect |
|---|---|---|
| `SCEP_ALLOW_OPEN_ENROLLMENT` | `false` | Accept enrollment requests that carry no challenge password. Anyone who can reach `/scep` could then get a certificate trusted by every machine that trusts the mkcert CA. |
| `SCEP_ALLOWED_DOMAINS` | empty (any valid name) | Comma-separated name suffixes, e.g. `dev.local,test`. IPs must be listed exactly. |

## The SCEP page

- **Left pane:** the service URL, GetCACert and GetCACaps URLs (with copy
  buttons), enterprise CA status, and the certificate templates.
- **challenges:** create a challenge password for an identifier with a TTL of
  1h, 2h, 24h or 7d. The password is shown once, in a banner; the list shows each
  challenge's state and time left, and expired ones disappear. Challenges live in
  memory, so a restart clears them.
- **issued:** certificates under `certificates/scep/`.
- **manual enroll:** generate a certificate through the SCEP workflow without a
  device, choosing a template (`User`, `M365User`, `Computer`, `WiFi`), an
  optional UPN (required for `M365User`) and extra names. The optional challenge
  password field is passed to the server but not checked.
- **mdm setup:** the values an MDM profile needs.

The management API behind the page is listed in [API.md](API.md#scep).

## Manual enrollment and the enterprise CA

`POST /api/scep/certificate` (the **manual enroll** tab) writes a key and
certificate to `certificates/scep/<common name>/`. By default it runs mkcert
with the mkcert root CA. If `ENTERPRISE_CA_ENABLED=true` and both CA files
exist, it signs with that CA instead, using the template's key usages:

| Variable | Default |
|---|---|
| `ENTERPRISE_CA_ENABLED` | `false` |
| `ENTERPRISE_CA_CERT_PATH`, `ENTERPRISE_CA_KEY_PATH` | — (both required) |
| `ENTERPRISE_CA_CHAIN_PATH` | — |
| `ENTERPRISE_CA_DEFAULT_TEMPLATE` | `User` |
| `ENTERPRISE_CA_M365_TEMPLATE` | `M365User` |
| `ENTERPRISE_CA_VALIDITY_DAYS` | `365` |
| `ENTERPRISE_CA_KEY_SIZE` | `2048` |
| `ENTERPRISE_CA_HASH_ALGORITHM` | `sha256` |

The enterprise CA path runs `openssl … -CAcreateserial`, which writes a `.srl`
file next to the CA certificate, so that directory must be writable (under the
systemd unit, add it to `ReadWritePaths`).

These certificates appear on the certificates page under READ-ONLY (folder
`scep`). The per-certificate routes don't accept that folder, so they can be
viewed but not downloaded, archived or deleted from the UI.

## Client configuration

Generate a challenge password on the **challenges** tab, then point the client
at `http://<server>:3000/scep` (or the HTTPS port).

- **Apple devices:** [`examples/ios-scep-profile.mobileconfig`](../examples/ios-scep-profile.mobileconfig)
  is a profile template. Replace `YOUR_SERVER_IP`, `YOUR_DEVICE_NAME` and
  `YOUR_CHALLENGE_PASSWORD_HERE`, and give both `PayloadUUID`s fresh values
  (`uuidgen`) before installing it.
- **Other clients** (for example `sscep`, or an MDM profile that takes a fixed
  challenge): use the SCEP URL, the challenge password, a 2048-bit RSA key and
  SHA-256.

### Compatibility

Works with standard SCEP clients that use a static challenge password: the
client is given a challenge from the **challenges** tab and sends it in its
request. Each challenge works for one enrollment, so every device needs its own.

MDMs that issue a fresh challenge per device, such as Microsoft Intune, expect
the SCEP server to sit behind NDES (Microsoft's Network Device Enrollment
Service) or to offer a challenge-validation API the MDM can call. This server
provides neither, so it can't be plugged into Intune (or a similar dynamic
challenge flow) as its certificate authority.

Clients must trust the mkcert root CA to use the issued certificates; it can be
downloaded from the root-ca page or with `GetCACert`.

## Testing from the command line

```bash
curl "http://localhost:3000/scep?operation=GetCACaps"
curl -o ca.der "http://localhost:3000/scep?operation=GetCACert"
openssl x509 -inform DER -in ca.der -noout -subject

# with a PKCS#7 request built by a SCEP client (for example sscep)
curl -X POST -H 'Content-Type: application/x-pki-message' \
  --data-binary @request.p7 -o response.p7 \
  "http://localhost:3000/scep?operation=PKIOperation"
```

## Known issues

- Manual enrollment with extra names or a UPN makes mkcert name the files
  `<common name>+<n>.pem`, so the **issued** tab (which looks for
  `<common name>.pem`) doesn't list them.
- `GET /api/scep/enterprise-ca/status` always reports the enterprise CA as
  disabled, even when `ENTERPRISE_CA_*` is set and manual enrollment uses it.

## Code

- `src/routes/scep.js`: the `/scep` endpoint and the management API.
- `src/utils/pkcs7.js`: PKCS#7 parsing and `CertRep` building (node-forge),
  challenge checks, CSR name checks.
- `src/utils/scep.js` and `src/utils/enterpriseCA.js`: manual enrollment.
