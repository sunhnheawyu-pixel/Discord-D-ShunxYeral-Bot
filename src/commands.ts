import {
  EmbedBuilder,
  PermissionFlagsBits,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type Role,
} from "discord.js";
import { ConfigStore } from "./config-store.js";
import {
  errorEmbed,
  menuPayload,
  musicQueueEmbed,
  musicNowPlayingPayload,
  successEmbed,
} from "./embeds.js";
import { MusicManager, type SendableTextChannel } from "./music.js";
import type { LoopMode } from "./types.js";

const PREFIX = "!";
const DEFAULT_ROLE_COLOR = 0x7965f2;

export class CommandHandler {
  constructor(
    private readonly music: MusicManager,
    private readonly config: ConfigStore,
  ) {}

  async handle(message: Message): Promise<void> {
    if (!message.guild || message.author.bot || !message.content.startsWith(PREFIX)) return;

    const parts = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = (parts.shift() ?? "").toLowerCase();
    if (!command) return;

    try {
      if (command === "lz") return await this.handleLz(message, parts);
      if (command === "menu" || command === "help" || command === "ayuda") {
        await message.reply(menuPayload());
        return;
      }

      if (["play", "p"].includes(command)) return await this.play(message, parts.join(" "));
      if (["queue", "q"].includes(command)) return await this.showQueue(message);
      if (["nowplaying", "np"].includes(command)) return await this.nowPlaying(message);
      if (command === "pause") return await this.pause(message);
      if (command === "resume") return await this.resume(message);
      if (command === "previous" || command === "back") return await this.previous(message);
      if (command === "skip") return await this.skip(message);
      if (command === "stop") return await this.stop(message);
      if (command === "leave") return await this.leave(message);
      if (["volume", "vol", "vol+", "vol-"].includes(command)) {
        const value = command === "vol+" ? "+10" : command === "vol-" ? "-10" : parts[0];
        return await this.volume(message, value);
      }
      if (command === "loop" || command === "repeat") return await this.loop(message, parts[0]);
      if (command === "shuffle") return await this.shuffle(message);
      if (command === "remove") return await this.remove(message, parts[0]);
      if (command === "clearqueue") return await this.clearQueue(message);
      if (command === "rol" || command === "role") return await this.role(message, parts);
      if (command === "ping") return await this.ping(message);
      if (command === "server") return await this.serverInfo(message);
      if (command === "userinfo") return await this.userInfo(message);
      if (command === "avatar") return await this.avatar(message);
      if (command === "purge") return await this.purge(message, parts[0]);
      if (command === "poll") return await this.poll(message, parts.join(" "));
    } catch (error) {
      console.error(`[commands] Falló el comando !${command}.`, error);
      const description = error instanceof Error ? error.message : "Ocurrió un error inesperado.";
      await message.reply({ embeds: [errorEmbed(description)] }).catch(() => undefined);
    }
  }

  private async handleLz(message: Message, args: string[]): Promise<void> {
    const subcommand = (args.shift() ?? "menu").toLowerCase();
    if (subcommand === "menu" || subcommand === "ayuda" || subcommand === "help") {
      await message.reply(menuPayload());
      return;
    }
    if (subcommand === "setup") {
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x7965f2)
            .setTitle("LZ  •  Configuración inicial")
            .setDescription(
              "Para que todas las funciones trabajen, invita el bot con permisos de enviar mensajes, insertar enlaces, conectarse y hablar en voz, gestionar roles y gestionar mensajes.",
            )
            .addFields(
              {
                name: "Intenciones del bot",
                value:
                  "Activa **Message Content Intent** para los comandos `!` y **Server Members Intent** para bienvenida y despedida en Discord Developer Portal.",
              },
              {
                name: "Canales",
                value:
                  "`!lz bienvenida #canal`  •  `!lz despedida #canal`\nUsa `off` al final para desactivar cualquiera.",
              },
              {
                name: "Roles",
                value: "Coloca el rol del bot por encima de los roles que quieres que pueda asignar.",
              },
            )
            .setFooter({ text: "La configuración del servidor se guarda en data/guild-configs.json" }),
        ],
      });
      return;
    }
    if (subcommand === "bienvenida" || subcommand === "despedida") {
      await this.configureNotice(message, subcommand, args[0]);
      return;
    }
    await message.reply({ embeds: [errorEmbed("Usa `!lz menu`, `!lz setup`, `!lz bienvenida` o `!lz despedida`.")] });
  }

  private async configureNotice(
    message: Message,
    kind: "bienvenida" | "despedida",
    target: string | undefined,
  ): Promise<void> {
    if (!this.hasPermission(message.member, PermissionFlagsBits.ManageGuild)) {
      await message.reply({ embeds: [errorEmbed("Necesitas el permiso **Gestionar servidor** para cambiar esta opción.")] });
      return;
    }

    const configKey = kind === "bienvenida" ? "welcomeChannelId" : "goodbyeChannelId";
    if (!target) {
      const savedId = this.config.getGuild(message.guild!.id)[configKey];
      await message.reply({
        embeds: [
          successEmbed(
            kind === "bienvenida" ? "Bienvenida" : "Despedida",
            savedId ? `Canal actual: <#${savedId}>` : "Esta función todavía no está configurada.",
          ),
        ],
      });
      return;
    }

    if (["off", "desactivar", "ninguno"].includes(target.toLowerCase())) {
      this.config.setChannel(message.guild!.id, configKey, undefined);
      await message.reply({ embeds: [successEmbed("Configuración actualizada", `Se desactivaron los mensajes de ${kind}.`)] });
      return;
    }

    const channel = message.mentions.channels.first() ?? await fetchGuildChannel(message, target);
    if (!channel || !channel.isTextBased()) {
      await message.reply({ embeds: [errorEmbed("Menciona un canal de texto de este servidor, por ejemplo `#general`.")] });
      return;
    }
    this.config.setChannel(message.guild!.id, configKey, channel.id);
    await message.reply({
      embeds: [
        successEmbed(
          "Configuración actualizada",
          `Los mensajes de ${kind} se enviarán en <#${channel.id}>.`,
        ),
      ],
    });
  }

  private async play(message: Message, query: string): Promise<void> {
    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) {
      await message.reply({ embeds: [errorEmbed("Entra primero a un canal de voz.")] });
      return;
    }
    if (!message.channel.isTextBased()) return;
    const me = message.guild!.members.me;
    const permissions = voiceChannel.permissionsFor(me!);
    if (!permissions?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
      await message.reply({ embeds: [errorEmbed("Necesito los permisos **Conectar** y **Hablar** en ese canal.")] });
      return;
    }
    const result = await this.music.enqueue({
      guild: message.guild!,
      voiceChannel,
      textChannel: message.channel as unknown as SendableTextChannel,
      query,
      requestedBy: message.author.username,
    });
    await message.reply({
      embeds: [
        successEmbed(
          result.position === 1 ? "Añadida a reproducción" : "Añadida a la cola",
          `**[${result.track.title.slice(0, 180)}](${result.track.url})**\nDuración: **${result.track.duration}**  •  Posición: **${result.position}**`,
        ),
      ],
    });
  }

  private async showQueue(message: Message): Promise<void> {
    const player = this.music.get(message.guild!.id);
    if (!player) {
      await message.reply({ embeds: [errorEmbed("No hay una cola activa. Usa `!play <canción>`.")] });
      return;
    }
    await message.reply({ embeds: [musicQueueEmbed(player.snapshot())] });
  }

  private async nowPlaying(message: Message): Promise<void> {
    const current = this.music.get(message.guild!.id)?.snapshot();
    if (!current?.current) {
      await message.reply({ embeds: [errorEmbed("No hay música sonando en este momento.")] });
      return;
    }
    await message.reply({
      ...musicNowPlayingPayload(current.current, current),
    });
  }

  private async pause(message: Message): Promise<void> {
    const paused = this.music.get(message.guild!.id)?.pause();
    await message.reply({
      embeds: [
        paused
          ? successEmbed("En pausa", "Usa `!resume` cuando quieras continuar.")
          : errorEmbed("No hay una canción activa para pausar."),
      ],
    });
  }

  private async resume(message: Message): Promise<void> {
    const resumed = this.music.get(message.guild!.id)?.resume();
    await message.reply({
      embeds: [
        resumed
          ? successEmbed("Reproducción reanudada", "La música sigue sonando.")
          : errorEmbed("No hay una canción en pausa."),
      ],
    });
  }

  private async skip(message: Message): Promise<void> {
    const skipped = this.music.get(message.guild!.id)?.skip();
    await message.reply({
      embeds: [
        skipped
          ? successEmbed("Canción omitida", "Sigue la siguiente canción de la cola.")
          : errorEmbed("No hay una canción activa para omitir."),
      ],
    });
  }

  private async previous(message: Message): Promise<void> {
    const previous = this.music.get(message.guild!.id)?.previous();
    await message.reply({
      embeds: [
        previous
          ? successEmbed("Canción anterior", `Volví a **${previous.title.slice(0, 150)}**.`)
          : errorEmbed("No hay una canción anterior en el historial."),
      ],
    });
  }

  private async stop(message: Message): Promise<void> {
    const player = this.music.get(message.guild!.id);
    if (!player) {
      await message.reply({ embeds: [errorEmbed("No hay una reproducción activa.")] });
      return;
    }
    player.stop();
    await message.reply({ embeds: [successEmbed("Reproducción detenida", "Se vació la cola y el bot saldrá del canal si queda inactivo.")] });
  }

  private async leave(message: Message): Promise<void> {
    if (!this.music.get(message.guild!.id)) {
      await message.reply({ embeds: [errorEmbed("No estoy conectado a un canal de voz.")] });
      return;
    }
    this.music.destroy(message.guild!.id);
    await message.reply({ embeds: [successEmbed("Hasta luego", "Salí del canal de voz y vacié la cola.")] });
  }

  private async volume(message: Message, rawValue: string | undefined): Promise<void> {
    if (!rawValue) {
      const current = this.music.get(message.guild!.id)?.snapshot().volume ?? 70;
      await message.reply({
        embeds: [
          successEmbed(
            "Volumen",
            `El volumen actual es **${current}%**. Usa \`!volume 0–150\`, \`!volume +10/-10\`, \`!vol+\` o \`!vol-\`.`,
          ),
        ],
      });
      return;
    }
    const normalized = rawValue.toLowerCase();
    const current = this.music.get(message.guild!.id)?.snapshot().volume ?? 70;
    let value: number;
    if (/^[+-]\d+$/.test(normalized)) {
      value = current + Number(normalized);
    } else if (["up", "subir", "más", "mas"].includes(normalized)) {
      value = current + 10;
    } else if (["down", "bajar", "menos"].includes(normalized)) {
      value = current - 10;
    } else if (["max", "máximo", "maximo"].includes(normalized)) {
      value = 150;
    } else if (["mute", "silencio", "min", "mínimo", "minimo"].includes(normalized)) {
      value = 0;
    } else {
      value = Number(normalized);
    }
    if (!Number.isInteger(value) || value < 0 || value > 150) {
      await message.reply({ embeds: [errorEmbed("Indica un volumen de 0 a 150, por ejemplo `!volume +10` o `!volume 80`.")] });
      return;
    }
    const volume = this.music.getOrCreate(message.guild!.id).setVolume(value);
    const note = volume > 100 ? " El refuerzo sobre 100% puede distorsionar el audio." : "";
    await message.reply({
      embeds: [successEmbed("Volumen ajustado", `El volumen ahora está en **${volume}%**.${note}`)],
    });
  }

  private async loop(message: Message, rawMode: string | undefined): Promise<void> {
    const mode = (rawMode ?? "").toLowerCase();
    if (!["off", "track", "queue"].includes(mode)) {
      await message.reply({ embeds: [errorEmbed("Usa `!loop off`, `!loop track` o `!loop queue`.")] });
      return;
    }
    this.music.getOrCreate(message.guild!.id).setLoopMode(mode as LoopMode);
    const label = mode === "off" ? "desactivada" : mode === "track" ? "canción" : "cola";
    await message.reply({ embeds: [successEmbed("Repetición actualizada", `Repetición de ${label}.`)] });
  }

  private async shuffle(message: Message): Promise<void> {
    const player = this.music.get(message.guild!.id);
    if (!player) {
      await message.reply({ embeds: [errorEmbed("No hay una cola activa para mezclar.")] });
      return;
    }
    const count = player.shuffle();
    await message.reply({ embeds: [successEmbed("Cola mezclada", `Se mezclaron **${count}** canciones.`)] });
  }

  private async remove(message: Message, rawPosition: string | undefined): Promise<void> {
    const position = Number.parseInt(rawPosition ?? "", 10);
    const removed = this.music.get(message.guild!.id)?.remove(position);
    await message.reply({
      embeds: [
        removed
          ? successEmbed("Canción eliminada", `Quité **${removed.title.slice(0, 150)}** de la cola.`)
          : errorEmbed("Indica una posición válida de la cola, por ejemplo `!remove 2`."),
      ],
    });
  }

  private async clearQueue(message: Message): Promise<void> {
    const removed = this.music.get(message.guild!.id)?.clearQueue() ?? 0;
    await message.reply({ embeds: [successEmbed("Cola vaciada", `Se quitaron **${removed}** canciones de la cola.`)] });
  }

  private async role(message: Message, args: string[]): Promise<void> {
    if (!this.hasPermission(message.member, PermissionFlagsBits.ManageRoles)) {
      await message.reply({ embeds: [errorEmbed("Necesitas el permiso **Gestionar roles**.")] });
      return;
    }
    const action = (args.shift() ?? "").toLowerCase();
    if (action === "crear" || action === "create") {
      await this.createRole(message, args);
      return;
    }
    if (action === "asignar" || action === "add" || action === "quitar" || action === "remove") {
      await this.assignRole(message, action === "quitar" || action === "remove");
      return;
    }
    if (["lista", "listar", "list"].includes(action)) {
      await this.listRoles(message, args[0]);
      return;
    }
    if (action === "info" || action === "ver") {
      await this.roleInfo(message);
      return;
    }
    if (["renombrar", "rename", "nombre"].includes(action)) {
      await this.renameRole(message, args);
      return;
    }
    if (action === "color") {
      await this.colorRole(message, args);
      return;
    }
    if (["mencionar", "mention"].includes(action)) {
      await this.setRoleMentionable(message, args);
      return;
    }
    await message.reply({
      embeds: [
        errorEmbed(
          [
            "Comandos de roles:",
            "`!rol crear <nombre> [#HEX]`",
            "`!rol asignar @persona @rol` · `!rol quitar @persona @rol`",
            "`!rol lista [página]` · `!rol info @rol`",
            "`!rol renombrar @rol <nombre>` · `!rol color @rol #HEX`",
            "`!rol mencionar @rol on|off`",
          ].join("\n"),
        ),
      ],
    });
  }

  private async createRole(message: Message, args: string[]): Promise<void> {
    const rawColor = args.at(-1);
    const hasColor = !!rawColor && /^#?[0-9a-fA-F]{6}$/.test(rawColor);
    if (rawColor?.startsWith("#") && !hasColor) {
      await message.reply({ embeds: [errorEmbed("El color debe tener formato hexadecimal, por ejemplo `#7965F2`.")] });
      return;
    }
    const name = (hasColor ? args.slice(0, -1) : args).join(" ").trim();
    if (!name || name.length > 100) {
      await message.reply({ embeds: [errorEmbed("Indica un nombre de 1 a 100 caracteres: `!rol crear Comunidad #7965F2`.")] });
      return;
    }
    const color = hasColor ? Number.parseInt(rawColor!.replace("#", ""), 16) : DEFAULT_ROLE_COLOR;
    const role = await message.guild!.roles.create({
      name,
      color,
      reason: `Creado por ${message.author.tag} mediante LZ BOT`,
    });
    await message.reply({ embeds: [successEmbed("Rol creado", `Se creó el rol ${role} con color **#${color.toString(16).padStart(6, "0").toUpperCase()}**.`)] });
  }

  private async assignRole(message: Message, remove: boolean): Promise<void> {
    const member = message.mentions.members?.first();
    const role = await this.mentionedRole(message);
    if (!member || !role) {
      await message.reply({ embeds: [errorEmbed("Menciona a la persona y al rol: `!rol asignar @persona @rol`.")] });
      return;
    }
    if (!this.canManageTargetRole(message, role)) {
      await message.reply({ embeds: [errorEmbed("El rol debe estar por debajo del rol más alto del bot.")] });
      return;
    }
    if (remove) {
      await member.roles.remove(role, `Solicitud de ${message.author.tag}`);
    } else {
      await member.roles.add(role, `Solicitud de ${message.author.tag}`);
    }
    await message.reply({
      embeds: [
        successEmbed(
          remove ? "Rol retirado" : "Rol asignado",
          `${remove ? "Quité" : "Añadí"} ${role} ${remove ? "a" : "a"} ${member}.`,
        ),
      ],
    });
  }

  private async listRoles(message: Message, rawPage: string | undefined): Promise<void> {
    const allRoles = await message.guild!.roles.fetch();
    const roles = [...allRoles.values()]
      .filter((role) => role.id !== message.guild!.id && !role.managed)
      .sort((a, b) => b.position - a.position);
    const pageSize = 10;
    const page = rawPage === undefined ? 1 : Number(rawPage);
    const pages = Math.max(1, Math.ceil(roles.length / pageSize));
    if (!Number.isInteger(page) || page < 1 || page > pages) {
      await message.reply({ embeds: [errorEmbed(`Elige una página entre 1 y ${pages}.`)] });
      return;
    }
    const pageRoles = roles.slice((page - 1) * pageSize, page * pageSize);
    const lines = pageRoles.map((role) => {
      const color = role.color ? `#${role.color.toString(16).padStart(6, "0").toUpperCase()}` : "sin color";
      return `• **${escapeRoleName(role.name)}** — \`${color}\` — ${role.members.size} miembros`;
    });
    const embed = new EmbedBuilder()
      .setColor(0x7965f2)
      .setTitle("Roles del servidor")
      .setDescription(lines.join("\n") || "No hay roles personalizados.")
      .setFooter({ text: `Página ${page}/${pages} · ${roles.length} roles` });
    await message.reply({ embeds: [embed] });
  }

  private async roleInfo(message: Message): Promise<void> {
    const role = await this.mentionedRole(message);
    if (!role) {
      await message.reply({ embeds: [errorEmbed("Menciona el rol que quieres consultar: `!rol info @rol`.")] });
      return;
    }
    const color = role.color ? `#${role.color.toString(16).padStart(6, "0").toUpperCase()}` : "Sin color";
    const embed = new EmbedBuilder()
      .setColor(role.color || DEFAULT_ROLE_COLOR)
      .setTitle(`Rol: ${escapeRoleName(role.name)}`)
      .addFields(
        { name: "Color", value: color, inline: true },
        { name: "Miembros", value: String(role.members.size), inline: true },
        { name: "Mencionable", value: role.mentionable ? "Sí" : "No", inline: true },
        { name: "Posición", value: String(role.position), inline: true },
        { name: "ID", value: `\`${role.id}\``, inline: true },
      );
    await message.reply({ embeds: [embed] });
  }

  private async renameRole(message: Message, args: string[]): Promise<void> {
    const role = await this.mentionedRole(message);
    const name = args.filter((part) => !/^<@&\d{17,20}>$/.test(part)).join(" ").trim();
    if (!role || !name || name.length > 100) {
      await message.reply({
        embeds: [errorEmbed("Usa `!rol renombrar @rol Nuevo nombre` (1–100 caracteres).")],
      });
      return;
    }
    if (!this.canManageTargetRole(message, role)) {
      await message.reply({ embeds: [errorEmbed("No puedo editar ese rol: debe estar debajo del rol más alto del bot.")] });
      return;
    }
    await role.edit({ name, reason: `Renombrado por ${message.author.tag} mediante LZ BOT` });
    await message.reply({ embeds: [successEmbed("Rol renombrado", `Ahora se llama **${escapeRoleName(name)}**.`)] });
  }

  private async colorRole(message: Message, args: string[]): Promise<void> {
    const role = await this.mentionedRole(message);
    const rawColor = args.find((part) => /^#?[0-9a-fA-F]{6}$/.test(part));
    if (!role || !rawColor) {
      await message.reply({ embeds: [errorEmbed("Usa `!rol color @rol #7965F2`.")] });
      return;
    }
    if (!this.canManageTargetRole(message, role)) {
      await message.reply({ embeds: [errorEmbed("No puedo editar ese rol: debe estar debajo del rol más alto del bot.")] });
      return;
    }
    const color = Number.parseInt(rawColor.replace("#", ""), 16);
    await role.edit({ color, reason: `Color actualizado por ${message.author.tag} mediante LZ BOT` });
    await message.reply({
      embeds: [successEmbed("Color actualizado", `${role} ahora usa **#${color.toString(16).padStart(6, "0").toUpperCase()}**.`)],
    });
  }

  private async setRoleMentionable(message: Message, args: string[]): Promise<void> {
    const role = await this.mentionedRole(message);
    const rawState = args.find((part) => /^(on|off|true|false|sí|si|no|activar|desactivar)$/i.test(part));
    const enabled = rawState ? /^(on|true|sí|si|activar)$/i.test(rawState) : undefined;
    if (!role || enabled === undefined) {
      await message.reply({ embeds: [errorEmbed("Usa `!rol mencionar @rol on` o `!rol mencionar @rol off`.")] });
      return;
    }
    if (!this.canManageTargetRole(message, role)) {
      await message.reply({ embeds: [errorEmbed("No puedo editar ese rol: debe estar debajo del rol más alto del bot.")] });
      return;
    }
    await role.edit({
      mentionable: enabled,
      reason: `Configuración de menciones actualizada por ${message.author.tag} mediante LZ BOT`,
    });
    await message.reply({
      embeds: [successEmbed("Menciones de rol", `${role} ${enabled ? "ahora se puede mencionar" : "ya no se puede mencionar"}.`)],
    });
  }

  private async mentionedRole(message: Message): Promise<Role | null> {
    return message.mentions.roles.first() ?? (await roleFromMessage(message)) ?? null;
  }

  private async ping(message: Message): Promise<void> {
    const sent = await message.reply({ embeds: [successEmbed("Pong", "Midiendo latencia…")] });
    const latency = sent.createdTimestamp - message.createdTimestamp;
    await sent.edit({ embeds: [successEmbed("Pong", `Latencia del mensaje: **${latency} ms**  •  API: **${Math.round(message.client.ws.ping)} ms**`)] });
  }

  private async serverInfo(message: Message): Promise<void> {
    const guild = message.guild!;
    const embed = new EmbedBuilder()
      .setColor(0x7965f2)
      .setTitle(guild.name)
      .setDescription(guild.description || "Información de este servidor.")
      .addFields(
        { name: "Miembros", value: String(guild.memberCount), inline: true },
        { name: "Canales", value: String(guild.channels.cache.size), inline: true },
        { name: "Roles", value: String(guild.roles.cache.size), inline: true },
        { name: "Creado", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
      );
    const icon = guild.iconURL({ size: 256 });
    if (icon) embed.setThumbnail(icon);
    await message.reply({ embeds: [embed] });
  }

  private async userInfo(message: Message): Promise<void> {
    const member = message.mentions.members?.first() ?? message.member;
    if (!member) return;
    const embed = new EmbedBuilder()
      .setColor(0x7965f2)
      .setTitle(member.displayName)
      .setDescription(`${member.user.tag}`)
      .addFields(
        { name: "Cuenta creada", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
        { name: "Se unió", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : "No disponible", inline: true },
      )
      .setThumbnail(member.displayAvatarURL({ size: 256 }));
    await message.reply({ embeds: [embed] });
  }

  private async avatar(message: Message): Promise<void> {
    const user = message.mentions.users.first() ?? message.author;
    const url = user.displayAvatarURL({ size: 1024 });
    const embed = new EmbedBuilder()
      .setColor(0x7965f2)
      .setTitle(`Avatar de ${user.username}`)
      .setImage(url)
      .setURL(url);
    await message.reply({ embeds: [embed] });
  }

  private async purge(message: Message, rawCount: string | undefined): Promise<void> {
    if (!this.hasPermission(message.member, PermissionFlagsBits.ManageMessages)) {
      await message.reply({ embeds: [errorEmbed("Necesitas el permiso **Gestionar mensajes**.")] });
      return;
    }
    const count = Number.parseInt(rawCount ?? "", 10);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      await message.reply({ embeds: [errorEmbed("Indica una cantidad entre 1 y 100: `!purge 20`.")] });
      return;
    }
    const channel = message.channel;
    if (!channel.isTextBased() || !("bulkDelete" in channel)) {
      await message.reply({ embeds: [errorEmbed("Este comando solo funciona en canales de texto compatibles.")] });
      return;
    }
    const deleted = await channel.bulkDelete(count, true);
    const confirmation = await channel.send({
      embeds: [successEmbed("Limpieza completada", `Se eliminaron **${deleted.size}** mensajes recientes.`)],
    });
    setTimeout(() => void confirmation.delete().catch(() => undefined), 5000).unref();
  }

  private async poll(message: Message, question: string): Promise<void> {
    if (question.length < 5 || question.length > 250) {
      await message.reply({ embeds: [errorEmbed("Escribe una pregunta de 5 a 250 caracteres: `!poll ¿Qué hacemos hoy?`")] });
      return;
    }
    const poll = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x7965f2)
          .setAuthor({ name: "LZ  /  ENCUESTA" })
          .setTitle(question)
          .setDescription("Reacciona para votar: **👍 Sí**  •  **👎 No**")
          .setFooter({ text: `Creada por ${message.author.username}` }),
      ],
    });
    await poll.react("👍");
    await poll.react("👎");
  }

  private hasPermission(
    member: GuildMember | null,
    permission: bigint,
  ): boolean {
    return !!member?.permissions.has(permission);
  }

  private canManageTargetRole(message: Message, role: Role): boolean {
    const botHighestRole = message.guild!.members.me?.roles.highest;
    return !!botHighestRole &&
      role.id !== message.guild!.id &&
      !role.managed &&
      role.position < botHighestRole.position;
  }
}

async function roleFromMessage(message: Message): Promise<Role | undefined> {
  const mentionId = message.content.match(/<@&(\d{17,20})>/)?.[1];
  const rawId = mentionId ?? message.content.match(/\b(\d{17,20})\b/)?.[1];
  if (!rawId) return undefined;
  return (await message.guild!.roles.fetch(rawId).catch(() => null)) ?? undefined;
}

function escapeRoleName(name: string): string {
  return name.replace(/([\\*_`~|])/g, "\\$1").slice(0, 100);
}

async function fetchGuildChannel(
  message: Message,
  target: string,
): Promise<GuildBasedChannel | null> {
  const id = target.match(/\d{17,20}/)?.[0];
  if (!id) return null;
  return message.guild!.channels.fetch(id).catch(() => null);
}
