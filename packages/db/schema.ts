import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const userRoleEnum = pgEnum("user_role", ["admin", "member"]);
export const personSourceEnum = pgEnum("person_source", [
  "linkedin",
  "workable",
  "referral",
  "other",
]);
export const programTrackEnum = pgEnum("program_track", [
  "allocation",
  "incubator",
  "recruitment",
  "capital_raising",
]);
export const taskKindEnum = pgEnum("task_kind", [
  "email",
  "call",
  "meeting",
  "dnc",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "open",
  "done",
  "rescheduled",
]);
export const leadTempEnum = pgEnum("lead_temp", [
  "cold",
  "lukewarm",
  "warm",
  "hot",
]);
export const budgetQualifiedEnum = pgEnum("budget_qualified", [
  "light",
  "heavy",
  "not_qualified",
  "unknown",
]);
export const allocationStageEnum = pgEnum("allocation_stage", [
  "applied",
  "contacted",
  "in_conversation",
  "decision",
  "allocated",
  "nurture",
  "passed",
]);
export const allocationDecisionEnum = pgEnum("allocation_decision", [
  "allocate",
  "route_incubator",
  "pass",
]);
export const incubatorStageEnum = pgEnum("incubator_stage", [
  "sent",
  "applied",
  "approved",
  "rejected",
]);
export const incubatorTierEnum = pgEnum("incubator_tier", [
  "tier_1",
  "tier_2",
  "tier_3",
  "tier_4",
]);
export const meetingOutcomeEnum = pgEnum("meeting_outcome", [
  "scheduled",
  "held",
  "no_show",
  "rescheduled",
]);
export const mailboxEnum = pgEnum("mailbox", ["personal", "shared"]);
export const activityTypeEnum = pgEnum("activity_type", [
  "note",
  "stage_change",
  "decision",
  "meeting",
  "email",
  "field_change",
  "import",
  "webhook",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  googleSub: text("google_sub").unique(),
  role: userRoleEnum("role").notNull(),
  ...timestamps,
});

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    title: text("title"),
    company: text("company"),
    location: text("location"),
    source: personSourceEnum("source").notNull(),
    resumeUrl: text("resume_url"),
    resumeFilename: text("resume_filename"),
    resumeContentType: text("resume_content_type"),
    appliedAt: date("applied_at", { mode: "string" }),
    notes: text("notes"),
    programTrack: programTrackEnum("program_track"),
    leadTemp: leadTempEnum("lead_temp"),
    budgetQualified: budgetQualifiedEnum("budget_qualified")
      .notNull()
      .default("unknown"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    needsReview: boolean("needs_review").notNull().default(false),
    ownerId: uuid("owner_id").references(() => users.id),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("people_email_unique").on(table.email),
    check("people_email_lowercase", sql`${table.email} = lower(${table.email})`),
  ],
);

export const allocationCards = pgTable("allocation_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id")
    .notNull()
    .unique()
    .references(() => people.id),
  stage: allocationStageEnum("stage").notNull(),
  decision: allocationDecisionEnum("decision"),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
  decidedBy: uuid("decided_by").references(() => users.id),
  passReason: text("pass_reason"),
  nurtureFollowUpAt: date("nurture_follow_up_at", { mode: "string" }),
  noCallAppLink: boolean("no_call_app_link").notNull().default(false),
  ...timestamps,
});

export const incubatorCards = pgTable("incubator_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id")
    .notNull()
    .unique()
    .references(() => people.id),
  stage: incubatorStageEnum("stage").notNull(),
  tier: incubatorTierEnum("tier"),
  priceUsd: integer("price_usd"),
  applicationRef: text("application_ref"),
  applicationResult: text("application_result"),
  routingDetail: text("routing_detail"),
  routedAt: timestamp("routed_at", { withTimezone: true, mode: "date" }).notNull(),
  closeReason: text("close_reason"),
  closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
  ...timestamps,
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    kind: taskKindEnum("kind").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }).notNull(),
    notes: text("notes"),
    status: taskStatusEnum("status").notNull().default("open"),
    calendarEventId: text("calendar_event_id"),
    outcome: meetingOutcomeEnum("outcome"),
    needsReview: boolean("needs_review").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tasks_person_calendar_event_id_unique").on(
      table.personId,
      table.calendarEventId,
    ),
  ],
);

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }).notNull(),
    calendarEventId: text("calendar_event_id"),
    outcome: meetingOutcomeEnum("outcome").notNull().default("scheduled"),
    needsReview: boolean("needs_review").notNull().default(false),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("meetings_person_calendar_event_id_unique").on(
      table.personId,
      table.calendarEventId,
    ),
  ],
);

export const mailboxConnections = pgTable("mailbox_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  mailbox: mailboxEnum("mailbox").notNull().unique(),
  email: text("email").notNull(),
  connectedBy: uuid("connected_by")
    .notNull()
    .references(() => users.id),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  googleSub: text("google_sub"),
  gmailHistoryId: text("gmail_history_id"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "date" }),
  lastError: text("last_error"),
  connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  ...timestamps,
});

export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").references(() => people.id),
    mailbox: mailboxEnum("mailbox").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    subject: text("subject").notNull(),
    lastMessageAt: timestamp("last_message_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    snippet: text("snippet"),
    participantEmails: text("participant_emails").array().notNull(),
    sharedVisible: boolean("shared_visible").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("email_threads_mailbox_gmail_thread_id_unique").on(
      table.mailbox,
      table.gmailThreadId,
    ),
  ],
);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").references(() => people.id),
  userId: uuid("user_id").references(() => users.id),
  type: activityTypeEnum("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
  ...timestamps,
});

export const reportInputs = pgTable("report_inputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodStart: date("period_start", { mode: "string" }).notNull(),
  periodEnd: date("period_end", { mode: "string" }).notNull(),
  linkedinImpressions: integer("linkedin_impressions").notNull(),
  jobPostApplies: integer("job_post_applies").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  ...timestamps,
});

export const usersRelations = relations(users, ({ many }) => ({
  ownedPeople: many(people),
  allocationDecisions: many(allocationCards),
  meetingsCreated: many(meetings),
  tasksCreated: many(tasks),
  activities: many(activities),
  reportInputs: many(reportInputs),
  mailboxConnections: many(mailboxConnections),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  owner: one(users, {
    fields: [people.ownerId],
    references: [users.id],
  }),
  allocationCard: one(allocationCards, {
    fields: [people.id],
    references: [allocationCards.personId],
  }),
  incubatorCard: one(incubatorCards, {
    fields: [people.id],
    references: [incubatorCards.personId],
  }),
  meetings: many(meetings),
  tasks: many(tasks),
  emailThreads: many(emailThreads),
  activities: many(activities),
}));

export const allocationCardsRelations = relations(allocationCards, ({ one }) => ({
  person: one(people, {
    fields: [allocationCards.personId],
    references: [people.id],
  }),
  decidedByUser: one(users, {
    fields: [allocationCards.decidedBy],
    references: [users.id],
  }),
}));

export const incubatorCardsRelations = relations(incubatorCards, ({ one }) => ({
  person: one(people, {
    fields: [incubatorCards.personId],
    references: [people.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  person: one(people, {
    fields: [tasks.personId],
    references: [people.id],
  }),
  createdByUser: one(users, {
    fields: [tasks.createdBy],
    references: [users.id],
  }),
}));

export const meetingsRelations = relations(meetings, ({ one }) => ({
  person: one(people, {
    fields: [meetings.personId],
    references: [people.id],
  }),
  createdByUser: one(users, {
    fields: [meetings.createdBy],
    references: [users.id],
  }),
}));

export const emailThreadsRelations = relations(emailThreads, ({ one }) => ({
  person: one(people, {
    fields: [emailThreads.personId],
    references: [people.id],
  }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  person: one(people, {
    fields: [activities.personId],
    references: [people.id],
  }),
  user: one(users, {
    fields: [activities.userId],
    references: [users.id],
  }),
}));

export const reportInputsRelations = relations(reportInputs, ({ one }) => ({
  createdByUser: one(users, {
    fields: [reportInputs.createdBy],
    references: [users.id],
  }),
}));

export const mailboxConnectionsRelations = relations(
  mailboxConnections,
  ({ one }) => ({
    connectedByUser: one(users, {
      fields: [mailboxConnections.connectedBy],
      references: [users.id],
    }),
  }),
);
