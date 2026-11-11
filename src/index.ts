import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  type GuildMember,
  type MessageCreateOptions,
  type PartialGuildMember,
} from "discord.js";
import { CommandHandler } from "./commands.js";
import { ConfigStore } from "./config-store.js";
import { errorEmbed, categoryEmbed } from "./embeds.js";
import { MusicManager } from "./music.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("[startup] Falta el secreto DISCORD_TOKEN.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const configStore = new ConfigStore();
const music = new MusicManager(client);
const commands = new CommandHandler(music, configStore);
const cooldowns = new Map<string, number>();

client.once("clientReady", (readyClient) => {
  console.info(`[startup] LZ BOT conectado como ${readyClient.user.tag}.`);
  console.info(`[startup] En línea en ${readyClient.guilds.cache.size} servidor(es).`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith("!")) return;
  const isHelp =
    /^!(?:lz\s+)?(?:menu|help|ayuda)\b/i.test(message.content.trim());
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const lastRun = cooldowns.get(key) ?? 0;
  if (!isHelp && now - lastRun < 1_500) {
    await message.reply({ embeds: [errorEmbed("Espera un momento antes de usar otro comando.")] }).catch(() => undefined);
    return;
  }
  cooldowns.set(key, now);
  if (cooldowns.size > 2_000) {
    for (const [cooldownKey, timestamp] of cooldowns) {
      if (now - timestamp > 60_000) cooldowns.delete(cooldownKey);
    }
  }
  await commands.handle(message);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isStringSelectMenu() || interaction.customId !== "lz-menu-category") return;
  try {
    await interaction.reply({ embeds: [categoryEmbed(interaction)], ephemeral: true });
  } catch (error) {
    console.error("[menu] No se pudo responder a la categoría seleccionada.", error);
  }
});

client.on("guildMemberAdd", async (member) => {
  await sendMemberNotice(member, configStore.getGuild(member.guild.id).welcomeChannelId, "welcome");
});

client.on("guildMemberRemove", async (member) => {
  await sendMemberNotice(member, configStore.getGuild(member.guild.id).goodbyeChannelId, "goodbye");
});

client.on("error", (error) => console.error("[discord] Error del cliente:", error.message));
client.on("shardError", (error) => console.error("[discord] Error de conexión:", error.message));

async function sendMemberNotice(
  member: GuildMember | PartialGuildMember,
  channelId: string | undefined,
  kind: "welcome" | "goodbye",
): Promise<void> {
  if (!channelId) return;
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return;

  const embed = kind === "welcome"
    ? {
        color: 0x7965f2,
        title: "Una nueva persona llegó",
        description: `Démosle la bienvenida a ${member}.\nAhora somos **${member.guild.memberCount}** miembros.`,
        thumbnail: { url: member.displayAvatarURL({ size: 256 }) },
        footer: { text: member.guild.name },
        timestamp: new Date().toISOString(),
      }
    : {
        color: 0x293044,
        title: "Una persona se despidió",
        description: `**${member.user.username}** salió del servidor.\nQuedamos con **${member.guild.memberCount}** miembros.`,
        thumbnail: { url: member.displayAvatarURL({ size: 256 }) },
        footer: { text: member.guild.name },
        timestamp: new Date().toISOString(),
      };
  const send = (channel as unknown as {
    send: (options: MessageCreateOptions) => Promise<unknown>;
  }).send.bind(channel);
  await send({ embeds: [embed] }).catch((error: unknown) => {
    console.error(`[notices] No se pudo enviar ${kind} en ${member.guild.id}.`, error);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function shutdown(): Promise<void> {
  console.info("[shutdown] Cerrando LZ BOT.");
  music.destroyAll();
  client.destroy();
  process.exit(0);
}

client.login(token).catch((error: unknown) => {
  console.error("[startup] No se pudo iniciar sesión en Discord. Revisa DISCORD_TOKEN y las intents habilitadas.");
  if (error instanceof Error) console.error(error.message);
  process.exit(1);
});
