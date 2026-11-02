import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').default(''),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const workspaceBackups = pgTable('workspace_backups', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id)
    .notNull(),
  uid: text('uid').notNull().unique(),
  netWorthCad: integer('net_worth_cad').notNull().default(0),
  transactionsCount: integer('transactions_count').notNull().default(0),
  assetsCount: integer('assets_count').notNull().default(0),
  debtsCount: integer('debts_count').notNull().default(0),
  stateJson: text('state_json').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  backups: many(workspaceBackups),
}));

export const workspaceBackupsRelations = relations(workspaceBackups, ({ one }) => ({
  user: one(users, {
    fields: [workspaceBackups.userId],
    references: [users.id],
  }),
}));
