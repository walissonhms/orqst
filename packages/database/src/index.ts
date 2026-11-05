import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';
import { chmodSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  eventSchema,
  emptyUsage,
  preferencesSchema,
  modelAnalyticsQuerySchema,
  sessionMetricsRequestSchema,
  sessionModelHistoryRequestSchema,
  type SessionModelHistoryResult,
  type SessionMetricsResult,
  type AgentEvent,
  type StoredEvent,
  type Usage,
  type SessionView,
  type WorkspaceView,
  type NotificationView,
  type Preferences,
  type ModelAnalyticsQuery,
  type ModelAnalyticsReport,
  type ModelAnalyticsSummary,
} from '@orqst/protocol';
import { stableId } from '@orqst/shared';
import { readSessionMetrics } from './live-metrics.js';
import { readSessionModelHistory } from './model-history.js';
import { openFeatures } from './features.js';
import { openFeaturePermissions } from './feature-permissions.js';
export { FeaturePermissionRevisionConflict } from './feature-permissions.js';
import { openCrossFeaturePermissions } from './cross-feature-permissions.js';
import { openTerminalTeams } from './terminal-teams.js';
import { openTerminalLayouts } from './terminal-layouts.js';
export { TERMINAL_LAYOUT_LIMITS } from './terminal-layouts.js';
import { openTerminalJournal } from './terminal-journal.js';
import { openCommunicationJournal } from './pane-communication.js';
export { TERMINAL_JOURNAL_LIMITS } from './terminal-journal.js';
export {
  committedTerminalImage,
  inspectOfflineTerminalImage,
  inspectKernelTerminalImage,
  OFFLINE_JOURNAL_BYTES,
} from './offline-terminal-journal.js';
export { SESSION_METRICS_LIMITS } from './live-metrics.js';
import {
  analyticsEvidenceMigration,
  analyticsEvidenceQueries,
  analyticsMetadataSql,
} from './analytics-evidence.js';
import {
  aggregateModelAnalytics,
  summarizeModelAnalytics,
  type AnalyticsSession,
  type AnalyticsEvent,
} from './analytics.js';
export {
  readModelAnalyticsSummary,
  readModelAnalyticsEvolution,
  ANALYTICS_READ_LIMITS,
  AnalyticsReadCapacityError,
} from './analytics-reader.js';

type Row = Record<string, unknown>;
// Legacy synchronous library budgets. Count retained envelopes and compact records
// whose details expired, including message-only records and out-of-window baselines.
export const MODEL_ANALYTICS_LIMITS = Object.freeze({
  sessions: 100,
  events: 1000,
  evidenceBytes: 2 * 1024 * 1024,
});
export class AnalyticsCapacityError extends Error {
  constructor() {
    super('Analytics capacity exceeded');
    this.name = 'AnalyticsCapacityError';
  }
}
export interface Checkpoint {
  offset: number;
  line: number;
  identity: string;
  anchor: string;
  state: string;
}
const migrations = [
  /* sql */ `
CREATE TABLE machines (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, machine_id TEXT NOT NULL REFERENCES machines(id), name TEXT NOT NULL, adapter TEXT NOT NULL);
CREATE TABLE sessions (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), cwd TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'unknown', started_at TEXT NOT NULL, last_activity TEXT NOT NULL, state_at TEXT NOT NULL,
 task TEXT, result TEXT, model TEXT, parent_session_id TEXT, manual_workspace INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL REFERENCES sessions(id), timestamp TEXT NOT NULL, type TEXT NOT NULL, envelope TEXT NOT NULL);
CREATE INDEX events_session_sequence ON events(session_id, sequence);
CREATE INDEX events_timestamp ON events(timestamp);
CREATE TABLE messages (event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id), role TEXT NOT NULL, text TEXT NOT NULL);
CREATE TABLE token_usage (session_id TEXT PRIMARY KEY REFERENCES sessions(id), input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, cached INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, source_priority INTEGER NOT NULL DEFAULT 0, timestamp TEXT NOT NULL);
CREATE TABLE notifications (id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id), type TEXT NOT NULL, timestamp TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE synchronization_state (source TEXT PRIMARY KEY, offset INTEGER NOT NULL, line INTEGER NOT NULL, identity TEXT NOT NULL, anchor TEXT NOT NULL, state TEXT NOT NULL);
`,
  analyticsEvidenceMigration,
];

export class Store {
  private db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  readonly machineId: string;
  readonly databasePath: string | null;
  readonly retentionDays: number;
  constructor(file: string, retentionDays = 30) {
    this.retentionDays = retentionDays;
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      if (lstatSync(dirname(file)).isSymbolicLink())
        throw new Error('Data directory must not be a symlink');
      chmodSync(dirname(file), 0o700);
      try {
        if (lstatSync(file).isSymbolicLink()) throw new Error('Database must not be a symlink');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    this.db = new DatabaseSync(file);
    if (file !== ':memory:') chmodSync(file, 0o600);
    this.databasePath = file === ':memory:' ? null : realpathSync(file);
    this.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;',
    );
    try {
      const version = Number(this.get('PRAGMA user_version')?.user_version);
      if (version > migrations.length)
        throw new Error('Database schema is newer than this application');
      for (let index = version; index < migrations.length; index++)
        this.transaction(() => {
          this.db.exec(migrations[index]!);
          this.db.exec(`PRAGMA user_version=${index + 1}`);
        });
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.machineId = this.setting<string>('machineId', randomUUID());
    this.run(
      'INSERT OR IGNORE INTO machines VALUES (?,?)',
      this.machineId,
      new Date().toISOString(),
    );
  }
  private stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  private run(sql: string, ...params: SQLInputValue[]) {
    return this.stmt(sql).run(...params);
  }
  private get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.stmt(sql).get(...params);
  }
  private all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.stmt(sql).all(...params);
  }
  transaction<T>(action: () => T): T {
    if (this.db.isTransaction) return action();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  setting<T>(key: string, fallback: T): T {
    const row = this.get('SELECT value FROM settings WHERE key=?', key);
    if (row) return JSON.parse(String(row.value)) as T;
    this.setSetting(key, fallback);
    return fallback;
  }
  setSetting(key: string, value: unknown): void {
    this.run(
      'INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      JSON.stringify(value),
    );
  }
  preferences(): Preferences {
    return preferencesSchema.parse(
      this.setting('notifications', {
        sound: false,
        completed: true,
        failed: true,
        intervention: true,
      }),
    );
  }
  /** Experimental owned-terminal composition only. Never exposed by Bridge. */
  terminalJournal(epoch: string, options: { recover: boolean }) {
    return openTerminalJournal(
      this.db,
      (action) => this.transaction(action),
      epoch,
      options.recover,
    );
  }
  /** Private opt-in communication library. Absent from observer startup and read APIs. */
  communicationJournal(epoch: string, options: { recover: boolean }) {
    return openCommunicationJournal(
      this.db,
      (action) => this.transaction(action),
      epoch,
      options.recover,
    );
  }
  /** Opt-in metadata only; never called by observer startup or exposed over HTTP. */
  features() {
    return openFeatures(this.db, (action) => this.transaction(action));
  }

  crossFeaturePermissions() {
    return openCrossFeaturePermissions(this.db, (action) => this.transaction(action));
  }
  featurePermissions() {
    return openFeaturePermissions(this.db, (action) => this.transaction(action));
  }

  terminalTeams(featureId?: string) {
    return openTerminalTeams(this.db, (action) => this.transaction(action), featureId);
  }

  terminalLayouts(featureId?: string) {
    return openTerminalLayouts(this.db, (action) => this.transaction(action), featureId);
  }
  checkpoint(source: string): Checkpoint | undefined {
    return this.get(
      'SELECT offset,line,identity,anchor,state FROM synchronization_state WHERE source=?',
      source,
    ) as unknown as Checkpoint | undefined;
  }
  saveCheckpoint(source: string, checkpoint: Checkpoint): void {
    this.run(
      'INSERT INTO synchronization_state VALUES (?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET offset=excluded.offset,line=excluded.line,identity=excluded.identity,anchor=excluded.anchor,state=excluded.state',
      source,
      checkpoint.offset,
      checkpoint.line,
      checkpoint.identity,
      checkpoint.anchor,
      checkpoint.state,
    );
  }
  workspace(path: string, name: string): string {
    const id = stableId('workspace', path);
    this.run('INSERT OR IGNORE INTO workspaces VALUES (?,?,?)', id, name, path);
    return id;
  }
  ingest(input: AgentEvent, live = false): StoredEvent | undefined {
    const event = eventSchema.parse(input);
    return this.transaction(() => {
      if (
        this.get('SELECT 1 FROM events WHERE id=?', event.id) ||
        this.get('SELECT 1 FROM analytics_evidence WHERE id=?', event.id)
      )
        return undefined;
      const p = event.payload;
      this.run('INSERT OR IGNORE INTO machines VALUES (?,?)', event.machineId, event.timestamp);
      this.run(
        'INSERT OR IGNORE INTO workspaces VALUES (?,?,?)',
        event.workspaceId,
        p.cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Unknown',
        p.cwd ?? '',
      );
      this.run(
        'INSERT OR IGNORE INTO agents VALUES (?,?,?,?)',
        event.agentId,
        event.machineId,
        p.agentName ?? event.sessionId.slice(0, 8),
        event.adapter,
      );
      this.run(
        'INSERT OR IGNORE INTO sessions (id,agent_id,workspace_id,cwd,started_at,last_activity,state_at) VALUES (?,?,?,?,?,?,?)',
        event.sessionId,
        event.agentId,
        event.workspaceId,
        p.cwd ?? '',
        event.timestamp,
        event.timestamp,
        event.timestamp,
      );
      const insert = this.run(
        'INSERT INTO events(id,session_id,timestamp,type,envelope) VALUES (?,?,?,?,?)',
        event.id,
        event.sessionId,
        event.timestamp,
        event.type,
        JSON.stringify(event),
      );
      if (p.model !== undefined || p.usage !== undefined)
        this.run(
          `INSERT INTO analytics_evidence(sequence,id,session_id,timestamp,metadata)
           SELECT sequence,id,session_id,timestamp,${analyticsMetadataSql} FROM events WHERE id=?`,
          event.id,
        );
      this.run(
        'UPDATE sessions SET last_activity=MAX(last_activity,?), started_at=MIN(started_at,?) WHERE id=?',
        event.timestamp,
        event.timestamp,
        event.sessionId,
      );
      if (p.cwd)
        this.run(
          'UPDATE sessions SET cwd=?, workspace_id=CASE WHEN manual_workspace=0 THEN ? ELSE workspace_id END WHERE id=?',
          p.cwd,
          event.workspaceId,
          event.sessionId,
        );
      if (p.parentSessionId)
        this.run(
          'UPDATE sessions SET parent_session_id=? WHERE id=?',
          p.parentSessionId,
          event.sessionId,
        );
      if (p.agentName) this.run('UPDATE agents SET name=? WHERE id=?', p.agentName, event.agentId);
      if (p.model)
        this.run(
          'UPDATE sessions SET model=? WHERE id=? AND last_activity<=?',
          p.model,
          event.sessionId,
          event.timestamp,
        );
      if (p.status)
        this.run(
          'UPDATE sessions SET status=?, state_at=? WHERE id=? AND state_at<=?',
          p.status,
          event.timestamp,
          event.sessionId,
          event.timestamp,
        );
      if (event.type === 'agent.message' && p.role && p.text) {
        this.run(
          'INSERT INTO messages VALUES (?,?,?,?)',
          event.id,
          event.sessionId,
          p.role,
          p.text,
        );
        if (p.role === 'user')
          this.run(
            'UPDATE sessions SET task=? WHERE id=? AND last_activity<=?',
            p.text.slice(0, 2000),
            event.sessionId,
            event.timestamp,
          );
        if (p.role === 'assistant' && (p.phase === 'final_answer' || p.phase === 'final'))
          this.run(
            'UPDATE sessions SET result=? WHERE id=? AND last_activity<=?',
            p.text,
            event.sessionId,
            event.timestamp,
          );
      }
      if (p.result)
        this.run(
          'UPDATE sessions SET result=? WHERE id=? AND last_activity<=?',
          p.result,
          event.sessionId,
          event.timestamp,
        );
      if (p.usage && p.usageKind === 'session_cumulative') {
        const priority = event.source.recordType === 'token_usage_record' ? 2 : 1;
        this.run(
          `INSERT INTO token_usage VALUES (?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET
          input=excluded.input,output=excluded.output,cached=excluded.cached,total=excluded.total,source_priority=excluded.source_priority,timestamp=excluded.timestamp
          WHERE excluded.timestamp>=token_usage.timestamp AND (excluded.total>token_usage.total OR (excluded.total=token_usage.total AND excluded.source_priority>=token_usage.source_priority))`,
          event.sessionId,
          p.usage.input,
          p.usage.output,
          p.usage.cached,
          p.usage.total,
          priority,
          event.timestamp,
        );
      }
      const preference =
        event.type === 'agent.completed'
          ? 'completed'
          : event.type === 'agent.failed'
            ? 'failed'
            : event.type === 'agent.intervention.required'
              ? 'intervention'
              : undefined;
      if (live && preference && this.preferences()[preference])
        this.run(
          'INSERT OR IGNORE INTO notifications VALUES (?,?,?,?,0)',
          event.id,
          event.sessionId,
          event.type,
          event.timestamp,
        );
      return { ...event, sequence: Number(insert.lastInsertRowid) };
    });
  }
  cursor(): number {
    return Number(
      this.get("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='events'),0) AS cursor")
        ?.cursor ?? 0,
    );
  }
  events(after = 0, limit = 200, sessionId?: string): StoredEvent[] {
    const rows = sessionId
      ? this.all(
          'SELECT sequence,envelope FROM events WHERE sequence>? AND session_id=? ORDER BY sequence LIMIT ?',
          after,
          sessionId,
          limit,
        )
      : this.all(
          'SELECT sequence,envelope FROM events WHERE sequence>? ORDER BY sequence LIMIT ?',
          after,
          limit,
        );
    return rows.map((row) => ({
      ...(JSON.parse(String(row.envelope)) as AgentEvent),
      sequence: Number(row.sequence),
    }));
  }
  eventsBefore(before: number, limit: number, sessionId?: string): StoredEvent[] {
    const rows = sessionId
      ? this.all(
          'SELECT sequence,envelope FROM events WHERE sequence<? AND session_id=? ORDER BY sequence DESC LIMIT ?',
          before,
          sessionId,
          limit,
        )
      : this.all(
          'SELECT sequence,envelope FROM events WHERE sequence<? ORDER BY sequence DESC LIMIT ?',
          before,
          limit,
        );
    return rows.reverse().map((row) => ({
      ...(JSON.parse(String(row.envelope)) as AgentEvent),
      sequence: Number(row.sequence),
    }));
  }
  recentEvents(limit = 100, sessionId?: string): StoredEvent[] {
    const rows = sessionId
      ? this.all(
          'SELECT sequence,envelope FROM events WHERE session_id=? ORDER BY sequence DESC LIMIT ?',
          sessionId,
          limit,
        )
      : this.all('SELECT sequence,envelope FROM events ORDER BY sequence DESC LIMIT ?', limit);
    return rows.reverse().map((row) => ({
      ...(JSON.parse(String(row.envelope)) as AgentEvent),
      sequence: Number(row.sequence),
    }));
  }
  sessions(): SessionView[] {
    return this.all(
      `SELECT s.*,a.name AS agent_name,a.adapter,t.input,t.output,t.cached,t.total FROM sessions s JOIN agents a ON a.id=s.agent_id LEFT JOIN token_usage t ON t.session_id=s.id ORDER BY last_activity DESC`,
    ).map((row) => ({
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      cwd: String(row.cwd),
      agentName: String(row.agent_name),
      adapter: String(row.adapter),
      status: row.status as SessionView['status'],
      startedAt: String(row.started_at),
      lastActivity: String(row.last_activity),
      task: row.task as string | null,
      result: row.result as string | null,
      model: row.model as string | null,
      parentSessionId: row.parent_session_id as string | null,
      manualWorkspace: Boolean(row.manual_workspace),
      usage: this.usage(row),
    }));
  }
  sessionMetrics(sessionId: string): SessionMetricsResult {
    sessionMetricsRequestSchema.parse({ sessionId });
    return readSessionMetrics(this.db, sessionId);
  }
  sessionModelHistory(sessionId: string): SessionModelHistoryResult {
    sessionModelHistoryRequestSchema.parse({ sessionId });
    return readSessionModelHistory(this.db, sessionId);
  }
  private usage(row: Row): Usage {
    return {
      input: Number(row.input ?? 0),
      output: Number(row.output ?? 0),
      cached: Number(row.cached ?? 0),
      total: Number(row.total ?? 0),
    };
  }
  workspaces(): WorkspaceView[] {
    return this.all(
      `SELECT w.*,COUNT(s.id) AS sessions,SUM(t.input) AS input,SUM(t.output) AS output,SUM(t.cached) AS cached,SUM(t.total) AS total FROM workspaces w LEFT JOIN sessions s ON s.workspace_id=w.id LEFT JOIN token_usage t ON t.session_id=s.id GROUP BY w.id ORDER BY w.name`,
    ).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      path: String(row.path),
      sessions: Number(row.sessions),
      usage: this.usage(row),
    }));
  }
  associate(sessionId: string, workspaceId: string | null): boolean {
    const session = this.get('SELECT cwd FROM sessions WHERE id=?', sessionId);
    if (!session) return false;
    const target =
      workspaceId ??
      this.workspace(String(session.cwd), String(session.cwd).split(/[\\/]/).at(-1) ?? 'Unknown');
    if (!this.get('SELECT 1 FROM workspaces WHERE id=?', target)) return false;
    this.run(
      'UPDATE sessions SET workspace_id=?,manual_workspace=? WHERE id=?',
      target,
      workspaceId ? 1 : 0,
      sessionId,
    );
    return true;
  }
  notifications(): NotificationView[] {
    return this.all('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT 200').map((row) => ({
      id: String(row.id),
      sessionId: String(row.session_id),
      type: String(row.type),
      timestamp: String(row.timestamp),
      read: Boolean(row.is_read),
    }));
  }
  readNotifications(): void {
    this.run('UPDATE notifications SET is_read=1');
  }
  retain(now = Date.now()): number {
    const cutoff = new Date(now - this.retentionDays * 86400000).toISOString();
    return Number(this.run('DELETE FROM events WHERE timestamp<?', cutoff).changes);
  }
  totals(): Usage {
    return this.usage(
      this.get(
        'SELECT SUM(input) AS input,SUM(output) AS output,SUM(cached) AS cached,SUM(total) AS total FROM token_usage',
      ) ?? emptyUsage(),
    );
  }
  modelAnalytics(input: ModelAnalyticsQuery = {}): ModelAnalyticsReport {
    return this.readModelAnalytics(input, false);
  }
  modelAnalyticsSummary(input: ModelAnalyticsQuery = {}): ModelAnalyticsSummary {
    // One snapshot covers budget admission and evidence reads, including when another
    // local connection writes. No aggregate or source data is persisted here.
    const report = this.transaction(() => this.readModelAnalytics(input, true));
    return summarizeModelAnalytics(report);
  }

  private readModelAnalytics(input: ModelAnalyticsQuery, bounded: boolean): ModelAnalyticsReport {
    const query = modelAnalyticsQuerySchema.parse(input);
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];
    for (const [column, value] of [
      ['s.workspace_id', query.workspaceId],
      ['s.agent_id', query.agentId],
      ['a.adapter', query.adapter],
    ] as const) {
      if (value !== undefined) {
        conditions.push(`${column}=?`);
        params.push(value);
      }
    }
    if (query.from || query.to) {
      const window = (column: string) => {
        const clauses: string[] = [];
        if (query.from) {
          clauses.push(`julianday(${column})>=julianday(?)`);
          params.push(query.from);
        }
        if (query.to) {
          clauses.push(`julianday(${column})<julianday(?)`);
          params.push(query.to);
        }
        return clauses.join(' AND ');
      };
      conditions.push(
        `(EXISTS (SELECT 1 FROM events e WHERE e.session_id=s.id AND ${window('e.timestamp')}) OR EXISTS (SELECT 1 FROM analytics_evidence c WHERE c.session_id=s.id AND ${window('c.timestamp')}) OR (${window('t.timestamp')}))`,
      );
    }
    const sessionRows = this.all(
      `SELECT s.id,s.workspace_id,s.agent_id,a.machine_id,a.adapter,t.input,t.output,t.cached,t.total,t.timestamp,t.source_priority
       FROM sessions s JOIN agents a ON a.id=s.agent_id LEFT JOIN token_usage t ON t.session_id=s.id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY s.id LIMIT ?`,
      ...params,
      bounded ? MODEL_ANALYTICS_LIMITS.sessions + 1 : -1,
    );
    if (bounded) {
      if (sessionRows.length > MODEL_ANALYTICS_LIMITS.sessions) throw new AnalyticsCapacityError();
      let events = 0;
      let bytes = 0;
      // Admit ALL selected sessions before fetching any envelope or running json_type.
      // LIMIT permits a single overflow probe, never materializing an unbounded history.
      const budget = this.stmt(analyticsEvidenceQueries(true).budget);
      for (const row of sessionRows) {
        for (const event of budget.iterate(
          String(row.id),
          MODEL_ANALYTICS_LIMITS.events - events + 1,
        )) {
          events++;
          bytes += Number(event.bytes);
          if (
            events > MODEL_ANALYTICS_LIMITS.events ||
            bytes > MODEL_ANALYTICS_LIMITS.evidenceBytes
          )
            throw new AnalyticsCapacityError();
        }
      }
    }
    const sessions: AnalyticsSession[] = sessionRows.map((row) => ({
      id: String(row.id),
      machineId: String(row.machine_id),
      workspaceId: String(row.workspace_id),
      agentId: String(row.agent_id),
      adapter: row.adapter as AnalyticsSession['adapter'],
      canonical:
        row.timestamp === null
          ? null
          : {
              usage: this.usage(row),
              timestamp: String(row.timestamp),
              priority: Number(row.source_priority),
            },
      // Read all retained model/usage evidence for baselines; apply the period only to deltas.
      // The projection below never returns captured text, task/result content or cwd.
      events: this.all(analyticsEvidenceQueries(true).projection, String(row.id)).map((event) => ({
        ...(JSON.parse(String(event.metadata)) as AnalyticsEvent),
        sequence: Number(event.sequence),
      })),
    }));
    return aggregateModelAnalytics(sessions, query);
  }
  close(): void {
    this.db.close();
  }
}
export { readTerminalWorkspace } from './terminal-workspace.js';
