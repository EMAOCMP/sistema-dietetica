# Acceso SQL a la base (asistente)

Permite al asistente **leer** las tablas y proponer cambios sin copiar y pegar SQL
en el panel de Supabase. Las escrituras requieren aprobación explícita.

## Configuración (una sola vez)

1. Supabase → **Project Settings** → **Database** → **Connection string**.
2. Elegí **Session pooler** (IPv4). La conexión directa (`db.REF.supabase.co`)
   resuelve solo IPv6 y en esta PC falla con `ENETUNREACH`.
3. Completá en `.env.local` (ya está el bloque armado, falta la contraseña):

```
PGHOST=aws-0-REGION.pooler.supabase.com
PGPORT=5432
PGDATABASE=postgres
PGUSER=postgres.REF
PGPASSWORD=la_password_de_la_base
```

El usuario del pooler lleva el prefijo del proyecto: `postgres.<REF>`.
Si el dashboard muestra `aws-1-...`, usá ese host.

También se acepta una URL completa (`DATABASE_URL=postgresql://...`), pero las
variables sueltas evitan problemas si la contraseña tiene `@ # % :`.

`.env.local` ya está ignorado por git (`*.local`). **No** compartas la
contraseña por chat ni la subas al repo.

## Uso

```bash
# Lectura (siempre en transacción READ ONLY + rollback)
npm run db -- "select * from products limit 5"
npm run db -- --file supabase/estado_prueba_compras.sql

# Escritura (requiere --write y --yes)
npm run db -- --file supabase/fix_6_recepcion_faltantes.sql --write --yes
```

Opciones: `--limit <n>` filas a mostrar (default 100), `--help`.

## Garantías

| Modo | Qué hace |
|---|---|
| Sin flags | `BEGIN READ ONLY`, timeout 60s, `ROLLBACK` al final |
| `--write --yes` | `BEGIN`, timeout 180s, `COMMIT` si todo salió bien; `ROLLBACK` ante cualquier error |
| `--write` sin `--yes` | Se niega a ejecutar |

Los `BEGIN;` / `COMMIT;` de los archivos `.sql` se descartan: la transacción
del cliente es la única que manda, así un script no puede escapar del modo
lectura ni dejar cambios a medias.

## Política con el asistente

- **Lecturas**: libres, sin pedir permiso.
- **Escrituras**: primero muestra el SQL completo, espera tu "dale", y recién
  ahí lo ejecuta con `--write --yes`.
- Los scripts que ya existen (`fix_*.sql`, `reset_*.sql`) siguen funcionando
  igual desde el panel de Supabase si preferís hacerlo a mano.

## Nota de seguridad

`DATABASE_URL` usa el usuario `postgres`: **no respeta RLS**. Es equivalente a
una llave maestra. Si querés separar tareas, más adelante se puede crear un rol
`agent_readonly` con `GRANT SELECT` para las lecturas y usar la cadena admin
solo para migraciones aprobadas.
