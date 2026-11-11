import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { MusicSnapshot, Track } from "./types.js";

const LZ_COLOR = 0x7965f2;
const MUTED_COLOR = 0x293044;

export function successEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(LZ_COLOR)
    .setTitle(`LZ  •  ${title}`)
    .setDescription(description)
    .setTimestamp();
}

export function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xe45858)
    .setTitle("No se pudo completar")
    .setDescription(description);
}

export function menuPayload() {
  const embed = new EmbedBuilder()
    .setColor(LZ_COLOR)
    .setAuthor({ name: "LZ BOT  /  CENTRO DE COMANDOS" })
    .setTitle("Todo tu servidor, desde un solo menú.")
    .setDescription(
      "Elige una categoría para ver los comandos. Usa el prefijo `!` y menciona personas o canales cuando se indique.",
    )
    .addFields(
      {
        name: "Música",
        value: "Búsqueda, cola, controles y repetición.",
        inline: true,
      },
      {
        name: "Comunidad",
        value: "Bienvenidas, despedidas y datos del servidor.",
        inline: true,
      },
      {
        name: "Administración",
        value: "Roles y herramientas para moderar.",
        inline: true,
      },
    )
    .setFooter({ text: "LZ BOT  •  Música y comunidad" });

  const select = new StringSelectMenuBuilder()
    .setCustomId("lz-menu-category")
    .setPlaceholder("Explorar comandos")
    .addOptions(
      { label: "Música", value: "music", description: "Reproductor y cola", emoji: "🎶" },
      { label: "Comunidad", value: "community", description: "Bienvenida y servidor", emoji: "👋" },
      { label: "Roles", value: "roles", description: "Crear y asignar roles", emoji: "🎭" },
      { label: "Moderación", value: "moderation", description: "Herramientas de moderación", emoji: "🛡️" },
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}

export function categoryEmbed(
  interaction: StringSelectMenuInteraction,
): EmbedBuilder {
  const categories: Record<string, { title: string; description: string; commands: string[] }> = {
    music: {
      title: "Reproductor musical",
      description: "Únete a un canal de voz y controla la música con comandos rápidos.",
      commands: [
        "`!play <canción o URL>` — buscar y añadir música",
        "`!queue` — ver la cola",
        "`!nowplaying` — canción actual",
        "`!pause` · `!resume` · `!skip`",
        "`!volume <0–100>` — ajustar volumen",
        "`!loop off|track|queue` — cambiar repetición",
        "`!shuffle` · `!remove <n>` · `!clearqueue`",
        "`!stop` · `!leave` — detener o salir del canal",
      ],
    },
    community: {
      title: "Comunidad",
      description: "Configura los mensajes de entrada y salida de tu servidor.",
      commands: [
        "`!lz bienvenida #canal` — elegir canal de bienvenida",
        "`!lz bienvenida off` — desactivar bienvenida",
        "`!lz despedida #canal` — elegir canal de despedida",
        "`!lz despedida off` — desactivar despedida",
        "`!server` — información del servidor",
        "`!userinfo [@persona]` — información de una persona",
        "`!avatar [@persona]` — ver avatar",
      ],
    },
    roles: {
      title: "Roles",
      description: "Solo administradores o miembros con permiso de gestionar roles.",
      commands: [
        "`!rol crear <nombre> [#HEX]` — crear rol",
        "`!rol asignar @persona @rol` — asignar rol",
        "`!rol quitar @persona @rol` — quitar rol",
      ],
    },
    moderation: {
      title: "Moderación",
      description: "Las herramientas verifican los permisos antes de actuar.",
      commands: [
        "`!purge <1–100>` — borrar mensajes recientes (Gestionar mensajes)",
        "`!poll <pregunta>` — crear una encuesta rápida",
        "`!ping` — comprobar respuesta del bot",
        "`!lz setup` — ver pasos de configuración",
      ],
    },
  };

  const selected = categories[interaction.values[0] ?? ""] ?? categories.music!;
  return new EmbedBuilder()
    .setColor(MUTED_COLOR)
    .setAuthor({ name: "LZ BOT  /  GUÍA RÁPIDA" })
    .setTitle(selected.title)
    .setDescription(selected.description)
    .addFields({ name: "Comandos", value: selected.commands.join("\n") })
    .setFooter({ text: "Prefijo !  •  Escribe !lz menu para volver al menú" });
}

export function musicNowPlayingEmbed(
  track: Track,
  elapsedSeconds: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(LZ_COLOR)
    .setAuthor({ name: "LZ MUSIC  /  AHORA SUENA" })
    .setTitle(track.title.slice(0, 250))
    .setURL(track.url)
    .setDescription(
      `**Duración:** ${track.duration || "Desconocida"}\n**Solicitó:** ${track.requestedBy}\n**Avance:** ${formatTime(elapsedSeconds)} / ${track.duration || "—"}`,
    );
  if (track.thumbnailUrl) embed.setThumbnail(track.thumbnailUrl);
  return embed;
}

export function musicQueueEmbed(snapshot: MusicSnapshot): EmbedBuilder {
  const upcoming = snapshot.queue.slice(0, 10);
  const queueText = upcoming.length
    ? upcoming
        .map((track, index) => `\`${index + 1}.\` [${track.title.slice(0, 70)}](${track.url}) · ${track.duration}`)
        .join("\n")
    : "No hay canciones esperando.";

  return new EmbedBuilder()
    .setColor(LZ_COLOR)
    .setAuthor({ name: "LZ MUSIC  /  TU COLA" })
    .setDescription(
      snapshot.current
        ? `**Sonando ahora:** [${snapshot.current.title.slice(0, 100)}](${snapshot.current.url})\n`
        : "**Sin reproducción activa**\n",
    )
    .addFields(
      { name: `Siguientes (${snapshot.queue.length})`, value: queueText },
      {
        name: "Ajustes",
        value: `Volumen **${snapshot.volume}%**  •  Repetición **${snapshot.loopMode}**`,
        inline: false,
      },
    )
    .setFooter({ text: snapshot.queue.length > 10 ? "Mostrando las próximas 10 canciones" : "LZ MUSIC" });
}

export function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}
