import pg from 'pg';

// Reads PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD from the environment.
// On Vercel each function instance serves one request at a time, so one connection is enough.
const pool = new pg.Pool({ max: process.env.VERCEL ? 1 : 10 });

/** API route handlers, shared by the local server (server/index.mjs) and the Vercel functions (api/). */
export const routes = {
  '/api/config': async () => ({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
  }),

  '/api/districts': async () => {
    const { rows } = await pool.query(
      'SELECT DISTINCT district FROM schools ORDER BY district',
    );
    return rows.map((r) => r.district);
  },

  '/api/schools': async (url) => {
    const district = url.searchParams.get('district');
    if (!district) throw Object.assign(new Error('district is required'), { status: 400 });
    const { rows } = await pool.query(
      `SELECT id, name, district, level,
              latitude::float8 AS latitude, longitude::float8 AS longitude
         FROM schools
        WHERE district = $1
        ORDER BY name`,
      [district],
    );
    return rows;
  },
};

/** Runs a route and returns its JSON status and body, hiding internal error details. */
export async function handle(pathname, url) {
  const handler = routes[pathname];
  if (!handler) return { status: 404, body: { error: 'Not found' } };
  try {
    return { status: 200, body: await handler(url) };
  } catch (err) {
    console.error(err);
    return {
      status: err.status ?? 500,
      body: { error: err.status ? err.message : 'Internal server error' },
    };
  }
}

/** Builds a Vercel function (web-standard GET handler) for one route. */
export function vercelRoute(pathname) {
  return async (request) => {
    const { status, body } = await handle(pathname, new URL(request.url));
    return Response.json(body, { status });
  };
}
