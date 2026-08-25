import type {
  Activity,
  AllocationCard,
  EmailThread,
  IncubatorCard,
  Meeting,
  Person,
  User,
} from "@realm-labs/contracts";
import {
  activities,
  allocationCards,
  emailThreads,
  incubatorCards,
  meetings,
  people,
  users,
} from "@realm-labs/db";

type UserRow = typeof users.$inferSelect;
type PersonRow = typeof people.$inferSelect;
type AllocationCardRow = typeof allocationCards.$inferSelect;
type IncubatorCardRow = typeof incubatorCards.$inferSelect;
type MeetingRow = typeof meetings.$inferSelect;
type ActivityRow = typeof activities.$inferSelect;
type EmailThreadRow = typeof emailThreads.$inferSelect;

export function serializeUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    googleSub: row.googleSub,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toIso(value: Date): string {
  return value.toISOString();
}

function serializeResumeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export function serializePerson(row: PersonRow): Person {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    title: row.title,
    company: row.company,
    location: row.location,
    source: row.source,
    resumeUrl: serializeResumeUrl(row.resumeUrl),
    appliedAt: row.appliedAt,
    notes: row.notes,
    leadTemp: row.leadTemp,
    budgetQualified: row.budgetQualified,
    doNotContact: row.doNotContact,
    ownerId: row.ownerId,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    deletedAt: row.deletedAt ? toIso(row.deletedAt) : null,
  };
}

export function serializeAllocationCard(row: AllocationCardRow): AllocationCard {
  return {
    id: row.id,
    personId: row.personId,
    stage: row.stage,
    decision: row.decision,
    decidedAt: row.decidedAt ? toIso(row.decidedAt) : null,
    decidedBy: row.decidedBy,
    passReason: row.passReason,
    nurtureFollowUpAt: row.nurtureFollowUpAt,
    noCallAppLink: row.noCallAppLink,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function serializeIncubatorCard(row: IncubatorCardRow): IncubatorCard {
  return {
    id: row.id,
    personId: row.personId,
    stage: row.stage,
    tier: row.tier,
    priceUsd: row.priceUsd,
    applicationRef: row.applicationRef,
    applicationResult: row.applicationResult,
    routingDetail: row.routingDetail,
    routedAt: toIso(row.routedAt),
    closeReason: row.closeReason,
    closedAt: row.closedAt ? toIso(row.closedAt) : null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function serializeMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    personId: row.personId,
    scheduledAt: toIso(row.scheduledAt),
    calendarEventId: row.calendarEventId,
    outcome: row.outcome,
    needsReview: row.needsReview,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function serializeActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    personId: row.personId,
    userId: row.userId,
    type: row.type,
    payload: row.payload,
    occurredAt: toIso(row.occurredAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function serializeEmailThread(row: EmailThreadRow): EmailThread {
  return {
    id: row.id,
    personId: row.personId,
    mailbox: row.mailbox,
    gmailThreadId: row.gmailThreadId,
    subject: row.subject,
    lastMessageAt: toIso(row.lastMessageAt),
    snippet: row.snippet,
    participantEmails: row.participantEmails,
    sharedVisible: row.sharedVisible,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function stageAfterFromPayload(
  payload: Record<string, unknown>,
): unknown {
  const after = payload.after;
  if (!after || typeof after !== "object" || Array.isArray(after)) {
    return undefined;
  }
  return (after as { stage?: unknown }).stage;
}
