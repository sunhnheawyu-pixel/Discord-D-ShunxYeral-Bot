# LZ BOT

Bot de Discord en español con reproductor musical, gestión de roles, mensajes de bienvenida y despedida, encuestas y un menú interactivo. No requiere ni incluye un panel web. Los avisos de streams no forman parte de esta versión.

## Funciones

- **Música:** búsqueda de canciones y enlaces de YouTube, cola por servidor, pausa, reanudación, salto, volumen, repetición de canción o cola, mezcla, eliminación individual y vaciado.
- **Menú interactivo:** `!lz menu` abre una guía visual con categorías seleccionables.
- **Bienvenida y despedida:** canales configurables por servidor; los ajustes se guardan en `data/guild-configs.json`.
- **Roles:** crear roles con color hexadecimal, asignar y retirar roles. Requiere permisos de gestión y respeta la jerarquía de roles de Discord.
- **Utilidades:** `!ping`, `!server`, `!userinfo`, `!avatar`, encuestas rápidas y limpieza de mensajes con permisos.
- **Ejecución persistente:** Docker, Railway y Linux con PM2.

## Requisitos

- Node.js **24.17.0 o superior**.
- Python 3.11 o superior y FFmpeg para audio. Docker instala ambos automáticamente.
- `npm ci` instala `youtube-dl-exec`, que descarga la versión estable actual de yt-dlp.
- Una aplicación de bot creada en [Discord Developer Portal](https://discord.com/developers/applications).
- El secreto `DISCORD_TOKEN`. Nunca lo guardes en el código ni lo subas al repositorio.

## Preparar Discord

1. Crea una aplicación y agrega un bot en Discord Developer Portal.
2. En **Bot → Privileged Gateway Intents**, activa **Message Content Intent** y **Server Members Intent**. Son necesarios para los comandos `!` y los eventos de bienvenida/despedida.
3. Invítalo al servidor con los permisos mínimos que usarás: ver canales, enviar mensajes, insertar enlaces, leer historial, conectar y hablar en voz, gestionar roles y gestionar mensajes.
4. Coloca el rol del bot por encima de los roles que deba asignar.
5. Guarda el token del bot como `DISCORD_TOKEN` en el gestor de secretos del proveedor. No lo pongas en GitHub.

## Ejecutar localmente

```bash
cp .env.example .env
```

Completa `DISCORD_TOKEN` en `.env` y luego ejecuta:

```bash
npm ci
npm run build
npm start
```

Para desarrollo con reinicio automático:

```bash
npm run dev
```

El archivo `.env` está excluido de Git. La carpeta `data/` guarda configuración local y también está excluida.
El reproductor usa yt-dlp para buscar y abrir audio; al instalar dependencias se descarga su binario oficial actual. En Linux asegúrate de tener Python 3.11+ y FFmpeg.

## Railway

El repositorio incluye un `Dockerfile`; Railway lo detecta y prepara Node.js, Python 3.11+, FFmpeg y el binario actual de yt-dlp.

1. Crea un proyecto y agrega un servicio desde el repositorio de GitHub.
2. Usa la raíz del repositorio como directorio de servicio.
3. Añade `DISCORD_TOKEN` como variable secreta y `DATA_DIR=/app/data`.
4. Añade un **Volume** al servicio y móntalo en `/app/data`. Sin el volumen, el archivo de configuración se perderá al reemplazar el contenedor.
5. Despliega y confirma en los logs que aparece `LZ BOT conectado`.
6. Configura la política de reinicio **Always** si está disponible en tu plan. Si no, usa **On Failure**.

También puedes desplegar desde una terminal con la CLI oficial:

```bash
railway login
railway link
railway up
```

Después agrega el secreto y el volumen en la configuración del servicio. No uses `railway.toml` para un servicio nuevo: la documentación actual de Railway marca Config as Code como obsoleto y recomienda Infrastructure as Code (`.railway/railway.ts`) para administrar proyectos completos. Este bot usa el `Dockerfile` y la configuración del servicio para mantener el despliegue simple.

**Disponibilidad:** un proceso persistente y el reinicio automático ayudan a mantener el bot en línea, pero ningún proveedor garantiza 24/7 sin interrupciones. Railway limita las políticas de reinicio en planes gratuitos o de prueba; revisa los límites y el uso de tu plan.

## Otros servidores

### Docker en un VPS o servidor compatible

```bash
cp .env.example .env
# Edita .env y agrega DISCORD_TOKEN
docker compose up -d --build
docker compose logs -f
```

`docker-compose.yml` monta `./data` para conservar los ajustes y reinicia el proceso si se detiene. Para revisar el estado: `docker compose ps`.

### Linux con PM2

Instala Node.js 24.17+, Python 3.11+, FFmpeg y PM2. Desde la carpeta del bot:

```bash
npm ci
npm run build
npm install --global pm2
```

Configura `DISCORD_TOKEN` en el entorno seguro del servidor y arranca:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Ejecuta el comando que imprime `pm2 startup` para habilitar el arranque del servicio al reiniciar el VPS. Usa almacenamiento persistente para `data/`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `!lz menu` | Abre el menú visual interactivo |
| `!lz setup` | Muestra requisitos e instrucciones |
| `!play <canción o URL>` | Busca en YouTube o reproduce una URL compatible |
| `!queue` | Muestra la canción actual y las siguientes |
| `!nowplaying` | Muestra qué está sonando |
| `!pause` / `!resume` | Pausa o reanuda |
| `!skip` | Omite la canción actual |
| `!volume <0–100>` | Cambia el volumen |
| `!loop off\|track\|queue` | Desactiva o configura la repetición |
| `!shuffle` | Mezcla las canciones en espera |
| `!remove <n>` | Quita una canción por su posición en la cola |
| `!clearqueue` | Vacía la cola sin detener la canción actual |
| `!stop` / `!leave` | Detiene la música o sale del canal de voz |
| `!rol crear <nombre> [#HEX]` | Crea un rol con color opcional |
| `!rol asignar @persona @rol` | Asigna un rol |
| `!rol quitar @persona @rol` | Retira un rol |
| `!lz bienvenida #canal` | Configura el canal de bienvenida |
| `!lz despedida #canal` | Configura el canal de despedida |
| `!lz bienvenida off` / `!lz despedida off` | Desactiva la función |
| `!ping` | Comprueba la latencia |
| `!server` | Muestra datos del servidor |
| `!userinfo [@persona]` / `!avatar [@persona]` | Muestra información o avatar |
| `!purge <1–100>` | Borra mensajes recientes (permiso requerido) |
| `!poll <pregunta>` | Publica una encuesta Sí/No |

## Variables

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `DISCORD_TOKEN` | Sí | Token privado del bot |
| `DATA_DIR` | No | Carpeta para ajustes; por defecto `./data` |
| `MUSIC_MAX_QUEUE` | No | Máximo de canciones en espera; por defecto `50` |

## Mantenimiento

```bash
npm run typecheck
npm run build
```

Actualiza dependencias con cuidado y prueba voz, permisos e intents antes de volver a desplegar. La búsqueda y el audio se extraen con yt-dlp, descargado desde su distribución oficial durante la instalación. YouTube puede cambiar sus restricciones o funcionamiento; reproduce únicamente contenido que tengas derecho a usar y respeta los términos de la plataforma.

## Documentación consultada

Revisado el 9 de noviembre de 2026:

- [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code)
- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway Volumes](https://docs.railway.com/volumes)
- [Railway Restart Policy](https://docs.railway.com/deployments/restart-policy)
- [discord.js](https://discord.js.org/docs)
