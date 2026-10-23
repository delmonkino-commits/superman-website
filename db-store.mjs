/** Server-only Supabase Postgres state persistence. Never expose DATABASE_URL to public assets. */
export async function connectStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    if (process.env.RENDER) throw new Error('DATABASE_URL is required on Render; refusing to use temporary storage.');
    return null; // Local Windows developer installation continues to use JSON files.
  }
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('DATABASE_URL must be a Postgres connection string');
  // Use a small pool; each write is a full application-state snapshot.
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 1,
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 10000,
    query_timeout: 15000
  });
  pool.on('error', error => console.error('[SuperMan] Database idle connection error:', error.message));
  // Fail startup rather than appear to work with data that would disappear on a Render restart.
  await pool.query('select state_key from superman_private.app_state limit 1');
  let pending = Promise.resolve();
  return {
    async load(key) {
      const result = await pool.query('select state_data from superman_private.app_state where state_key = $1', [key]);
      return result.rows[0]?.state_data ?? null;
    },
    async save(key, state) {
      const snapshot = JSON.stringify(state);
      pending = pending.catch(() => {}).then(() => pool.query(
        `insert into superman_private.app_state (state_key, state_data, updated_at)
         values ($1, $2::jsonb, now())
         on conflict (state_key) do update set state_data = excluded.state_data, updated_at = now()`,
        [key, snapshot]
      ));
      return pending;
    },
    async close() {await pool.end();}
  };
}
