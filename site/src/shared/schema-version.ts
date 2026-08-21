/**
 * Highest SQLite schema understood by both the Angular application and the
 * narrow Electron database-lifecycle host. Keep compatibility decisions at
 * this shared boundary so backups cannot drift behind application migrations.
 */
export const CURRENT_SQLITE_SCHEMA_VERSION = 6 as number;
