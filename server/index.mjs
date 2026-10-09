import http from 'node:http';
import { handle } from './routes.mjs';

// Local development server; on Vercel the same routes run as functions in api/.
const port = Number(process.env.API_PORT ?? 3000);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const { status, body } =
      req.method === 'GET'
        ? await handle(url.pathname, url)
        : { status: 404, body: { error: 'Not found' } };
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  })
  .listen(port, () => console.log(`API listening on http://localhost:${port}`));
