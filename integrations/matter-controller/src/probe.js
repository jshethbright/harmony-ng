import { request } from 'node:http';
const req = request({ socketPath: process.env.API_SOCKET, path: process.argv[2] || '/healthz' }, res => {
    res.resume();
    res.on('end', () => process.exit(res.statusCode === 200 ? 0 : 1));
});
req.setTimeout(2000, () => req.destroy());
req.on('error', () => process.exit(1));
req.end();
