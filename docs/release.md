# Release (hot sales)

Operator walkthrough of hot-sequence Release. This is not stay-in-touch. That is [stay-in-touch.md](stay-in-touch.md).

Nothing Postmarks until you turn send on. `POSTMARK_SEND_ENABLED` stays false until you say otherwise. Saving Applicant mail does not enroll anyone. Existing tagged people stay on hold.

## What it is

**Release** is an admin override for a hot sales sequence waiting on `pending_review`. It is not stay-in-touch.

| Where | What you click |
| --- | --- |
| Home | Todo “Release hot sequence” |
| Contact page | **Release** next to “Hot sequence waiting — no email until released” |

Members see the wait state. Only admin can Release.

## Who this applies to

The worker scores them and writes one campaign tag. Recruiters get none. Suppression always wins.

| Situation | Tag | Mail engine |
| --- | --- | --- |
| On Allocation / Incubator with a live stage, not stay-in-touch, not suppressed | `rl.v1.sales.{program}.{stage}.{cold\|lukewarm\|warm\|hot}` | Sales templates. Up to two touches on start. Hot starts wait for Release. |
| No program track yet | `rl.v1.sales.unknown.none.soft` | Soft sales copy only. Set program after they applied. |

Closed-pipeline stay-in-touch people are on the keep-warm loop. See [stay-in-touch.md](stay-in-touch.md).

## How a sales email enrolls

1. Save Allocation / Incubator stage copy on Settings → Applicant mail. Empty skips.
2. Score moves intensity up, or they enter a new program+stage. That plans **start**. Same intensity **holds**. Down **stops** and cancels leftover touches.
3. Hot does not start. It becomes `pending_review`. Home shows “Release hot sequence”. Admin **Release** turns that into start and enrolls at most two touches.
4. Worker drain claims `queued → sending`, then Postmark — only if send is on. From is `hello@mail.realmlabs.co`. Reply-To is the owner, or Stefano if none.
5. An inbound reply after enroll cancels leftover touches.

There is no bulk Release. Boards group by stage. Enrollment is per person.

## What you do this week

| Step | Where | Sends mail? |
| --- | --- | --- |
| Write Allocation / Incubator stage copy | Settings → Applicant mail | No |
| Leave people on hold / don’t Release hot contacts | Contact page or Home | No |
| Keep `POSTMARK_SEND_ENABLED` false | Server `.env` | No. Queue is not send. |
| When you say send: turn the flag on, then Release or let a non-hot start enroll | You tell us; then per-contact Release for hot | Yes, only for enrolled people with non-empty copy |
