# Estructura del Proyecto - Parte 2: Base de Datos y Backend (Supabase)

Este documento detalla la estructura de la base de datos PostgreSQL, esquemas, políticas de seguridad (RLS), funciones RPC y Edge Functions ubicadas en `supabase/`.

## 1. Modelos de Datos y Tablas Principales (`supabase/*.sql`)
- **`mvp_stock_model.sql` & `suppliers_policies.sql`**: Definición base de productos, categorías, stock y proveedores.
- **`ventas_ingresos_model.sql` & `escaner_v3_transaccional.sql`**: Modelo de ventas, cabecera (`sales`), ítems (`sale_items`), pagos (`payments`) y transaccionalidad de stock.
- **`cierre_caja.sql`**: Tabla y lógica para el cierre de caja (`cash_closes`).
- **`user_settings.sql`**: Configuración de usuario y preferencias (meta de ventas diaria, etc.).
- **`transferencias.sql` & `confirm_stock_receipt_ubicacion.sql`**: Lógica de transferencia y recepción de stock entre ubicaciones (local y depósito).
- **`product_barcodes.sql`**: Múltiples códigos de barra por producto.
- **`mercado_pago.sql` & `mercado_pago_webhook.sql`**: Integración con pasarela de pagos y webhooks.
- **`reportes_mejoras.sql`**: Tabla de gastos del negocio (`expenses`) para el cálculo de ganancia neta y adición de columnas de descuento (`discount_amount`) en ventas e ítems.
- **`backup_automatico.sql`**: Programación diaria mediante `pg_cron` y `pg_net` para respaldos automáticos.

## 2. Seguridad, Roles y RLS (`supabase/roles_permisos.sql`)
- **`user_role()`**: Función de seguridad (`SECURITY DEFINER`) para verificar el rol del usuario autenticado (`admin`, `supervisor`, `cajero`).
- **Row Level Security (RLS)**: Políticas habilitadas en todas las tablas para restringir inserciones, modificaciones y eliminaciones según el rol y permitir consultas autenticadas.

## 3. Edge Functions (`supabase/functions/`)
- **`daily-backup/index.ts`**: Edge Function en Deno que se ejecuta diariamente (disparada por `pg_cron`), recopila ventas, ítems, pagos, gastos, últimos cierres y snapshot de productos de las últimas 24 horas y los sube en formato JSON al bucket privado de Supabase Storage (`backups`).
