// Runs on an ordinary pod network, never hostNetwork or a host port. The controller
// uses a Unix socket so there is no admin TCP listener on the LAN node at all.
import { createServer, request } from 'node:http';
const socketPath = process.env.API_SOCKET || '/data/api/controller.sock';
const server = createServer((req, res) => {
    const upstream = request({ socketPath, path: req.url, method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
    });
    upstream.setTimeout(150000, () => upstream.destroy());
    upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end('{"error":"Controller temporarily unavailable"}');
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
