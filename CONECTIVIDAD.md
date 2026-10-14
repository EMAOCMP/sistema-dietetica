# Conexión PC → Celular (pruebas en línea, sin misma red WiFi)

Estructura de la infraestructura para probar la app desde el celular con datos reales pero sin tocar la PC ni exponer puertos a internet.

---

## 1. Diagrama general

```
                    ┌──────────────────────────────────────────────┐
                    │         TAILNET (red privada)               │
                    │   Cuenta: EMAOCMP@github / emaocmp.github    │
                    └──────────────────────────────────────────────┘
                                    │  VPN cifrada (4G/5G o WiFi)
        ┌───────────────────────────┼────────────────────────────┐
        │                           │                            │
┌───────▼────────┐          ┌───────▼─────────┐          ┌───────▼─────────┐
│  PC "shiva"    │          │  Celular        │          │  SUPABASE       │
│  Vite dev      │◄─────────│  "moto-g52"     │─ ─ ─ ─ ─►│  (nube)         │
│  server :3000  │  HTML/JS │  navegador      │  datos    │  URL + anon key │
│  100.77.145.127│          │  100.107.64.7   │  directo  │  RLS activo     │
└────────────────┘          └─────────────────┘          └─────────────────┘
```

**Flujo real de datos:**

| Qué | Ruta | ¿Pasa por internet? |
|---|---|---|
| App (HTML/JS/CSS) | PC → celular | Solo dentro de Tailscale (cifrado) |
| Consultas y escrituras | Celular → Supabase | **Directo desde el celular**, NO pasa por la PC |
| Identidad (login) | GitHub | Solo para entrar a Tailscale |

---

## 2. Componentes y cuentas

| Componente | Rol | Datos / ubicación |
|---|---|---|
| **PC** `shiva` | Corre el dev server de Vite | Windows 11, IP tailnet `100.77.145.127` |
| **Celular** `moto-g52` | Cliente de pruebas | Android, IP tailnet `100.107.64.7` |
| **Tailscale** | Red privada PC ↔ celular, sin exponer puertos | v1.102.4, `C:\Program Files\Tailscale\tailscale.exe` |
| **GitHub** | Identidad de login de Tailscale | `emaocmp.github` (no usa repositorio propio) |
| **Supabase** | Base de datos en la nube | `SUPABASE_URL` + `SUPABASE_ANON_KEY` en `.env.local` |

---

## 3. Archivos de configuración involucrados

| Archivo | Qué controla | Estado |
|---|---|---|
| `.env.local` | Credenciales de Supabase | ✅ ignorado por git (`*.local` en `.gitignore:13`) |
| `vite.config.ts:50` | `server.host: true` (acepta conexiones externas), `port: 3000`, `strictPort`, `allowedHosts: true` | ✅ |
| `src/lib/supabase.ts` | Usa **anon key** (pública por diseño) → la protección real es **RLS** en Supabase | ✅ |

---

## 4. URLs que funcionan (las únicas válidas)

| Desde | URL |
|---|---|
| PC | `http://localhost:3000` |
| Celular | `http://100.77.145.127:3000` |

**Checklist de conexión**

### En la PC
1. **Tailscale conectado**: icono en la bandeja → `Connected` (dispositivo `shiva`)
2. **Dev server corriendo**: `npm run dev`

### En el celular
1. **App Tailscale abierta** → interruptor `Connected` (VPN activa)
2. **Navegador** → `http://100.77.145.127:3000`

> ⚠️ Si la VPN del celular está apagada, la URL no carga. Si la PC está apagada o sin `npm run dev`, tampoco.
>
> ❌ No usar la IP de WiFi (`192.168.x.x`): el celular está en otra subred que no enruta. La ruta válida es siempre la IP de Tailscale.

---

## 5. Comandos de verificación (PC)

```powershell
# ¿Está conectada la tailnet y aparece el celular?
& "C:\Program Files\Tailscale\tailscale.exe" status

# IP propia de la PC en la tailnet
& "C:\Program Files\Tailscale\tailscale.exe" ip -4

# ¿Llego al celular? (esperás "pong from moto-g52")
& "C:\Program Files\Tailscale\tailscale.exe" ping 100.107.64.7

# ¿El dev server está escuchando en el puerto 3000?
Get-NetTCPConnection -LocalPort 3000 -State Listen

# ¿Responde usando la IP de Tailscale? (esperás "HTTP 200")
curl.exe -s -o NUL -w "HTTP %{http_code}" http://100.77.145.127:3000/
```

---

## 6. Protección de datos

1. **Proyecto Supabase separado de DEV**: `.env.local` debe apuntar a un proyecto de pruebas, no al de producción. Es la única forma de que lo que escribas desde el celular no afecte datos reales.
2. **`.env.local` no se commitea**: está cubierto por `*.local` en `.gitignore`.
3. **Solo anon key en el frontend**: nunca subir `SERVICE_ROLE` al código. El anon key viaja en el bundle JS (es público por diseño); la seguridad real la dan las políticas **RLS**.
4. **Sin exposición a internet**: Tailscale no abre el puerto 3000 al mundo; solo tus dispositivos en la tailnet llegan a él. No hace falta firewall especial ni túnel público.
5. **Offline con cuidado**: la app encola cambios en IndexedDB (`src/lib/offlineDB.ts`) y el sync engine los sube cada 10 s al volver la conexión (`src/lib/syncEngine.ts:24`). Si hiciste cambios de prueba offline, se sincronizarán al reconectar.

---

## 7. Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| La URL no carga en el celular | VPN del celular apagada | Abrir app Tailscale → `Connected` |
| La URL no carga | Dev server caído | `scripts\iniciar-dev.bat` (o `npm run dev`) |
| `Blocked request. This host is not allowed` | `allowedHosts` faltante | Verificar `vite.config.ts:53` → `allowedHosts: true` |
| El celular no aparece en `tailscale status` | Cuentas distintas | Re-login en el celular con `emaocmp.github` |
| Pide permiso de VPN y no lo otorga | Android lo bloqueó | Ajustes → Aplicaciones → Tailscale → Batería = Sin restricciones |
| Aparece pero `ping` falla | Firewall de Windows | Reglas de entrada para `node.exe` (Puerto 3000) |
| Carga pero muestra datos viejos | Service Worker | En dev se desregistra solo (`src/main.tsx:7`); probar en pestaña anónima |

---

## 8. Que el server no se corte (estabilidad)

**Problema**: al suspenderse la PC se corta la red y el celular pierde la app.

**Solución aplicada (dos partes):**

1. **La PC ya no se suspende ni hiberna sola** (con corriente y con batería):
   ```powershell
   powercfg /setacvalueindex   SCHEME_CURRENT SUB_SLEEP STANDBYIDLE   0   # nunca suspender (AC)
   powercfg /setdcvalueindex   SCHEME_CURRENT SUB_SLEEP STANDBYIDLE   0   # nunca suspender (batería)
   powercfg /setacvalueindex   SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE 0   # nunca hibernar (AC)
   powercfg /setdcvalueindex   SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE 0   # nunca hibernar (batería)
   powercfg /setactive SCHEME_CURRENT
   ```
   Para revertir (volver a suspender a los 30 min): `powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 1800 && powercfg /setactive SCHEME_CURRENT`

2. **El server arranca solo al iniciar sesión** (carpeta Inicio de Windows):
   - Accesso directo: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Dietetica Dev Server.lnk`
   - Ejecuta `scripts\iniciar-dev.bat` → si el puerto 3000 ya está activo, no hace nada (no duplica); si no, abre `npm run dev`.

**Control manual:**

| Acción | Comando / archivo |
|---|---|
| Arrancar (o no-op si ya corre) | `scripts\iniciar-dev.bat` |
| **Parar cuando vos quieras** | `scripts\detener-dev.bat` (mata el árbol de node del puerto 3000) |
| Parar a mano | `Ctrl+C` en la terminal de Vite |
| Log de eventos | `scripts\dev-server.log` |

> El script `iniciar-dev.bat` abre la consola de Vite en una ventana **minimizada**; la dejan abierta y el server corre de fondo hasta que ejecuten `detener-dev.bat`.

---

## 9. Apagar todo al terminar las pruebas

```powershell
# PC: scripts\detener-dev.bat   (o Ctrl+C en la terminal de Vite)

# Celular: app Tailscale → desconectar VPN (o desactivar en Ajustes → VPN)

# PC: cerrar Tailscale si querés (icono de bandeja → Exit)
```
