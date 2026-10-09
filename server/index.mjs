import http from 'node:http';
import pg from 'pg';

const pool = new pg.Pool(); // reads PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD from env
const port = Number(process.env.API_PORT ?? 3000);

const routes = {
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

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const handler = req.method === 'GET' ? routes[url.pathname] : undefined;
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
    try {
      const body = await handler(url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } catch (err) {
      console.error(err);
      res.writeHead(err.status ?? 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.status ? err.message : 'Internal server error' }));
    }
  })
  .listen(port, () => console.log(`API listening on http://localhost:${port}`));
