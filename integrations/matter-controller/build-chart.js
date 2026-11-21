import { mkdir, cp, copyFile, rm } from 'node:fs/promises';
await rm(new URL('./chart/app', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('./chart/app', import.meta.url), { recursive: true });
for (const name of ['package.json', 'package-lock.json']) await copyFile(new URL(name, import.meta.url), new URL(`chart/app/${name}`, import.meta.url));
await cp(new URL('./src', import.meta.url), new URL('./chart/app/src', import.meta.url), { recursive: true });
