/**
 * SuperMan database storage. For a cloud connection supply DATABASE_URL and
 * SUPABASE_CA_CERT from Supabase's Database Settings > SSL Configuration.
 * TLS is required and the server's certificate is verified against that CA.
 */
export async function connectStore() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    if (process.env.RENDER) {
      throw new Error('[SuperMan] DATABASE_URL is required on Render; refusing temporary storage.');
    }
    return null; // Local installation may continue to use JSON files.
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('[SuperMan] DATABASE_URL is invalid. Recopy the Session pooler URL from Supabase.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('[SuperMan] DATABASE_URL must start with postgresql:// or postgres://.');
  }

  // Important for node-postgres: an sslmode option in the URL silently replaces
  // the explicit `ssl` object below. Keep our verified TLS configuration instead.
  for (const option of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    parsed.searchParams.delete(option);
  }

  // Paste the *public* Supabase CA certificate into Render as SUPABASE_CA_CERT.
  // The value can have actual line breaks, or literal \\n between PEM lines.
  const certificate = (process.env.SUPABASE_CA_CERT || '')
    .replace(/\\n/g, '\n')
    .trim();
  if (!/^-----BEGIN CERTIFICATE-----\s[\s\S]*?-----END CERTIFICATE-----$/.test(certificate)) {
    throw new Error('[SuperMan] SUPABASE_CA_CERT is missing or invalid. Download the CA certificate from Supabase > Database Settings > SSL Configuration and paste its entire contents into the Render environment variable.');
  }

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: parsed.toString(),
    ssl: {
      ca: certificate,
      rejectUnauthorized: true,
      servername: parsed.hostname,
    },
    max: 1,
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  pool.on('error', error => console.error('[SuperMan] Database idle connection error:', error.message));

  // Refuse to start with an inaccessible database rather than lose data on a
  // Render Free restart.
  await pool.query('select state_key from superman_private.app_state limit 1');

  let pending = Promise.resolve();
  return {
    async load(key) {
      const result = await pool.query(
        'select state_data from superman_private.app_state where state_key = $1',
        [key]
      );
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
    async close() { await pool.end(); }
  };
}
