# FincaBot

Asistente web para controlar cultivos, pedidos, riegos, productos ecologicos, hierbas, arreglos de finca, equipo, tiempo disponible, memoria y notificaciones.

## Lo que ya hace

- Calcula el plan diario priorizando pedidos de clientes.
- Mantiene un plano editable de parcelas, secciones y rios/lineas.
- Permite registrar que has plantado X plantas en un rio de una seccion concreta.
- Permite renombrar secciones y mover/vaciar rios.
- Agrupa kilos a recolectar por cultivo y estima tiempo.
- Detecta riegos, hierbas y productos ecologicos vencidos por fecha.
- Organiza tareas entre personas segun minutos disponibles y habilidades.
- Reserva descansos durante la jornada.
- Guarda memoria, observaciones, tiempos reales y chat.
- Permite consulta guiada por foto desde movil.
- Consulta clima con Open-Meteo si configuras latitud y longitud.
- Funciona como PWA instalable en el telefono cuando esta publicada por HTTPS.
- Puede sincronizar datos entre moviles con Supabase.

## Acceso desde movil sin depender del ordenador

La forma gratuita preparada es:

1. Hosting: Vercel Hobby.
2. Base de datos y login: Supabase Free.
3. Clima: Open-Meteo.

## Publicar en Vercel

1. Crea una cuenta gratuita en Vercel.
2. Crea un nuevo proyecto y sube esta carpeta.
3. No hace falta build command.
4. El resultado sera una URL tipo `https://tu-fincabot.vercel.app`.

## Configurar Supabase

1. Crea un proyecto gratuito en Supabase.
2. En `SQL Editor`, pega y ejecuta el contenido de `supabase.schema.sql`.
3. En `Project Settings > API`, copia:
   - Project URL.
   - anon public key.
4. En `Authentication > URL Configuration`, pon como Site URL tu URL de Vercel.
5. Anade tambien esa URL en Redirect URLs.

Hay dos formas de conectar la app:

- Rapida: entra en FincaBot, abre `Ajustes`, pega Supabase URL y anon key, guarda, escribe tu email y pulsa `Entrar`.
- Recomendada para varios moviles: rellena `cloud-config.js` antes de publicar:

```js
window.FINCABOT_CLOUD = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseAnonKey: "TU_ANON_KEY"
};
```

La anon key es publica; la seguridad real esta en las politicas RLS de `supabase.schema.sql`, que limitan cada finca al usuario autenticado.

## Conectar con PEDIDOS CAMPO de AppSheet

La base detectada es:

`https://docs.google.com/spreadsheets/d/18-LL567oDOU2ao5DUCJEbQpcoC1Xo9bm654p2iq0XRw/edit`

Pestanas usadas por FincaBot:

- `PRODUCTOS DISPONIBLES`: productos con `TEMPORADA/DISPONIBLE = SI` entran como cultivados.
- `LISTA RECOLECTA`: manda sobre lo que hay que recolectar.
- `VENTA`: cabecera del pedido, fecha de reparto, cliente, estado y repartidor.
- `VENTAS`: lineas de pedido por producto y cantidad.
- `CLIENTES`: nombre, nick, direccion y datos de ruta.

Para que el movil pueda leer la hoja sin meter claves privadas en la app:

1. Abre [Google Apps Script](https://script.google.com/).
2. Crea un proyecto.
3. Pega el contenido de `apps-script/PEDIDOS_CAMPO_CONNECTOR.gs`.
4. Si quieres, rellena `ACCESS_TOKEN` con una palabra secreta.
5. Pulsa `Implementar > Nueva implementacion > Aplicacion web`.
6. Ejecutar como: `Yo`.
7. Quien tiene acceso: `Cualquier usuario con el enlace`.
8. Copia la URL `/exec`.
9. En FincaBot, ve a `Ajustes`, pega esa URL en `Apps Script URL`, pega el token si lo pusiste y guarda.
10. Pulsa `Sincronizar hoja` en el resumen.

Reglas nuevas incorporadas:

- Lo que aparezca en `LISTA RECOLECTA` es la base de la recoleccion.
- Los productos `SI` en `PRODUCTOS DISPONIBLES` entran como cultivados.
- Cada producto puede cambiarse manualmente a `Comprado` o `Cultivado`.
- Si un producto es comprado, FincaBot avisa con el margen de compra configurado, por defecto 3 dias.
- Lunes a miercoles se preparan envios por agencia.
- Martes puede crear reparto propio para tiendas de Alicante.
- Jueves prioriza Murcia / Cartagena.
- Viernes prioriza Murcia / Alicante.

## Instalar en el telefono

1. Abre la URL publicada en Chrome o Safari.
2. Inicia sesion con el email.
3. Activa notificaciones en `Ajustes`.
4. Usa `Anadir a pantalla de inicio` para abrirlo como app.

## Prueba local

Puedes abrir `index.html` directamente para revisar la interfaz. Para probar PWA y notificaciones correctamente, sirve la carpeta con un servidor local o publica en Vercel.

## Verificacion tecnica

```powershell
& 'C:\Users\Angel\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check app.js
& 'C:\Users\Angel\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' tools\verify.js
```
