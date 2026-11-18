#!/usr/bin/env node
/**
 * Cliente SQL para el asistente.
 *
 * - Por defecto corre en MODO LECTURA: abre una transacción READ ONLY y hace
 *   ROLLBACK al final. Ningún SELECT puede modificar datos por accidente.
 * - Para escribir (DDL/DML) hay que pasar --write y --yes de forma explícita.
 *
 * Uso:
 *   node scripts/db.mjs "SELECT * FROM products LIMIT 5"
 *   node scripts/db.mjs --file supabase/estado_prueba_compras.sql
 *   node scripts/db.mjs --file supabase/fix_6_recepcion_faltantes.sql --write --yes
 *
 * Requiere DATABASE_URL en .env.local (o en el entorno).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

/* ---------- entorno ---------- */

function loadEnvFile(name) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

/* ---------- argumentos ---------- */

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const usage = `Uso:
  node scripts/db.mjs "SELECT ..."                  (lectura, rollback)
  node scripts/db.mjs --file ruta.sql               (lectura, rollback)
  node scripts/db.mjs --file ruta.sql --write --yes (escritura, commit)

Opciones:
  --file <ruta>   Ejecuta un archivo .sql
  --write         Habilita DDL/DML (requiere --yes)
  --yes           Confirma que la escritura fue aprobada por el usuario
  --limit <n>     Filas a mostrar por resultado (default 100)
  --help          Muestra esta ayuda`;

if (has('--help') || has('-h')) {
  console.log(usage);
  process.exit(0);
}

const write = has('--write');
if (write && !has('--yes')) {
  console.error('MODO ESCRITURA bloqueado: falta --yes (la escritura debe aprobarla el usuario).');
  process.exit(2);
}

const file = valueOf('--file');
const limit = Math.max(1, Number(valueOf('--limit') || 100));

const positional = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--file' || arg === '--limit') {
    i += 1;
    continue;
  }
  if (arg.startsWith('--') || arg === '-h') continue;
  positional.push(arg);
}

let sql = file ? readFileSync(resolve(process.cwd(), file), 'utf8') : positional.join(' ');

if (!sql || !sql.trim()) {
  console.error(usage);
  process.exit(2);
}

// Los scripts del repo traen su propio BEGIN;/COMMIT;: los quitamos para que
// la transacción (y el modo lectura) del cliente sean los que mandan.
sql = sql
  .split(/\r?\n/)
  .filter((line) => !/^\s*(begin|commit|rollback|start\s+transaction)\s*;\s*$/i.test(line))
  .join('\n');

/* ---------- conexión ---------- */

const url = process.env.DATABASE_URL;
const pgHost = process.env.PGHOST;
const pgPassword = process.env.PGPASSWORD;

let baseConfig = null;

if (url) {
  baseConfig = { connectionString: url };
} else if (pgHost && pgPassword) {
  // Variables sueltas: evita problemas de URL-encoding con contraseñas
  // que tengan @ # % : dentro.
  baseConfig = {
    host: pgHost,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: pgPassword,
  };
}

if (!baseConfig) {
  console.error(
    'Falta la conexión. En .env.local poné una de estas dos:\n\n' +
      '  A) DATABASE_URL=postgresql://postgres.REF:PASSWORD@HOST:5432/postgres\n' +
      '  B) PGHOST=... PGPORT=5432 PGDATABASE=postgres PGUSER=postgres.REF PGPASSWORD=...\n\n' +
      'Session pooler (IPv4): Supabase → Settings → Database → Connection string.\n' +
      'La conexión directa (db.REF.supabase.co) es solo IPv6 y no funciona en esta PC.',
  );
  process.exit(2);
}

let host = baseConfig.host || '';
if (!host && url) {
  try {
    host = new URL(url).hostname;
  } catch {
    /* la validación real la hace pg */
  }
}
const isLocal = host === 'localhost' || host === '127.0.0.1';

const client = new pg.Client({
  ...baseConfig,
  application_name: 'dietetica-agent',
  ...((isLocal || /sslmode=disable/i.test(url || '')) ? {} : { ssl: { rejectUnauthorized: false } }),
});

console.log(
  `Conexión: ${host || '(host de DATABASE_URL)'}:${baseConfig.port || '5432'} · ` +
    `${baseConfig.database || 'postgres'} · ${baseConfig.user || 'postgres'}`,
);

/* ---------- ejecución ---------- */

function printError(error) {
  console.error(`\nERROR${error.code ? ` [${error.code}]` : ''}: ${error.message}`);
  if (error.detail) console.error(`DETALLE: ${error.detail}`);
  if (error.hint) console.error(`SUGERENCIA: ${error.hint}`);
  if (error.position) console.error(`POSICIÓN: ${error.position}`);
}

function printResults(results) {
  results.forEach((result, index) => {
    const n = index + 1;
    if (Array.isArray(result.fields) && result.fields.length > 0) {
      const rows = result.rows.slice(0, limit);
      const extra =
        result.rows.length > limit ? ` (mostrando ${limit} de ${result.rows.length})` : '';
      console.log(`\n[${n}] ${result.command} · ${result.rowCount ?? rows.length} fila(s)${extra}`);
      if (rows.length) console.table(rows);
      else console.log('(sin filas)');
    } else {
      console.log(`[${n}] ${result.command} · ${result.rowCount ?? 0} fila(s) afectada(s)`);
    }
  });
}

try {
  await client.connect();

  if (write) {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '180s'");
    console.log('MODO ESCRITURA · commit al final\n');
  } else {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '60s'");
    console.log('MODO LECTURA · rollback al final\n');
  }

  const result = await client.query(sql);
  printResults(Array.isArray(result) ? result : [result]);

  await client.query(write ? 'COMMIT' : 'ROLLBACK');
  console.log(write ? '\nCOMMIT OK' : '\nROLLBACK OK (nada se modificó)');
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {
    /* sin transacción activa */
  }
  printError(error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
