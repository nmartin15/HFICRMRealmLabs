# Stay-in-touch mail

Operator walkthrough of closed-pipeline keep-warm. This is not a newsletter. Newsletter is later. This is not the hot **Release** button. That is [release.md](release.md).

Nothing Postmarks until you turn send on. `POSTMARK_SEND_ENABLED` stays false until you say otherwise. Saving Applicant mail does not enroll anyone.

## What it is

Close them once. The CRM keeps emailing the Closed-pipeline stay-in-touch copy every **90 days** until they opt out, get Do not contact, or come back onto a live board.

There is no newsletter grant. Website inquiry is enough. Recruiters never get this.

## Who gets this lane

The worker writes one campaign tag. Suppression always wins. Unchecking **Stay in touch mail** on the contact opts them out without DNC.

| Situation | Tag | Mail |
| --- | --- | --- |
| Closed stage (passed, allocated, approved, rejected) | `rl.v1.newsletter.none.none.none` | Stay-in-touch template. First send on start, then every 90 days. |
| `stay_in_touch` consent (sales blocked) | Same tag | Same loop. Sales copy never sends. |
| Stay in touch mail unchecked, DNC, unsubscribed (sales mail), or recruiter | No tag | No campaign mail. |

Live Allocation / Incubator people without stay-in-touch consent stay on **sales** tags. See [release.md](release.md).

## How it enrolls

1. Save **Closed-pipeline stay-in-touch** copy on Settings → Applicant mail. Empty skips.
2. They leave sales: closed board stage, or `stay_in_touch` consent, or other sales block.
3. Tag start enrolls one send now. After it actually sends, the next one is due in 90 days. Same intensity holds. Down or a live-board return stops and cancels leftover touches.
4. **Them:** Unsubscribe in the email. That stops stay-in-touch mail and keeps the record. It does not DNC and does not purge.
5. **You:** Uncheck **Stay in touch mail** on the contact to stop the loop and keep working them. **Do not contact** is the nuke (never reach them). Sales-mail Unsubscribe still suppresses and purges.
6. There is no Release button for stay-in-touch. Release is hot sales only.

## What you do this week

| Step | Where | Sends mail? |
| --- | --- | --- |
| Write Closed-pipeline stay-in-touch copy if you want that later | Settings → Applicant mail | No |
| Keep `POSTMARK_SEND_ENABLED` false | Server `.env` | No. Queue is not send. |

From is `hello@mail.realmlabs.co`. Reply-To is the owner, or Stefano if none. An inbound reply after enroll cancels leftover touches.
