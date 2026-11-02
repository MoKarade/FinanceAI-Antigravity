import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users, workspaceBackups } from './schema.ts';

export async function getOrCreateUser(uid: string, email: string, displayName = '') {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Échec de synchronisation du profil utilisateur Cloud SQL.', { cause: error });
  }
}

export interface UpsertWorkspaceBackupInput {
  uid: string;
  email: string;
  displayName?: string;
  netWorthCad: number;
  transactionsCount: number;
  assetsCount: number;
  debtsCount: number;
  stateJson: string;
}

export async function upsertWorkspaceBackup(input: UpsertWorkspaceBackupInput) {
  try {
    const userRow = await getOrCreateUser(input.uid, input.email, input.displayName ?? '');
    if (!userRow) {
      throw new Error('Utilisateur Cloud SQL introuvable.');
    }

    const result = await db
      .insert(workspaceBackups)
      .values({
        userId: userRow.id,
        uid: input.uid,
        netWorthCad: Math.round(input.netWorthCad),
        transactionsCount: Math.round(input.transactionsCount),
        assetsCount: Math.round(input.assetsCount),
        debtsCount: Math.round(input.debtsCount),
        stateJson: input.stateJson,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: workspaceBackups.uid,
        set: {
          netWorthCad: Math.round(input.netWorthCad),
          transactionsCount: Math.round(input.transactionsCount),
          assetsCount: Math.round(input.assetsCount),
          debtsCount: Math.round(input.debtsCount),
          stateJson: input.stateJson,
          updatedAt: new Date(),
        },
      })
      .returning({
        id: workspaceBackups.id,
        uid: workspaceBackups.uid,
        netWorthCad: workspaceBackups.netWorthCad,
        transactionsCount: workspaceBackups.transactionsCount,
        assetsCount: workspaceBackups.assetsCount,
        debtsCount: workspaceBackups.debtsCount,
        updatedAt: workspaceBackups.updatedAt,
      });

    return result[0] ?? null;
  } catch (error) {
    console.error('Database workspace backup upsert failed:', error);
    throw new Error('Échec de sauvegarde du dossier dans Cloud SQL.', { cause: error });
  }
}

export async function getWorkspaceBackupByUid(uid: string) {
  try {
    const rows = await db
      .select()
      .from(workspaceBackups)
      .where(eq(workspaceBackups.uid, uid));
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database workspace backup query failed:', error);
    throw new Error('Échec de lecture du dossier depuis Cloud SQL.', { cause: error });
  }
}
