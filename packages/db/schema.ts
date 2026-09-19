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
  index,
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
  "website",
]);
export const programTrackEnum = pgEnum("program_track", [
  "allocation",
  "incubator",
  "recruitment",
  "capital_raising",
]);
export const programInterestEnum = pgEnum("program_interest", [
  "hedge_fund_incubator",
  "lp_raising_program",
  "quant_analyst_placement",
  "not_sure",
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
export const mailboxEnum = pgEnum("mailbox", ["personal", "partner"]);
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
export const suppressionReasonEnum = pgEnum("suppression_reason", [
  "unsubscribed",
  "complained",
  "hard_bounced",
  "do_not_contact",
  "rejected",
  "enrolled",
]);
export const consentChannelEnum = pgEnum("consent_channel", [
  "inquiry",
  "newsletter",
  "stay_in_touch",
]);
export const consentStatusEnum = pgEnum("consent_status", [
  "granted",
  "withdrawn",
]);
export const consentSourceEnum = pgEnum("consent_source", [
  "website_form",
  "operator",
  "import",
  "email_link",
]);
export const personSignalKindEnum = pgEnum("person_signal_kind", [
  "aum_or_budget",
  "warmth",
  "decision_timeline",
  "program_fit",
  "objection",
  "other",
]);
export const personSignalSourceEnum = pgEnum("person_signal_source", [
  "email_message",
  "task",
  "meeting",
  "activity_note",
  "website_lead",
  "import",
  "operator",
]);
export const personEmailSourceEnum = pgEnum("person_email_source", [
  "thread",
  "manual",
]);
export const campaignLaneEnum = pgEnum("campaign_lane", ["sales", "newsletter"]);
export const campaignIntensityEnum = pgEnum("campaign_intensity", [
  "none",
  "soft",
  "cold",
  "lukewarm",
  "warm",
  "hot",
]);
export const campaignSequenceActionEnum = pgEnum("campaign_sequence_action", [
  "start",
  "stop",
  "hold",
  "pending_review",
]);
export const outboundSendPurposeEnum = pgEnum("outbound_send_purpose", [
  "sales",
  "newsletter",
  "value_add",
]);
export const outboundSendStatusEnum = pgEnum("outbound_send_status", [
  "queued",
  "blocked",
  "sending",
  "sent",
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
    programInterest: programInterestEnum("program_interest"),
    leadTemp: leadTempEnum("lead_temp"),
    budgetQualified: budgetQualifiedEnum("budget_qualified")
      .notNull()
      .default("unknown"),
    score: integer("score"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    needsReview: boolean("needs_review").notNull().default(false),
    emailVerificationResult: text("email_verification_result"),
    emailVerifiedAt: timestamp("email_verified_at", {
      withTimezone: true,
      mode: "date",
    }),
    ownerId: uuid("owner_id").references(() => users.id),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("people_email_unique").on(table.email),
    check("people_email_lowercase", sql`${table.email} = lower(${table.email})`),
    check(
      "people_score_range",
      sql`${table.score} is null or (${table.score} >= 0 and ${table.score} <= 100)`,
    ),
  ],
);

export const personEmails = pgTable(
  "person_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    source: personEmailSourceEnum("source").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("person_emails_email_unique").on(table.email),
    index("person_emails_person_id_idx").on(table.personId),
    check(
      "person_emails_email_lowercase",
      sql`${table.email} = lower(${table.email})`,
    ),
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
    attendeeAccepted: boolean("attendee_accepted").notNull().default(false),
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
    attendeeAccepted: boolean("attendee_accepted").notNull().default(false),
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

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id),
    gmailMessageId: text("gmail_message_id").notNull(),
    fromEmail: text("from_email").notNull(),
    toEmails: text("to_emails").array().notNull(),
    ccEmails: text("cc_emails").array().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }).notNull(),
    bodyText: text("body_text").notNull(),
    snippet: text("snippet"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("email_messages_thread_gmail_message_id_unique").on(
      table.threadId,
      table.gmailMessageId,
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

export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailHash: text("email_hash").notNull(),
    reason: suppressionReasonEnum("reason").notNull(),
    source: text("source").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    purgedAt: timestamp("purged_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [uniqueIndex("email_suppressions_email_hash_unique").on(table.emailHash)],
);

export const emailHashKeyState = pgTable(
  "email_hash_key_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: text("fingerprint").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("email_hash_key_state_fingerprint_unique").on(table.fingerprint)],
);

export const emailSuppressionEvents = pgTable("email_suppression_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  suppressionId: uuid("suppression_id")
    .notNull()
    .references(() => emailSuppressions.id),
  emailHash: text("email_hash").notNull(),
  reason: suppressionReasonEnum("reason").notNull(),
  source: text("source").notNull(),
  occurredAt: timestamp("occurred_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});

export const personConsents = pgTable(
  "person_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    channel: consentChannelEnum("channel").notNull(),
    status: consentStatusEnum("status").notNull(),
    source: consentSourceEnum("source").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }),
    withdrawnAt: timestamp("withdrawn_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("person_consents_person_id_channel_unique").on(
      table.personId,
      table.channel,
    ),
  ],
);

export const personConsentEvents = pgTable("person_consent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").references(() => people.id, {
    onDelete: "set null",
  }),
  emailHash: text("email_hash").notNull(),
  channel: consentChannelEnum("channel").notNull(),
  status: consentStatusEnum("status").notNull(),
  source: consentSourceEnum("source").notNull(),
  occurredAt: timestamp("occurred_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  ...timestamps,
});

export const personSignals = pgTable(
  "person_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: personSignalKindEnum("kind").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    excerpt: text("excerpt"),
    sourceType: personSignalSourceEnum("source_type").notNull(),
    sourceEmailMessageId: uuid("source_email_message_id").references(
      () => emailMessages.id,
      { onDelete: "cascade" },
    ),
    sourceTaskId: uuid("source_task_id").references(() => tasks.id, {
      onDelete: "cascade",
    }),
    sourceMeetingId: uuid("source_meeting_id").references(() => meetings.id, {
      onDelete: "cascade",
    }),
    sourceActivityId: uuid("source_activity_id").references(() => activities.id, {
      onDelete: "cascade",
    }),
    extractor: text("extractor").notNull(),
    invalidatedAt: timestamp("invalidated_at", {
      withTimezone: true,
      mode: "date",
    }),
    invalidatedBy: uuid("invalidated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    check(
      "person_signals_source_fk",
      sql`(
        (${table.sourceType} in ('operator', 'import', 'website_lead')
          and ${table.sourceEmailMessageId} is null
          and ${table.sourceTaskId} is null
          and ${table.sourceMeetingId} is null
          and ${table.sourceActivityId} is null)
        or (${table.sourceType} = 'email_message'
          and ${table.sourceEmailMessageId} is not null
          and ${table.sourceTaskId} is null
          and ${table.sourceMeetingId} is null
          and ${table.sourceActivityId} is null)
        or (${table.sourceType} = 'task'
          and ${table.sourceEmailMessageId} is null
          and ${table.sourceTaskId} is not null
          and ${table.sourceMeetingId} is null
          and ${table.sourceActivityId} is null)
        or (${table.sourceType} = 'meeting'
          and ${table.sourceEmailMessageId} is null
          and ${table.sourceTaskId} is null
          and ${table.sourceMeetingId} is not null
          and ${table.sourceActivityId} is null)
        or (${table.sourceType} = 'activity_note'
          and ${table.sourceEmailMessageId} is null
          and ${table.sourceTaskId} is null
          and ${table.sourceMeetingId} is null
          and ${table.sourceActivityId} is not null)
      )`,
    ),
  ],
);

export const scoreFormulaConfigs = pgTable(
  "score_formula_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: text("version").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [uniqueIndex("score_formula_configs_version_unique").on(table.version)],
);

export const personScoreSnapshots = pgTable("person_score_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  formulaVersion: text("formula_version").notNull(),
  score: integer("score").notNull(),
  bucket: leadTempEnum("bucket").notNull(),
  rawBucket: leadTempEnum("raw_bucket").notNull(),
  hold: jsonb("hold").$type<Record<string, unknown> | null>(),
  asOf: timestamp("as_of", { withTimezone: true, mode: "date" }).notNull(),
  trigger: text("trigger").notNull(),
  components: jsonb("components").$type<Record<string, unknown>[]>().notNull(),
  inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
  computedAt: timestamp("computed_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  computedBy: uuid("computed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  ...timestamps,
}, (table) => [
  check(
    "person_score_snapshots_score_range",
    sql`${table.score} >= 0 and ${table.score} <= 100`,
  ),
]);

export const personCampaignTags = pgTable(
  "person_campaign_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    tag: text("tag"),
    previousTag: text("previous_tag"),
    lane: campaignLaneEnum("lane"),
    program: text("program"),
    stage: text("stage"),
    intensity: campaignIntensityEnum("intensity"),
    sequenceId: text("sequence_id"),
    sequenceAction: campaignSequenceActionEnum("sequence_action"),
    bucket: leadTempEnum("bucket"),
    programStageKey: text("program_stage_key"),
    lastSequenceStartAt: timestamp("last_sequence_start_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastStartProgramStageKey: text("last_start_program_stage_key"),
    programStageStartCount: integer("program_stage_start_count")
      .notNull()
      .default(0),
    programStageStartWindowAt: timestamp("program_stage_start_window_at", {
      withTimezone: true,
      mode: "date",
    }),
    revision: integer("revision").notNull().default(0),
    asOf: timestamp("as_of", { withTimezone: true, mode: "date" }).notNull(),
    computedAt: timestamp("computed_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("person_campaign_tags_person_id_unique").on(table.personId)],
);

export const outboundSends = pgTable(
  "outbound_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    emailHash: text("email_hash").notNull(),
    toEmail: text("to_email").notNull(),
    purpose: outboundSendPurposeEnum("purpose").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    tag: text("tag"),
    status: outboundSendStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    unsubscribeToken: uuid("unsubscribe_token").notNull().defaultRandom(),
    isSeed: boolean("is_seed").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (table) => [
    check("outbound_sends_email_lowercase", sql`${table.toEmail} = lower(${table.toEmail})`),
    uniqueIndex("outbound_sends_unsubscribe_token_unique").on(
      table.unsubscribeToken,
    ),
  ],
);

export const emailDeliveryEvents = pgTable(
  "email_delivery_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailHash: text("email_hash").notNull(),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    outboundSendId: uuid("outbound_send_id").references(() => outboundSends.id, {
      onDelete: "set null",
    }),
    recordType: text("record_type").notNull(),
    bounceType: text("bounce_type"),
    providerMessageId: text("provider_message_id"),
    providerTraceId: text("provider_trace_id"),
    isSeed: boolean("is_seed").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("email_delivery_events_trace_unique").on(table.providerTraceId),
    index("email_delivery_events_message_id_idx").on(table.providerMessageId),
    index("email_delivery_events_email_hash_idx").on(table.emailHash),
  ],
);

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
  consents: many(personConsents),
  consentEvents: many(personConsentEvents),
  signals: many(personSignals),
  scoreSnapshots: many(personScoreSnapshots),
  emails: many(personEmails),
  campaignTag: one(personCampaignTags, {
    fields: [people.id],
    references: [personCampaignTags.personId],
  }),
}));

export const personEmailsRelations = relations(personEmails, ({ one }) => ({
  person: one(people, {
    fields: [personEmails.personId],
    references: [people.id],
  }),
}));

export const personCampaignTagsRelations = relations(personCampaignTags, ({ one }) => ({
  person: one(people, {
    fields: [personCampaignTags.personId],
    references: [people.id],
  }),
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

export const emailThreadsRelations = relations(emailThreads, ({ one, many }) => ({
  person: one(people, {
    fields: [emailThreads.personId],
    references: [people.id],
  }),
  messages: many(emailMessages),
}));

export const emailMessagesRelations = relations(emailMessages, ({ one }) => ({
  thread: one(emailThreads, {
    fields: [emailMessages.threadId],
    references: [emailThreads.id],
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

export const emailSuppressionsRelations = relations(
  emailSuppressions,
  ({ one, many }) => ({
    createdByUser: one(users, {
      fields: [emailSuppressions.createdBy],
      references: [users.id],
    }),
    events: many(emailSuppressionEvents),
  }),
);

export const emailSuppressionEventsRelations = relations(
  emailSuppressionEvents,
  ({ one }) => ({
    suppression: one(emailSuppressions, {
      fields: [emailSuppressionEvents.suppressionId],
      references: [emailSuppressions.id],
    }),
    createdByUser: one(users, {
      fields: [emailSuppressionEvents.createdBy],
      references: [users.id],
    }),
  }),
);

export const personConsentsRelations = relations(personConsents, ({ one }) => ({
  person: one(people, {
    fields: [personConsents.personId],
    references: [people.id],
  }),
}));

export const personConsentEventsRelations = relations(
  personConsentEvents,
  ({ one }) => ({
    person: one(people, {
      fields: [personConsentEvents.personId],
      references: [people.id],
    }),
  }),
);

export const personSignalsRelations = relations(personSignals, ({ one }) => ({
  person: one(people, {
    fields: [personSignals.personId],
    references: [people.id],
  }),
  sourceEmailMessage: one(emailMessages, {
    fields: [personSignals.sourceEmailMessageId],
    references: [emailMessages.id],
  }),
  sourceTask: one(tasks, {
    fields: [personSignals.sourceTaskId],
    references: [tasks.id],
  }),
  sourceMeeting: one(meetings, {
    fields: [personSignals.sourceMeetingId],
    references: [meetings.id],
  }),
  sourceActivity: one(activities, {
    fields: [personSignals.sourceActivityId],
    references: [activities.id],
  }),
}));

export const personScoreSnapshotsRelations = relations(
  personScoreSnapshots,
  ({ one }) => ({
    person: one(people, {
      fields: [personScoreSnapshots.personId],
      references: [people.id],
    }),
    computedByUser: one(users, {
      fields: [personScoreSnapshots.computedBy],
      references: [users.id],
    }),
  }),
);
