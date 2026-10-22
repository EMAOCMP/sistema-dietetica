# Design System — Dietética Vishal

> **Estado:** v2 — tokens canónicos definidos, adopción en curso (ver [§10 Estado real](#10-estado-real-de-la-adopción)).
> **Alcance:** describes el sistema **tal como está implementado hoy** en el código, no una especificación aspiracional.
> **Fuente de verdad:** `src/index.css` (tokens, efectos, temas) + `src/components/**` (componentes).
> **Última actualización:** 21/10/2026

---

## 0. Cómo leer este documento

| Marca | Significado |
| --- | --- |
| **Canónico** | Definido en `src/index.css` mediante `@theme` / `@theme inline`. Es la fuente de verdad. |
| **Heredado** | Clases y patrones heredados del diseño original (esmeralda, `slate`, hex hardcodeados) que siguen en el código. Funcionan, pero no son la referencia para código nuevo. |
| **En migración** | El token existe y es correcto, pero todavía no se usa en los componentes. |

Regla general: **el código nuevo usa tokens semánticos**; lo heredado se migra por vista cuando se toca esa vista.

---

## 1. Principios

1. **Semántico primero.** Los componentes no nombran colores, nombran intenciones: `bg-surface`, `text-tprimary`, `bg-action`, `text-ok`.
2. **Una sola fuente de color por vista.** La paleta base (`@theme`) es fija; el tema claro/oscuro se resuelve por variables CSS, nunca con condicionales en JSX.
3. **Densidad operativa.** La app se usa de pie, en mostrador, con guantes y con luz fuerte: jerarquía fuerte, targets táctiles ≥ 44 px, información numérica tabular.
4. **Oscuro por defecto.** El tema por defecto es `dark` (`localStorage['dv-theme'] || 'dark'`), porque el uso real es mayoritariamente nocturno.
5. **Accesibilidad por defecto.** Foco visible global, `prefers-reduced-motion` respetado, roles ARIA en todo componente no nativo.
6. **Offline visible.** El estado de conexión es parte de la UI, no un detalle: el usuario siempre sabe si sus datos están sincronizados.

---

## 2. Fundamentos

### 2.1 Color

#### 2.1.1 Paleta base — `@theme` (canónico)

`src/index.css:6-23`

| Familia | Tokens | Valores | Uso |
| --- | --- | --- | --- |
| **Obsidian** (escala oscura) | `obsidian-950` → `obsidian-600` | `#09090B` `#0C0C0F` `#18181B` `#27272A` `#3F3F46` | Fondos y bordes del tema oscuro |
| **Brand** (indigo/violeta) | `brand-300` → `brand-700` | `#A5B4FC` `#818CF8` `#6366F1` `#4F46E5` `#4338CA` | Acción primaria, foco, acentos de marca |
| **Accent** | `accent-orange` / `accent-emerald` | `#F97316` / `#10B981` | Semáforo: alertas y confirmaciones de marca |

> **Importante:** la escala `brand` **solo está definida de 300 a 700**. No existen `brand-50`, `brand-100`, `brand-200` ni `brand-800`. Usarlas hoy no genera CSS (ver [§10](#10-estado-real-de-la-adopción)).

#### 2.1.2 Tokens semánticos — `@theme inline` (canónico, DS v2 §1.1)

`src/index.css:25-43`. Cada token mapea a una variable que cambia con el tema:

| Token | Variable | Claro | Oscuro | Aplicación |
| --- | --- | --- | --- | --- |
| `bg-app` | `--bg-app` | `#F4F7F6` | `#09090B` | Fondo de la aplicación |
| `bg-surface` | `--bg-surface` | `#FFFFFF` | `#18181B` | Cards, paneles, sheets |
| `bg-elevated` | `--bg-elevated` | `#FFFFFF` | `#202024` | Popovers, dropdowns, tooltips |
| `bg-inputbg` | `--bg-input` | `#F8FAFC` | `#0C0C0F` | Campos de formulario |
| `border-subtle` | `--border-subtle` | `#E2E8F0` | `#27272A` | Separadores, bordes de card |
| `border-strong` | `--border-strong` | `#CBD5E1` | `#3F3F46` | Bordes de control (inputs, selects) |
| `text-tprimary` | `--text-primary` | `#0F172A` | `#F4F4F5` | Texto principal |
| `text-tsecondary` | `--text-secondary` | `#64748B` | `#A1A1AA` | Texto secundario / captions |
| `text-tdisabled` | `--text-disabled` | `#94A3B8` | `#71717A` | Texto deshabilitado |
| `bg-action` | `--action-primary` | `#6366F1` | `#6366F1` | Botón primario |
| `bg-actionhover` | `--action-primary-hover` | `#4F46E5` | `#4F46E5` | Hover del botón primario |
| `text-ok` | `--state-success` | `#10B981` | `#10B981` | Éxito |
| `text-warn` | `--state-warning` | `#F59E0B` | `#F59E0B` | Advertencia |
| `text-bad` | `--state-danger` | `#EF4444` | `#EF4444` | Error |
| `text-info` | `--state-info` | `#0EA5E9` | `#0EA5E9` | Información / encolado |

Los colores de estado son **idénticos en ambos temas** (solo cambia el fondo sobre el que se leen), lo que mantiene la lectura semántica del color.

#### 2.1.3 Reglas de color de marca

- **Acción primaria** = `brand-500` → `brand-600` en hover. Nunca `emerald` para CTA.
- **Esmeralda** queda reservada al dominio: POS/ventas, "Pro Activo", confirmaciones de stock.
- **Naranja** = warning de marca / acento (stock crítico).
- Contraste mínimo: texto sobre `bg-action` ≥ 4.5:1 (blanco sobre `#6366F1`).

#### 2.1.4 Tema oscuro: re-mapeo automático

`src/index.css:216-238` define overrides con `!important` que traducen las utilidades **heredadas** al tema Obsidian. Esto es lo que permite que `bg-white` / `bg-slate-100` / `text-slate-900` se vean bien sin tocar cada componente:

| Clase heredada | En `.dark` se convierte en |
| --- | --- |
| `.bg-white` | `#18181B` + borde `#27272A` |
| `.bg-slate-50` | `#18181B` + borde `#27272A` |
| `.bg-slate-100` | `#09090B` |
| `.bg-slate-200/80` | `#27272A` |
| `.text-slate-900` / `.text-slate-800` | `#FFFFFF` |
| `.text-slate-700` / `.text-slate-600` | `#C9C9C9` |
| `.text-slate-500` / `.text-slate-400` | `#A1A1AA` |
| `.border-slate-100/200` | `#27272A` |
| `input, select, textarea` | fondo `#18181B`, borde `#27272A`, texto `#FFF` |
| `dark:bg-[#1F1F1F]` / `dark:bg-[#232323]` | `#18181B` |
| `dark:border-[#333333]` | `#27272A` |

> Consecuencia práctica: en `.dark`, **escribir `bg-white` es válido y correcto** aunque el token semántico sea `bg-surface`.

#### 2.1.5 Glassmorphism

`src/index.css:156-186`. Útiles adaptativos:

| Clase | Claro | Oscuro |
| --- | --- | --- |
| `.glass-card` | `rgba(255,255,255,.72)` + blur 12px + borde `rgba(15,23,42,.08)` | `rgba(24,24,27,.72)` + borde `rgba(255,255,255,.08)` |
| `.glass-button` | `rgba(255,255,255,.65)`, hover → `.95` + borde `brand-500/45` | `rgba(255,255,255,.03)`, hover → `.08` |

---

### 2.2 Tipografía

- **Familia:** `Plus Jakarta Sans` (400/500/600/700/800) vía Google Fonts, declarada en `index.html` y en `--font-sans` (`src/index.css:22`).
- **Fallback:** `ui-sans-serif, system-ui, sans-serif`.
- **Features activas:** `cv11`, `ss01` (ligaduras y alternativas contextuales), `text-rendering: optimizeLegibility`, `antialiased`.

#### Escala en uso

| Rol | Clases | Peso |
| --- | --- | --- |
| Título de vista | `text-xl` / `text-2xl` | `font-bold` / `font-extrabold` |
| Título de card | `text-sm` / `text-base` | `font-bold` / `font-extrabold` |
| Cuerpo | `text-sm` | `font-medium` |
| Dato / label | `text-xs` | `font-semibold` / `font-bold` |
| Micro / caption | `text-[10px]` / `text-[11px]` | `font-bold`, con `uppercase tracking-wider` en eyebrows y labels |
| Cifra numérica | `text-2xl` … `text-4xl` | `font-black` + `.tnum` |

**Pesos en uso:** `font-medium` (texto normal), `font-semibold` (navegación, botones), `font-bold` (títulos de sección, chips), `font-extrabold` (títulos de card y CTA), `font-black` (cifras KPI).

#### Números tabulares

`.tnum` (`src/index.css:101-104`) aplica `font-variant-numeric: tabular-nums`. **Es obligatorio en todo dato que se compare en columna** (importes, cantidades, stock). Hay ~200 usos en el código; cualquier cifra nueva en tabla debe llevarlo.

#### Etiquetas en mayúscula

Los "eyebrows" y badges de rol usan `uppercase tracking-wider` con `text-[10px]` / `text-[11px]`. Patrón canónico: `text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500`.

---

### 2.3 Espaciado y layout

Escala Tailwind estándar (v4). Criterios adoptados:

| Contexto | Padding | Gap |
| --- | --- | --- |
| Card estándar | `p-4` a `p-6` | `space-y-3` a `space-y-6` |
| Botón | `px-4 py-2.5` (mediano), `px-6 py-3` (primario grande) | `gap-2` interno |
| Item de navegación | `px-3 py-2.5` | `gap-3` |
| Fila de tabla | `px-4 py-3` | `gap-2` |
| Grilla de KPIs | `grid gap-4 sm:gap-6` / `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` | — |
| Contenedor de página | `max-w-7xl mx-auto px-4 sm:px-6` | — |

Regla: **padding vertical mínimo `py-2.5`** en controles; nada importante por debajo de `py-2`.

---

### 2.4 Radios

| Radio | Clase | Uso |
| --- | --- | --- |
| 8 px | `rounded-lg` | Chips, items de nav, botones pequeños |
| 12 px | `rounded-xl` | Botones, inputs, badges, cards internas |
| 16 px | `rounded-2xl` | **Radio por defecto de card** (157 usos) |
| 24 px | `rounded-3xl` | Cards destacadas, modales, empty states (47 usos) |
| 9999 px | `rounded-full` | Avatares, FAB, dots, pills |

Regla: **`rounded-2xl` es el radio estándar de superficie**; `rounded-3xl` para contenedores que flotan (modal, sheet, empty state).

---

### 2.5 Sombras

| Token / clase | Valor | Uso |
| --- | --- | --- |
| `shadow-card` | `0 4px 20px -2px rgba(0,0,0,.05), 0 0 3px rgba(0,0,0,.03)` | Card en reposo |
| `.card-hover` | + `translateY(-2px)` y `0 10px 25px -5px rgba(0,0,0,.15)` al hover | Card interactiva |
| `shadow-glow-brand` | `0 0 20px rgba(99,102,241,.35)` | Foco de marca, FAB, activo de sidebar, logo |
| `shadow-glow-emerald` | `0 0 20px rgba(16,185,129,.35)` | Acento esmeralda (uso puntual) |
| `shadow-glow-orange` | `0 0 20px rgba(249,115,22,.35)` | Definido, sin uso actual |
| `shadow-lg shadow-brand-500/25` | sombra tintada | CTA primario (`EmptyState`) |
| `shadow-2xl` | — | Modales y menús flotantes |
| `shadow-[0_18px_50px_-12px_rgba(0,0,0,.6)]` | — | Menú de acciones (`ActionDropdown`) |

---

### 2.6 Iconografía

- **Librería canónica:** `@phosphor-icons/react` (11 archivos). Permite `weight="fill" | "regular" | "bold"`, usado para marcar el ítem activo.
- **Librería heredada:** `lucide-react` (22 archivos). Sigue siendo válida; no se migra por volumen, se migra por archivo tocado.
- **Tamaños:** `size={12|13|14}` micro (chips, inline), `size={16|18}` navegación y botones, `size={20|22|24}` iconos de acción, `size={32}` headers de modal.
- **Ícono activo:** `weight="fill"` + color `brand-600` / `brand-400` (dark).
- **Regla de color:** un ícono heredado de un estado de negocio (stock crítico, pago, etc.) hereda el color del estado (`text-red-500`, `text-emerald-500`).

---

### 2.7 Movimiento

| Animación | Clase | Duración / curva |
| --- | --- | --- |
| Entrada de fila | `.animate-row` | 0.25 s ease-out, `translateY(6px) → 0` |
| Entrada de vista | `.view-fade` | 0.3 s ease-out, `translateY(10px) → 0` |
| Latido de alerta | `.pulse-alert` | 1.6 s infinito (escala 1 → 1.12) |
| Blob decorativo | `.animate-blob` | 4 s infinito, `translateY(-5px) scale(1.05)` |
| Skeleton | `.skeleton` | shimmer 1.2 s lineal |
| Cambio de tema | global `body, body *` | 200 ms `cubic-bezier(.4,0,.2,1)` sobre color/fondo/borde/sombra |
| Hover de card | `.card-hover` | 0.2 s ease-in-out |
| Hover de botón | Tailwind `transition` | 150–200 ms |
| Feedback de presión | `active:scale-95` / `active:scale-[0.97]` | 즉시, en CTAs y items de menú |
| Panel / popover | `animate-in fade-in-0 zoom-in-95 duration-150` | 150 ms |

**Regla de movimiento reducido** (`src/index.css:114-126`): con `prefers-reduced-motion: reduce` se anulan `pulse-alert`, `animate-row`, `view-fade`, `animate-blob`, `skeleton` y se fuerza `transition-duration: .01ms` en todo el árbol. **Nunca agregar animaciones fuera de estas clases sin agregarlas también a ese bloque.**

---

### 2.8 Bordes y scrollbar

- Scrollbar global: 6 px, track transparente, thumb `#CBD5E1` (claro) / `#3F3F46` (oscuro), hover `#94A3B8` / `#52525B`.
- `.custom-scrollbar`: `scrollbar-width: thin`, `scrollbar-color: #3f3f46 transparent` — usado en contenedores con scroll interno (nav, panel de modal).
- Grosor de borde por defecto: `border` (1 px). `border-2` solo en controles de formulario que necesitan emphasized (`SelectMenu`).

---

## 3. Layout y navegación

### 3.1 Estructura del proyecto

```
src/
├── components/
│   ├── ui/        → primitivas reutilizables (ModalShell, SelectMenu, ActionDropdown, DatePicker…)
│   ├── layout/    → shell y navegación (Navbar, MobileTabBar, Login, NewPassword)
│   ├── views/     → pantallas completas (Dashboard, POS, Products, History, Reports…)
│   └── charts/    → visualizaciones (SalesTrend, RevenueBreakdown, CategoryProfits…)
├── features/
│   ├── onboarding/→ GuideCenter, ProductTour, SectionHint, ContextualTooltip, EmptyState, OnboardingProvider, progressStore
│   └── scanner/   → ScannerProvider, ScannerModal, engines/, services/, hooks/
├── lib/           → lógica de negocio y acceso a datos (supabase, sales, sync, export, onboardingProgress…)
├── hooks/         → hooks reutilizables (useOnlineStatus)
└── index.css      → TOKENS (fuente de verdad del DS)
```

**Regla de ubicación:** si un componente se usa en más de una vista y no tiene lógica de negocio → `components/ui`. Si es una pantalla completa → `components/views`. Si es un flujo autocontenido con su propio provider → `features/<nombre>`.

### 3.2 App shell

`src/App.tsx`

- Contenedor raíz: `min-h-screen flex bg-[#f4f7f6] text-slate-800 dark:bg-obsidian-950 dark:text-zinc-200`.
- Orden de montaje: `<OnboardingProvider>` → `<ScannerProvider>` → `Navbar` → `OfflineIndicator` → `CommandPalette` → vista activa → `MobileTabBar` → toast.
- Vista activa por `activeTab`; los módulos pesados se montan condicionalmente (lazy por tab).
- Estados globales de shell: `theme`, `sidebarOpen`, `collapsed`, `paletteOpen`, `profile`, `toast`.

### 3.3 Sidebar (`components/layout/Navbar.tsx`)

- Ancho `w-64` (expandida) / `lg:w-20` (plegada), `fixed` en móvil y `lg:static` en escritorio.
- Secciones: **Principal** (Panel, Venta POS, Productos/Stock) y **Gestión** (Ingreso, Historial, Mi actividad, Cierre de caja, Reportes, Usuarios). `Configuración` al pie para `admin | supervisor | vendedor`.
- Ítem activo: `bg-brand-500/10 text-brand-600 dark:text-brand-400` + barra lateral `w-1 h-8 rounded-r-full bg-brand-500 shadow-glow-brand`.
- Ícono activo: `weight="fill"`.
- Badges: `text-[10px] font-bold px-1.5 py-0.5 rounded-full`, `bg-red-500` (stock crítico) y `bg-sky-500` (pendientes de sync); con `99+` a partir de 100.
- Cabecera: logo con `shadow-glow-brand`, nombre en `uppercase tracking-wider`, chip de rol `Pro Activo` en `accent-emerald`.
- Colapsado: ícono centrado, `title` como tooltip, badge superpuesto al ícono.

### 3.4 Barra inferior móvil (`components/layout/MobileTabBar.tsx`)

Visible solo `< lg`. Estructura: `Panel` · `Venta` · **[ESCANEAR]** · `Stock` · `Más`.

- Botón central: círculo `w-12 h-12 -mt-7 rounded-full shadow-glow-brand`, `bg-emerald-600`, ícono `QrCode` 24px.
- Sheets inferiores (`rounded-t-3xl`, `animate-row`) para "Escanear" (Vender / Ingreso / Producto) y "Más".
- `paddingBottom: env(safe-area-inset-bottom)` + `calc(2rem + env(safe-area-inset-bottom))` en el sheet.
- Lanza el escáner de la vista destino con el evento global `dv:open-scanner` (120 ms de delay para el montaje).

### 3.5 Command Palette (`components/ui/CommandPalette.tsx`)

- Atajo global **⌘K / Ctrl+K** (`src/App.tsx:196-205`).
- Búsqueda de acciones y productos; al elegir un producto escribe `dv-product-search` en `localStorage` y remonta la vista de productos.
- Overlay `fixed inset-0` + panel centrado con `backdrop-blur`; se cierra con `Escape` o click fuera.

### 3.6 Breakpoints

Tailwind por defecto. Los cortes usados en la app:

| Breakpoint | Comportamiento |
| --- | --- |
| `< 640px` (base) | Una columna; tablas con scroll horizontal; sheets a pantalla completa |
| `≥ 640px` (`sm`) | KPIs a 2 columnas, padding de página `sm:px-6` |
| `≥ 768px` (`md`) | Grillas de detalle a 2 columnas |
| `≥ 1024px` (`lg`) | Sidebar visible y plegable; **se oculta la `MobileTabBar`**; contenido en `lg:flex-row` |
| `≥ 1280px` (`xl`) | Contenedores `max-w-7xl` centrados |

---

## 4. Componentes

### 4.1 Botones

No hay un `<Button>` centralizado: los patrones se replican por clase. Patrones canónicos:

**Primario (acción de marca):**
```tsx
className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-brand-500/25 transition active:scale-95 cursor-pointer"
```

**Primario oscuro (modal, heredado):**
```tsx
className="px-6 py-3 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 text-white rounded-xl text-sm font-bold shadow cursor-pointer transition"
```

**Secundario / contorno:**
```tsx
className="px-3.5 py-2 bg-white dark:bg-obsidian-800 border border-[#e2e8f0] dark:border-white/10 text-slate-600 dark:text-zinc-300 rounded-xl text-xs font-bold shadow-sm hover:border-slate-300 dark:hover:border-brand-500 hover:bg-slate-50 dark:hover:bg-white/5 transition cursor-pointer"
```

**Píldora de menú (fila de tabla):**
```tsx
className="inline-flex items-center gap-1.5 px-3.5 py-2 … rounded-xl text-xs font-bold … transition cursor-pointer"
```

Reglas comunes:
- Todo botón interactivo: `cursor-pointer`.
- Todo control: `focus-visible` heredado global (outline 2px `#818CF8`).
- Estado abierto de un trigger: `border-brand-500 ring-2 ring-brand-500/20`.
- Botón de icono: `p-1.5 rounded-lg` + `text-slate-400 hover:text-slate-900 hover:bg-slate-100`.
- Icono dentro del botón: `shrink-0`.

### 4.2 Cards y superficies

```tsx
// Card estándar
className="bg-white dark:bg-obsidian-800 border border-slate-200 dark:border-obsidian-700 rounded-2xl p-5 shadow-card"

// Card interactiva (con hover)
className="… rounded-2xl card-hover cursor-pointer"

// Card de glass (dashboard, onboarding)
className="glass-card rounded-3xl p-8 sm:p-10"
```

Jerarquía de superficies: `bg-app` (fondo) → `bg-surface` (card) → `bg-elevated` (popover/modal).

### 4.3 Formularios

- Inputs: `w-full px-3 py-2.5 bg-slate-50 dark:bg-obsidian-900 border border-slate-200 dark:border-obsidian-700 rounded-xl text-sm focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 transition`.
- Labels: `text-xs font-bold text-slate-600 dark:text-zinc-400 mb-1.5 block`.
- Errores: `text-red-500 text-xs mt-1` + borde `border-red-400`.
- Campos con `input`/`select`/`textarea` reciben automáticamente el estilo oscuro por la regla global `src/index.css:230`.

### 4.4 Selects propios (sin `<select>` nativo)

Hay dos componentes, ambos con portal o posicionamiento propio:

| Componente | Uso | Particularidad |
| --- | --- | --- |
| `components/ui/SelectMenu.tsx` | Listbox compacto (`px-3 py-2`, `text-xs`) | Panel con `animate-in fade-in-0 zoom-in-95`, opción activa en `bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10`, ícono `Check` |
| `components/ui/RoundedSelect.tsx` | Select con modo oscuro y alineación | `size` (`md`/`sm`), `align` (`left`/`right`), calcula posición del panel |

Ambos: `Escape` cierra, click fuera cierra, `aria-haspopup="listbox"`, `role="listbox"`, `aria-selected` en la opción activa.

### 4.5 DatePicker (`components/ui/DatePicker.tsx`)

Calendario mensual propio con panel flotante, navegación de mes, selección por día, rango de presets y soporte de tema oscuro. Es el patrón de referencia para popovers flotantes.

### 4.6 Modal (`components/ui/ModalShell.tsx`)

Contrato único para todos los modales:

```tsx
<ModalShell
  onClose={fn}
  icon={<Icon />}
  title="Título"
  maxWidth="max-w-xl"          // default
  headerActions={<>…</>}
  footer={<>…</>}               // default: botón "Cerrar"
>
  {children}
</ModalShell>
```

- Portal a `document.body`, overlay `bg-black/60 backdrop-blur-sm`, `z-50`.
- Panel `rounded-3xl p-6 space-y-6 shadow-2xl`, `max-h-[90vh]`, body con scroll (`custom-scrollbar`), header y footer fijos.
- `Escape` cierra; `document.body.style.overflow = 'hidden'` mientras está abierto (se restaura al cerrar).
- `role="dialog"`, `aria-modal="true"`, `aria-label={title}`.
- El botón "Cerrar" del footer es **invertido** en oscuro (`dark:bg-white dark:text-slate-900`).

### 4.7 Menú contextual de fila (`components/ui/ActionDropdown.tsx`)

- Trigger tipo píldora; el menú se renderiza en **portal** a `document.body` (`z-[9999]`) para escapar del stacking context de tablas.
- Posicionamiento calculado: abre hacia arriba si no hay espacio; se clamp a `8px` de los bordes del viewport.
- Cierra con click fuera, scroll o resize.
- Cada ítem: punto de color (`bg-brand-500`, o `bg-red-400` si `danger`), ícono opcional, `text-[14px] font-semibold`, hover con `hover:pl-3.5` (desplazamiento de 2px).
- Ítem `danger`: `text-red-600 dark:text-red-400` + `hover:bg-red-50 dark:hover:bg-red-500/10`.

### 4.8 Badges, chips y píldoras

| Uso | Clases |
| --- | --- |
| Rol del usuario | `border border-accent-emerald/50 text-accent-emerald bg-accent-emerald/10 text-[10px] uppercase tracking-wider font-bold rounded-lg px-2 py-0.5` |
| Conteo en navegación | `text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white` |
| Estado / semicírculo | `w-1.5 h-1.5 rounded-full bg-accent-emerald animate-pulse` |
| Chip de filtro | `rounded-lg px-2.5 py-1 text-xs font-bold` |

### 4.9 Toasts

Implementación central en `src/App.tsx:117-129`.

- API: `showToast(msg, kind?)` con `kind: 'info' | 'success' | 'warning' | 'error'`.
- **Duración (DS v2 §4.6):** `success`/`info` → 3.5 s; `warning`/`error` → 6 s.
- Color por tipo: `bg-emerald-500/15 text-emerald-500` · `bg-amber-500/15 text-amber-500` · `bg-red-500/15 text-red-500` · `bg-sky-500/15 text-sky-500`.
- `role="alert"` para `warning`/`error`, `role="status"` para el resto.
- Las vistas pueden trabajar sin el toast global: reciben `showToast?` y, si no existe, usan un toast local con auto-cierre.

### 4.10 Estados vacíos, carga y error

- `features/onboarding/EmptyState.tsx`: card glass `rounded-3xl p-8 sm:p-10 text-center`, ícono en `w-16 h-16 rounded-2xl bg-brand-500/10 dark:bg-brand-500/15`, título `text-lg font-extrabold`, CTA `bg-brand-500 hover:bg-brand-600`.
- `.skeleton`: shimmer para placeholders (4 usos actuales).
- `.pulse-alert`: latido para alertas que requieren atención inmediata.

### 4.11 Offline y sincronización (`components/ui/OfflineIndicator.tsx`)

Píldora fija `fixed bottom-4 right-4 z-50` con `animate-in slide-in-from-right`:

| Estado | Presentación |
| --- | --- |
| Sin conexión | ámbar · `WifiOff` con `animate-pulse` · chip "Offline" |
| Con red + pendientes | cielo · `RefreshCw` (girando si sincroniza) · chip "N pendientes" |
| Con red + sincronizado | esmeralda · `Wifi` · chip "Todo sincronizado" |

Se oculta por completo si hay red, la cola está vacía y no hubo corte.

### 4.12 Notificaciones (`components/ui/NotificationsPanel.tsx`)

Panel lateral con lista de avisos, marca de no leídos y acciones por ítem.

### 4.13 Onboarding

El "Centro de guías" es un **product tour / coach marks**: overlay oscuro con spotlight sobre el elemento real (`data-tour="..."`), tarjeta explicativa y navegación automática entre secciones. No es documentación estática.

| Pieza | Componente | Persistencia |
| --- | --- | --- |
| Índice de guías | `features/onboarding/GuideCenter.tsx` | `user_onboarding_progress` + local |
| Tour de producto | `features/onboarding/ProductTour.tsx` | ídem |
| Aviso contextual | `features/onboarding/SectionHint.tsx` | ídem |
| Tooltip contextual | `features/onboarding/ContextualTooltip.tsx` | ídem |
| Estado vacío | `features/onboarding/EmptyState.tsx` | — |
| Provider | `OnboardingProvider` (`useOnboarding()`) | — |
| Estado | `features/onboarding/progressStore.ts` | local + nube |
| Posición del cartel | `features/onboarding/tipPosition.ts` (`computeTipBox`) | — |

**Estado (`OnboardingProgress`)**

| Campo | Significado |
| --- | --- |
| `tourDone` | Terminó el tour inicial o el recorrido completo |
| `chapters[]` | Guías por sección completadas |
| `sections[]` | Secciones cuyo aviso contextual ya se mostró |
| `tips[]` | Tooltips contextuales ya vistos |
| `visited[]` | Secciones visitadas (checklist del dashboard) |
| `checklistHidden` | El checklist de inicio fue ocultado |

**Persistencia en dos capas**

- **Local**: `localStorage['dv-onboarding-progress-v1']` (JSON). Es la caché inmediata y la cola offline. Las claves viejas (`dv-tour-done-v1`, `dv-chapter-done-*`, `dv-section-seen-*`, `dv-tip-*`, `dv-visited-*`) se migran automáticamente la primera vez.
- **Nube**: tabla `user_onboarding_progress` (`supabase/onboarding_progress.sql`), una fila por usuario. El merge se hace en el servidor con `merge_onboarding_progress`, que **une** (nunca pisa) y por eso un write offline viejo no borra progreso más nuevo. `p_reset = true` sobrescribe: lo usa "Reiniciar progreso".

Reglas:

- El tour se lanza automáticamente 800 ms después del login, **esperando a que termine la hidratación** (`ready` del provider) para no repetirlo en un dispositivo donde ya se completó.
- Los objetivos del tour se marcan con `data-tour="sidebar"` (y equivalentes) en el DOM.
- El tooltip contextual abre con `Info` de 13 px, panel `w-56 sm:w-64 glass-card rounded-2xl p-3.5`, y se marca como visto la primera vez que se abre.
- Si `localStorage` está bloqueado (modo privado) el estado vive solo en memoria y el tour no se reinicia en cada recarga.

**Carteles del tour (coach marks)**

- Fondo **opaco** (`bg-white dark:bg-[#1F1F1F]` + borde), nunca `glass-card`: el elemento resaltado queda sin oscurecer detrás del cartel y el `backdrop-blur` lo convertía en una mancha borrosa.
- Ancho fijo 340 px (desktop); en mobile, hoja inferior a 12 px de los bordes.
- Cabecera: chip de ícono `w-8 h-8 rounded-xl bg-brand-500/15` + nombre de la guía en mayúsculas (`text-[10px] font-extrabold uppercase tracking-widest`) + "Paso X de Y".
- Spotlight: `boxShadow: 0 0 0 2px rgba(99,102,241,.95), 0 0 0 7px rgba(99,102,241,.22), 0 0 0 9999px rgba(2,6,23,.74)` → halo índigo que marca el elemento.
- Posición: `computeTipBox()` elige el lado pedido (top/bottom/left/right) y **evita tapar el elemento resaltado**; si no cabe, prueba los otros lados y, como último recurso, elige la posición que menos lo superpone. Nunca queda bajo el header de la app (`TOP_SAFE = 76`).

### 4.14 Escáner y balanza (`features/scanner/`)

- `ScannerProvider` expone el contexto de escaneo a toda la app; `ScannerModal` es la UI.
- Tres motores: `CameraScannerEngine` (html5-qrcode), `HardwareScannerEngine` (teclado, ignora Ctrl/Meta/Alt), `ImageScannerEngine` (archivo).
- Servicios puros y testeados: `barcodeNormalizer`, `barcodeValidator`, `barcodeResolver`, `catalogResolver`, `scaleParser`, `scanGuard`, `scanPipeline`.
- El visor de html5-qrcode se limpia por CSS (`src/index.css:317-325`): se ocultan las regiones sombreadas y el video usa `object-fit: cover`.

### 4.15 Gráficos (`components/charts/`)

`SalesTrendChart`, `RevenueBreakdown`, `CategoryProfits`, `HourlyDemand`, `PaymentDonut`, `StockBreakdown`, `TopSellers`. Reglas:

- Sin librería externa de charts: SVG + Tailwind.
- Colores de serieTaken de la paleta semántica: `brand-*` (principal), `emerald` (secundario), `accent-orange` (terciario), `obsidian-*` (neutro).
- Toda cifra en un gráfico usa `.tnum`.
- Leyenda con dot `w-2 h-2 rounded-full` + etiqueta `text-xs`.

---

## 5. Matriz de estados y feedback

| Situación | Pattern | Componente |
| --- | --- | --- |
| Sin datos | EmptyState con CTA | `features/onboarding/EmptyState.tsx` |
| Cargando | `.skeleton` | inline |
| Éxito | Toast esmeralda 3.5 s | `showToast(msg, 'success')` |
| Advertencia | Toast ámbar 6 s | `showToast(msg, 'warning')` |
| Error | Toast rojo 6 s + `role="alert"` | `showToast(msg, 'error')` |
| Sin conexión | Pills ámbar fija | `OfflineIndicator` |
| Pendientes de sync | Pills cielo + contador | `OfflineIndicator` |
| Stock crítico | `bg-red-500` badge + `pulse-alert` | Navbar / Dashboard |
| Menú de acciones | Portal `z-[9999]` con `animate-row` por ítem | `ActionDropdown` |
| Atajo global | `⌘K` / `Ctrl+K` | `CommandPalette` |

---

## 6. Accesibilidad

- **Foco visible global** (`src/index.css:107-111`): `outline: 2px solid #818CF8; outline-offset: 2px`. **Nunca eliminarlo** sin reemplazarlo por un anillo equivalente.
- **Movimiento reducido** respetado en todo el árbol (§2.7).
- **Roles y etiquetas** obligatorios en lo no nativo:
  - Modales: `role="dialog"` + `aria-modal` + `aria-label`.
  - Listboxes: `role="listbox"` / `role="option"` + `aria-selected` + `aria-expanded`.
  - Toasts: `role="alert"` (warning/error) o `role="status"`.
  - Iconos-botón: `aria-label` obligatorio (`aria-label="Cerrar"`, `aria-label="Escanear"`, `aria-label="Más opciones"`).
  - Navegación: `<nav aria-label="Navegación principal">`.
- **Teclado:** `Escape` cierra modales, selects y menús. ⌘K/Ctrl+K abre la paleta de comandos.
- **Contraste:** texto principal ≥ 4.5:1 sobre su fondo; los estados (`ok`/`warn`/`bad`/`info`) están fijados en ambos temas para no perder legibilidad.
- **Objetivos táctiles:** ≥ 44 px en navegación móvil y acciones principales.
- **Números:** siempre con `.tnum` en tablas para alineación y lectura rápida.

---

## 7. Impresión

`src/index.css:241-315` define un flujo de impresión A4 con dos áreas:

- `#ticket-print-area` → ticket de 320 px (ventas POS).
- `#dashboard-print-area` → reporte del panel.

Reglas:
- Todo lo demás se oculta con `visibility: hidden`.
- `.no-print` / `.print-hide` → `display: none`.
- Fondos oscuros → blanco; texto blanco → tinta `#0F172A`; sin sombras ni animaciones.
- Listas con scroll (`max-h-*`, `overflow-*`) se expanden a altura completa.
- `thead` → `table-header-group` (se repite en cada página) y `tr` / `.rounded-2xl` → `break-inside: avoid-page`.
- `@page { size: A4 portrait; margin: 12mm; }`.

---

## 8. Offline y datos (parte del diseño)

- Cola en IndexedDB (`lib/offlineDB.ts`) + motor de sincronización (`lib/syncEngine.ts`).
- El estado de la cola es visible (badge en el sidebar + `OfflineIndicator`).
- Las vistas degradan sin red: los badges de navegación se omiten silenciosamente si la consulta falla.
- `useOnlineStatus()` (`hooks/useOnlineStatus.ts`) centraliza `online`/`offline` y expone `wasOffline` para el mensaje de "todo sincronizado".

---

## 9. Convenciones para código nuevo

1. **Colores:** usá tokens semánticos o de paleta. Prohibido inventar hexadecimales nuevos.
2. **Tema:** toda clase de color debe tener su variante `dark:` (o usar los overrides globales de [§2.1.4](#214-tema-oscuro-re-mapeo-automático)).
3. **Radio:** `rounded-2xl` para superficies, `rounded-xl` para controles, `rounded-full` para pills.
4. **Números:** `.tnum` en toda cifra de tabla o KPI.
5. **Botones:** `cursor-pointer` + `focus-visible` (automático) + `transition` + estado `active:`.
6. **Íconos:** Phosphor; `size` según jerarquía (12–14 / 16–18 / 20–24).
7. **Modales:** siempre `ModalShell`; nunca modal bespoke sin `role="dialog"`, `aria-modal` y cierre con `Escape`.
8. **Listados con menú:** siempre `ActionDropdown` (portal) para evitar clipping.
9. **Animación:** usar solo las clases de [§2.7](#27-movimiento); si agregás una, agregala también al bloque `prefers-reduced-motion`.
10. **CSS:** todo en clases de Tailwind. El único `.css` del proyecto es `src/index.css` (tokens y efectos); el `src/App.css` residual del template de Vite ya fue eliminado.
11. **Toasts:** siempre vía `showToast` del shell, no `alert()`.
12. **Estados vacíos:** siempre `EmptyState`, con CTA cuando hay acción posible.

---

## 10. Estado real de la adopción

Medición sobre `src/**` (89 archivos `.ts/.tsx`) y sobre el CSS compilado con Tailwind CLI.

### 10.1 Lo que ya está completo

- Paleta base, escala Obsidian, tokens semánticos y themes claro/oscuro definidos y funcionales.
- Sistema de glassmorphism, sombras, animaciones y `prefers-reduced-motion`.
- Primitivas de UI reutilizables y consistentes: `ModalShell`, `SelectMenu`, `RoundedSelect`, `ActionDropdown`, `DatePicker`, `ScaleModal`, `OfflineIndicator`, `NotificationsPanel`, `CommandPalette`.
- Layout responsive completo: sidebar de escritorio plegable + `MobileTabBar` con sheets.
- Onboarding funcional: tour + tooltips contextuales + empty states.
- Flujo de impresión A4 para ticket y reporte de panel.
- Pruebas unitarias en `src/lib/__tests__`, `src/features/scanner/services/__tests__` y `src/hooks/__tests__`.
- Limpieza del template de Vite: `src/App.css` y `src/assets/*.svg` ya no existen; el proyecto quedó con `src/index.css` como único CSS.

### 10.2 Lo que está a medio migrar

| Área | Estado | Dato medido |
| --- | --- | --- |
| Tokens semánticos | **En migración** | `bg-app`, `text-tprimary`, `bg-elevated`, `border-subtle`, `bg-action`, `text-ok` tienen **0 usos** en el código |
| Paleta de marca | **Parcial** | `bg-brand-500` 27 usos, `bg-brand-600` 7; conviven con `bg-emerald-600` 50 usos (dominio POS heredado) |
| Escala `brand` | **Rota** | `brand-50` (56 usos), `brand-100`/`brand-200` (3 c/u) y `brand-800` (2) **no están definidas** en `@theme`: esas utilidades **no generan CSS** y no se ven. Ej.: `from-brand-50/50` en la cabecera del sidebar (`Navbar.tsx:147`) |
| Tema oscuro | **Heredado** | 72 usos de `dark:bg-[#1F1F1F]` / `dark:bg-[#333333]` hardcodeados, mitigados por los overrides de `index.css:233-238`; conviven con 22 usos de `dark:bg-obsidian-800` |
| Iconografía | **Mixta** | Phosphor en 11 archivos, Lucide en 22 |
| `bg-surface` | **Falso positivo** | La utilidad existe en el CSS compilado solo porque el scanner toma `bg-surface` del texto `--bg-surface` en `index.css`; no hay uso real |

### 10.3 Deuda priorizada

| # | Acción | Impacto |
| --- | --- | --- |
| 1 | Definir `brand-50/100/200/800` en `@theme` (o migrar esos 64 usos a `brand-300/400` o al color semántico correspondiente) | Corrige elementos hoy invisibles |
| 2 | Migrar `dark:bg-[#1F1F1F]` y `dark:border-[#333333]` a `dark:bg-obsidian-800` / `dark:border-obsidian-700` | Permite borrar el bloque de re-mapeo de `index.css:233-238` |
| 3 | Adoptar los tokens semánticos en las vistas nuevas (`bg-surface`, `text-tprimary`, `bg-action`) | Habilita cambiar el tema sin tocar componentes |
| 4 | Unificar iconografía en Phosphor archivo por archivo | Consistencia de peso y estado `fill` |
| 5 | Extraer un `<Button>` / `<Card>` base a `components/ui/` | Menos drift entre 20+ pantallas |

---

## 11. Checklist de contribución

Antes de abrir un PR:

- [ ] ¿Usé tokens semánticos o de paleta? ¿No inventé hexadecimales?
- [ ] ¿La vista funciona en claro **y** oscuro?
- [ ] ¿Las cifras de tabla/KPI llevan `.tnum`?
- [ ] ¿Los iconos-botón tienen `aria-label`?
- [ ] ¿El modal cierra con `Escape` y tiene `role="dialog"` + `aria-modal`?
- [ ] ¿El menú contextual usa `ActionDropdown` (portal) y no se clippea?
- [ ] ¿Las animaciones están registradas en el bloque `prefers-reduced-motion`?
- [ ] ¿Los estados vacíos usan `EmptyState` con CTA?
- [ ] ¿Los toasts usan `showToast` y la duración correcta (3.5 s / 6 s)?
- [ ] ¿La vista es usable a 360 px de ancho y con teclado?
- [ ] `npm run lint` y `npm run build` (`tsc -b && vite build`) en verde.

---

## Referencias rápidas

| Necesito… | Voy a… |
| --- | --- |
| Cambiar un color de marca | `src/index.css:12-18` (`@theme`) |
| Cambiar un color semántico por tema | `src/index.css:45-79` (`:root` / `.dark`) |
| Agregar un token semántico | `src/index.css:27-43` (`@theme inline`) + `:root` + `.dark` |
| Ver una card implementada | `src/components/views/DashboardView.tsx` |
| Ver un modal | `src/components/ui/ModalShell.tsx` |
| Ver un menú flotante | `src/components/ui/ActionDropdown.tsx`, `src/components/ui/SelectMenu.tsx` |
| Ver navegación | `src/components/layout/Navbar.tsx`, `src/components/layout/MobileTabBar.tsx` |
| Ver un estado vacío | `src/features/onboarding/EmptyState.tsx` |
| Ver el flujo de impresión | `src/index.css:241-315` + `#dashboard-print-area` / `#ticket-print-area` |
