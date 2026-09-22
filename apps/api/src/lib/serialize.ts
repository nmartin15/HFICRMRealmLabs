import type {
  Activity,
  AllocationCard,
  EmailMessage,
  EmailThread,
  EmailThreadWithMessages,
  IncubatorCard,
  Meeting,
  Person,
  RecruiterSpecialty,
  SourceRecruiter,
  Task,
  User,
} from "@realm-labs/contracts";
import { emailMessageDirection } from "@realm-labs/contracts";
import {
  activities,
  allocationCards,
  emailMessages,
  emailThreads,
  incubatorCards,
  meetings,
  people,
  tasks,
  users,
} from "@realm-labs/db";

type UserRow = typeof users.$inferSelect;
type PersonRow = typeof people.$inferSelect;
type AllocationCardRow = typeof allocationCards.$inferSelect;
type IncubatorCardRow = typeof incubatorCards.$inferSelect;
type MeetingRow = typeof meetings.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type ActivityRow = typeof activities.$inferSelect;
type EmailThreadRow = typeof emailThreads.$inferSelect;
type EmailMessageRow = typeof emailMessages.$inferSelect;

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
  if (value.startsWith("/")) {
    return value;
  }
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export type SourceRecruiterRow = {
  id: string;
  firstName: string;
  lastName: string;
  recruiterSpecialty: RecruiterSpecialty | null;
};

export function serializeSourceRecruiter(
  row: SourceRecruiterRow | null | undefined,
): SourceRecruiter | null {
  if (!row || !row.recruiterSpecialty) {
    return null;
  }
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    recruiterSpecialty: row.recruiterSpecialty,
  };
}

export function serializePerson(
  row: PersonRow,
  sourceRecruiter: SourceRecruiterRow | null = null,
): Person {
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
    resumeFilename: row.resumeFilename,
    resumeContentType: row.resumeContentType,
    appliedAt: row.appliedAt,
    notes: row.notes,
    programTrack: row.programTrack,
    programInterest: row.programInterest,
    leadTemp: row.leadTemp,
    budgetQualified: row.budgetQualified,
    score: row.score,
    doNotContact: row.doNotContact,
    stayInTouchOptedOut: row.stayInTouchOptedOut,
    needsReview: row.needsReview,
    contactKind: row.contactKind,
    recruiterSpecialty: row.recruiterSpecialty,
    sourceRecruiterId: row.sourceRecruiterId,
    sourceRecruiter: serializeSourceRecruiter(sourceRecruiter),
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

export function serializeTask(row: TaskRow): Task {
  return {
    id: row.id,
    personId: row.personId,
    kind: row.kind,
    dueAt: toIso(row.dueAt),
    notes: row.notes,
    status: row.status,
    calendarEventId: row.calendarEventId,
    outcome: row.outcome,
    needsReview: row.needsReview,
    createdBy: row.createdBy,
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

export function serializeMeetingFromTask(row: TaskRow): Meeting {
  return {
    id: row.id,
    personId: row.personId,
    scheduledAt: toIso(row.dueAt),
    calendarEventId: row.calendarEventId,
    outcome: row.outcome ?? "scheduled",
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

export function serializeEmailMessage(
  row: EmailMessageRow,
  personEmail: string | null,
  extras?: {
    personEmails?: readonly string[];
    threadMatched?: boolean;
  },
): EmailMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    gmailMessageId: row.gmailMessageId,
    fromEmail: row.fromEmail,
    toEmails: row.toEmails,
    ccEmails: row.ccEmails,
    sentAt: toIso(row.sentAt),
    bodyText: row.bodyText,
    snippet: row.snippet,
    direction: emailMessageDirection({
      fromEmail: row.fromEmail,
      personEmail,
      personEmails: extras?.personEmails,
      toEmails: row.toEmails,
      ccEmails: row.ccEmails,
      threadMatched: extras?.threadMatched ?? Boolean(personEmail),
    }),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function serializeEmailThreadWithMessages(
  row: EmailThreadRow,
  messages: readonly EmailMessageRow[],
  personEmail: string | null,
  personEmails?: readonly string[],
): EmailThreadWithMessages {
  const sorted = [...messages].sort(
    (a, b) => a.sentAt.getTime() - b.sentAt.getTime(),
  );
  return {
    ...serializeEmailThread(row),
    messages: sorted.map((message) =>
      serializeEmailMessage(message, personEmail, {
        personEmails,
        threadMatched: Boolean(row.personId),
      }),
    ),
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
