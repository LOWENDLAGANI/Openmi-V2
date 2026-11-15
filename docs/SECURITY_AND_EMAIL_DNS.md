# DNS records the app cannot set itself

Two findings from the scan are **not** application code: SPF and DMARC are TXT
records published at the DNS host for `openmi.space`. Nothing in this repository
can create them, and no header in `next.config.mjs` substitutes for them. This
file is the exact set to add, with the reasoning, so the change is one visit to
the DNS host and not a research project.

Publish them at the same place the domain's other records live (Cloudflare DNS,
Vercel DNS, the registrar). All are **DNS only** — do not proxy a `CNAME` through
Cloudflare's orange cloud, or verification will never complete.

## 1. SPF for the apex (`openmi.space`)

SPF is a TXT record that lists the servers allowed to send mail with this
domain in the envelope sender. Without one, any host on the internet can send
mail that claims to be from `support@openmi.space`.

The value depends on what actually sends mail **from the apex**. Pick one:

| What sends as `@openmi.space` | TXT value at `@` |
| --- | --- |
| Nothing (mail only goes through Resend's `send` subdomain, see §3) | `v=spf1 -all` |
| Google Workspace / Gmail | `v=spf1 include:_spf.google.com ~all` |
| Microsoft 365 | `v=spf1 include:spf.protection.outlook.com ~all` |
| Fastmail | `v=spf1 include:spf.messagingengine.com ~all` |

- Host/name: `@` (or `openmi.space`)
- Type: `TXT`
- TTL: default

**Only one SPF record may exist at a host.** If a TXT record starting
`v=spf1` is already there, merge the includes into it rather than adding a
second record — two SPF records make receivers fail the check entirely.

`-all` (hard fail) is the strict form and is right when the apex sends nothing.
`~all` (soft fail) is the safer choice while you are still discovering which
services send for the domain.

## 2. DMARC (`_dmarc.openmi.space`)

DMARC is the policy that tells Gmail, Outlook and Apple Mail what to do when a
message claiming to be from the domain fails SPF **and** DKIM, and where to send
reports. SPF and DKIM alone do not stop spoofing; DMARC is the instruction that
uses them.

| Host/name | Type | Value |
| --- | --- | --- |
| `_dmarc` | `TXT` | `v=DMARC1; p=quarantine; rua=mailto:support@openmi.space; adkim=r; aspf=r; pct=100; fo=1` |

Start at `p=none` instead of `p=quarantine` if you have never collected reports
for this domain — it still asks receivers to report, and does not quarantine
anything while you confirm legitimate mail passes:

```
_dmarc.openmi.space  TXT  "v=DMARC1; p=none; rua=mailto:support@openmi.space; fo=1"
```

After a week or two of clean reports, raise it to `p=quarantine`, then
`p=reject`. `p=reject` is the strongest setting and is what the scan is looking
for in the long run.

The `rua` mailbox receives aggregate XML reports from every large receiver.
`support@openmi.space` is used here because it is the address the app already
publishes; change it to a dedicated inbox if the volume is noisy.

## 3. Resend (outbound transactional mail)

Resend sends through Amazon SES and verifies a domain with three records on the
**sending subdomain**, plus DKIM. The values are generated per domain — copy the
literal strings from Resend → Domains → Records; do not retype them from any
guide, including this one. The shape is:

| Purpose | Type | Host | Value |
| --- | --- | --- | --- |
| Bounces / complaints (Return-Path) | `MX` | `send` | `feedback-smtp.<region>.amazonses.com`, priority `10` |
| SPF for the sending subdomain | `TXT` | `send` | `v=spf1 include:amazonses.com ~all` |
| DKIM | `TXT` or `CNAME` | `resend._domainkey` | the public key Resend shows |
| Click/open tracking (optional) | `CNAME` | `links` | `links1.resend-dns.com` |

If Resend was added with a subdomain (e.g. `mail.openmi.space`), the hosts nest
under it (`send.mail`, `resend._domainkey.mail`) and the apex SPF in §1 stays as
it is.

The sending subdomain has its own SPF; it must be the only `SPF`/`MX` pair on
that name. Do not add `include:_spf.resend.com` to the apex — Resend's SPF lives
on `send`, and an apex include spends a lookup for nothing.

## 4. Verify

```bash
dig +short TXT  openmi.space
dig +short TXT  _dmarc.openmi.space
dig +short TXT  send.openmi.space
dig +short MX   send.openmi.space
dig +short TXT  resend._domainkey.openmi.space
```

Expected: exactly one `v=spf1` string at the apex, one `v=DMARC1` string at
`_dmarc`, the Resend SPF and one MX at `send`, and a `p=` DKIM key. A lookup
that returns nothing means the record is missing or is still propagating; DNS
changes can take up to 72 hours, though most resolve in minutes.

## 5. HSTS preload (optional, after the header is live)

`next.config.mjs` sends
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
`includeSubDomains` covers every name under `openmi.space` for two years, so
confirm that every subdomain — including `send` and any preview host — serves
HTTPS before submitting the domain at <https://hstspreload.org/>. Submitting is
a one-way door: browsers ship the list for years.

The header alone already fixes the scan's finding. Preload submission only adds
the browser-built-in list, and can be done later.
