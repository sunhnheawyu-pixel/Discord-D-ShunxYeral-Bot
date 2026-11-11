import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type AudioResource,
  type VoiceConnection,
} from "@discordjs/voice";
import type {
  ButtonInteraction,
  Client,
  Guild,
  MessageCreateOptions,
  VoiceBasedChannel,
} from "discord.js";
import {
  musicNowPlayingPayload,
  musicQueueEmbed,
  successEmbed,
} from "./embeds.js";
import ytDlp from "youtube-dl-exec";
import type { LoopMode, MusicSnapshot, Track } from "./types.js";

const DEFAULT_QUEUE_LIMIT = 50;
const IDLE_DISCONNECT_MS = 3 * 60 * 1000;

interface YtDlpInfo {
  id?: string;
  title?: string;
  webpage_url?: string;
  url?: string;
  duration?: number | null;
  duration_string?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url: string }>;
  entries?: YtDlpInfo[] | null;
}

interface EnqueueOptions {
  guild: Guild;
  voiceChannel: VoiceBasedChannel;
  textChannel: SendableTextChannel;
  query: string;
  requestedBy: string;
}

export interface SendableTextChannel {
  id: string;
  send(options: MessageCreateOptions): Promise<unknown>;
}

export class MusicManager {
  private readonly guildPlayers = new Map<string, GuildMusic>();
  private readonly queueLimit = readQueueLimit();

  async enqueue(options: EnqueueOptions): Promise<{ track: Track; position: number }> {
    const track = await resolveTrack(options.query, options.requestedBy);
    const player = this.getOrCreate(options.guild.id);
    await player.connect(options.guild, options.voiceChannel);
    player.setTextChannel(options.textChannel);
    const position = player.enqueue(track);
    return { track, position };
  }

  get(guildId: string): GuildMusic | undefined {
    return this.guildPlayers.get(guildId);
  }

  getOrCreate(guildId: string): GuildMusic {
    const existing = this.guildPlayers.get(guildId);
    if (existing) return existing;
    const created = new GuildMusic(this.client, guildId, this.queueLimit);
    this.guildPlayers.set(guildId, created);
    return created;
  }

  constructor(private readonly client: Client) {}

  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const action = interaction.customId.slice("lz-music:".length);
    try {
      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild;
      const player = guild ? this.get(guild.id) : undefined;
      if (!guild || !player) {
        await interaction.editReply({ content: "No hay una reproducción activa en este servidor." });
        return;
      }

      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member?.voice.channelId || member.voice.channelId !== player.voiceChannelId()) {
        await interaction.editReply({ content: "Entra al mismo canal de voz que el bot para usar estos controles." });
        return;
      }

      if (action === "queue") {
        await interaction.editReply({ embeds: [musicQueueEmbed(player.snapshot())] });
        return;
      }

      let response: string;
      switch (action) {
        case "previous": {
          const previous = player.previous();
          response = previous
            ? `Volví a **${previous.title.slice(0, 120)}**.`
            : "No hay una canción anterior en el historial.";
          break;
        }
        case "toggle": {
          const state = player.togglePause();
          response = state === "paused"
            ? "Reproducción pausada."
            : state === "resumed"
              ? "Reproducción reanudada."
              : "No hay una canción que se pueda pausar.";
          break;
        }
        case "skip":
          response = player.skip()
            ? "Pasé a la siguiente canción."
            : "No hay una canción activa para omitir.";
          break;
        case "volume-down":
        case "volume-up": {
          const change = action === "volume-up" ? 10 : -10;
          const volume = player.setVolume(player.snapshot().volume + change);
          response = `Volumen: **${volume}%**${volume > 100 ? " (el refuerzo puede distorsionar el audio)." : ""}`;
          break;
        }
        case "shuffle":
          response = `Mezclé **${player.shuffle()}** canciones en espera.`;
          break;
        case "loop": {
          const mode = player.cycleLoopMode();
          response = `Repetición: **${mode === "off" ? "apagada" : mode === "track" ? "canción" : "cola"}**.`;
          break;
        }
        case "stop":
          player.stop();
          response = "Detuve la reproducción y vacié la cola.";
          break;
        default:
          await interaction.editReply({ content: "Ese control de música no existe." });
          return;
      }

      if (action === "stop") {
        await interaction.message.edit({
          embeds: [successEmbed("Reproducción detenida", "Se vació la cola.")],
          components: [],
        }).catch(() => undefined);
      } else {
        const snapshot = player.snapshot();
        if (snapshot.current) {
          await interaction.message.edit(musicNowPlayingPayload(snapshot.current, snapshot)).catch(() => undefined);
        }
      }
      await interaction.editReply({ content: response });
    } catch (error) {
      console.error(`[music-controls:${action}] No se pudo ejecutar el control.`, error);
      const reply = { content: "No pude completar ese control. Inténtalo de nuevo." };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(reply).catch(() => undefined);
      } else {
        await interaction.reply({ ...reply, ephemeral: true }).catch(() => undefined);
      }
    }
  }

  destroy(guildId: string): void {
    const player = this.guildPlayers.get(guildId);
    player?.destroy();
    this.guildPlayers.delete(guildId);
  }

  destroyAll(): void {
    for (const player of this.guildPlayers.values()) player.destroy();
    this.guildPlayers.clear();
  }
}

export class GuildMusic {
  private readonly player: AudioPlayer;
  private connection?: VoiceConnection;
  private textChannel?: SendableTextChannel;
  private queue: Track[] = [];
  private current?: Track;
  private readonly history: Track[] = [];
  private currentResource?: AudioResource<Track>;
  private currentExtractor?: ReturnType<typeof ytDlp.exec>;
  private loopMode: LoopMode = "off";
  private volume = 70;
  private startedAt = 0;
  private starting = false;
  private skipRequested = false;
  private previousRequested = false;
  private idleTimer?: NodeJS.Timeout;

  constructor(
    private readonly client: Client,
    private readonly guildId: string,
    private readonly queueLimit: number,
  ) {
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this.player.on(AudioPlayerStatus.Idle, () => this.onIdle());
    this.player.on("error", (error) => {
      const failedTrack = this.current;
      if (!failedTrack) return;
      console.error(`[music:${this.guildId}] Error al reproducir:`, error.message.slice(0, 240));
      this.currentExtractor?.kill("SIGTERM");
      this.currentExtractor = undefined;
      this.current = undefined;
      this.currentResource = undefined;
      this.startedAt = 0;
      const stopped = this.player.stop(true);
      void this.sendNotice(`No pude reproducir **${failedTrack.title.slice(0, 120)}**. La salté.`);
      if (!stopped) void this.startNext();
    });
  }

  async connect(guild: Guild, channel: VoiceBasedChannel): Promise<void> {
    if (
      this.connection &&
      this.connection.state.status !== VoiceConnectionStatus.Destroyed &&
      this.connection.joinConfig.channelId === channel.id
    ) {
      return;
    }

    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection = connection;
    connection.subscribe(this.player);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      connection.destroy();
      this.connection = undefined;
      throw new Error("No pude conectarme al canal de voz. Revisa mis permisos de Conectar y Hablar.");
    }
  }

  setTextChannel(channel: SendableTextChannel): void {
    this.textChannel = channel;
  }

  enqueue(track: Track): number {
    if (this.queue.length >= this.queueLimit) {
      throw new Error(`La cola llegó al límite de ${this.queueLimit} canciones.`);
    }
    this.clearIdleTimer();
    this.queue.push(track);
    const position = this.queue.length + (this.current ? 1 : 0);
    if (this.player.state.status === AudioPlayerStatus.Idle && !this.starting) {
      void this.startNext();
    }
    return position;
  }

  snapshot(): MusicSnapshot {
    return {
      current: this.current,
      queue: [...this.queue],
      loopMode: this.loopMode,
      volume: this.volume,
      elapsedSeconds: this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0,
      paused: this.player.state.status === AudioPlayerStatus.Paused,
      previousCount: this.history.length,
    };
  }

  voiceChannelId(): string | undefined {
    return this.connection?.joinConfig.channelId ?? undefined;
  }

  pause(): boolean {
    return this.player.pause();
  }

  resume(): boolean {
    return this.player.unpause();
  }

  togglePause(): "paused" | "resumed" | undefined {
    if (this.player.state.status === AudioPlayerStatus.Paused) {
      return this.resume() ? "resumed" : undefined;
    }
    return this.pause() ? "paused" : undefined;
  }

  skip(): boolean {
    if (!this.current) return false;
    const skippedTrack = this.current;
    const extractor = this.currentExtractor;
    this.currentExtractor = undefined;
    extractor?.kill("SIGTERM");
    this.skipRequested = true;
    const stopped = this.player.stop(true);
    if (!stopped) {
      this.skipRequested = false;
      if (!this.previousRequested) this.remember(skippedTrack);
      this.previousRequested = false;
      this.current = undefined;
      this.currentResource = undefined;
      void this.startNext();
    }
    return stopped;
  }

  previous(): Track | undefined {
    const previousTrack = this.history.pop();
    if (!previousTrack) return undefined;
    this.queue.unshift(previousTrack);
    if (this.current) {
      this.previousRequested = true;
      this.skip();
    } else {
      this.current = this.queue.shift();
      void this.startNext();
    }
    return previousTrack;
  }

  stop(): void {
    const extractor = this.currentExtractor;
    this.currentExtractor = undefined;
    extractor?.kill("SIGTERM");
    this.queue = [];
    this.history.length = 0;
    this.current = undefined;
    this.currentResource = undefined;
    this.startedAt = 0;
    this.skipRequested = false;
    this.previousRequested = false;
    this.player.stop(true);
    this.scheduleIdleDisconnect();
  }

  setVolume(value: number): number {
    this.volume = Math.min(150, Math.max(0, Math.round(value)));
    this.currentResource?.volume?.setVolume(this.volume / 100);
    return this.volume;
  }

  setLoopMode(mode: LoopMode): void {
    this.loopMode = mode;
  }

  cycleLoopMode(): LoopMode {
    this.loopMode = this.loopMode === "off"
      ? "track"
      : this.loopMode === "track"
        ? "queue"
        : "off";
    return this.loopMode;
  }

  shuffle(): number {
    for (let index = this.queue.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [this.queue[index], this.queue[target]] = [this.queue[target]!, this.queue[index]!];
    }
    return this.queue.length;
  }

  remove(position: number): Track | undefined {
    if (!Number.isInteger(position) || position < 1 || position > this.queue.length) {
      return undefined;
    }
    return this.queue.splice(position - 1, 1)[0];
  }

  clearQueue(): number {
    const removed = this.queue.length;
    this.queue = [];
    return removed;
  }

  destroy(): void {
    this.clearIdleTimer();
    const extractor = this.currentExtractor;
    this.currentExtractor = undefined;
    extractor?.kill("SIGTERM");
    this.queue = [];
    this.history.length = 0;
    this.current = undefined;
    this.currentResource = undefined;
    this.previousRequested = false;
    this.player.stop(true);
    this.connection?.destroy();
    this.connection = undefined;
  }

  private async startNext(): Promise<void> {
    if (this.starting || this.player.state.status !== AudioPlayerStatus.Idle) return;
    this.starting = true;
    this.clearIdleTimer();

    try {
      while (this.player.state.status === AudioPlayerStatus.Idle) {
        if (!this.current) this.current = this.queue.shift();
        if (!this.current) {
          this.scheduleIdleDisconnect();
          return;
        }

        const track = this.current;
        try {
          const extractor = ytDlp.exec(
            track.url,
            {
              format: "bestaudio/best",
              output: "-",
              noWarnings: true,
              noProgress: true,
              noPlaylist: true,
            },
            { timeout: 30 * 60 * 1000 },
          );
          this.currentExtractor = extractor;
          if (!extractor.stdout) throw new Error("yt-dlp no abrió su salida de audio.");
          const resource = createAudioResource<Track>(extractor.stdout, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true,
            metadata: track,
          });
          resource.volume?.setVolume(this.volume / 100);
          this.currentResource = resource;
          this.startedAt = Date.now();
          this.player.play(resource);
          void extractor.then(
            () => {
              if (this.currentExtractor === extractor) this.currentExtractor = undefined;
            },
            (error: unknown) => this.onExtractorFailure(extractor, track, error),
          );
          await this.sendNowPlaying(track);
          return;
        } catch (error) {
          console.error(
            `[music:${this.guildId}] No se pudo iniciar yt-dlp:`,
            describeExtractorError(error).slice(0, 240),
          );
          this.currentExtractor?.kill("SIGTERM");
          this.currentExtractor = undefined;
          await this.sendNotice(`No pude abrir **${track.title.slice(0, 120)}**. La salté.`);
          this.current = undefined;
          this.currentResource = undefined;
          this.startedAt = 0;
        }
      }
    } finally {
      this.starting = false;
    }
  }

  private onExtractorFailure(
    extractor: ReturnType<typeof ytDlp.exec>,
    track: Track,
    error: unknown,
  ): void {
    if (this.currentExtractor !== extractor || this.current?.url !== track.url) return;
    this.currentExtractor = undefined;
    console.error(
      `[music:${this.guildId}] yt-dlp terminó con error:`,
      describeExtractorError(error).slice(0, 240),
    );
    this.current = undefined;
    this.currentResource = undefined;
    this.startedAt = 0;
    const stopped = this.player.stop(true);
    void this.sendNotice(`No pude reproducir **${track.title.slice(0, 120)}**. La salté.`);
    if (!stopped) void this.startNext();
  }

  private onIdle(): void {
    if (this.skipRequested) {
      this.skipRequested = false;
      if (this.current && !this.previousRequested) this.remember(this.current);
      this.previousRequested = false;
      this.current = undefined;
    } else if (this.current && this.loopMode === "track") {
      void this.startNext();
      return;
    } else if (this.current && this.loopMode === "queue") {
      this.queue.push(this.current);
      this.current = undefined;
    } else {
      if (this.current) this.remember(this.current);
      this.current = undefined;
    }

    this.currentResource = undefined;
    this.startedAt = 0;
    void this.startNext();
  }

  private async sendNowPlaying(track: Track): Promise<void> {
    const channel = this.textChannel;
    if (!channel) return;
    await channel.send(musicNowPlayingPayload(track, this.snapshot())).catch(() => undefined);
  }

  private remember(track: Track): void {
    this.history.push(track);
    if (this.history.length > 25) this.history.shift();
  }

  private async sendNotice(content: string): Promise<void> {
    const channelId = this.textChannel?.id;
    if (!channelId) return;
    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && "send" in channel) {
      const send = (channel as unknown as {
        send: (options: MessageCreateOptions) => Promise<unknown>;
      }).send.bind(channel);
      await send({ content }).catch(() => undefined);
    }
  }

  private scheduleIdleDisconnect(): void {
    this.clearIdleTimer();
    if (!this.connection) return;
    this.idleTimer = setTimeout(() => {
      if (this.queue.length === 0 && !this.current && this.player.state.status === AudioPlayerStatus.Idle) {
        this.connection?.destroy();
        this.connection = undefined;
      }
    }, IDLE_DISCONNECT_MS);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }
}

async function resolveTrack(query: string, requestedBy: string): Promise<Track> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) throw new Error("Escribe el nombre de una canción o una URL de YouTube.");
  if (trimmedQuery.length > 300) throw new Error("La búsqueda no puede superar los 300 caracteres.");

  const isUrl = /^https?:\/\//i.test(trimmedQuery);
  let input = `ytsearch1:${trimmedQuery}`;
  if (isUrl) {
    const parsed = new URL(trimmedQuery);
    const isYouTube =
      parsed.hostname === "youtu.be" ||
      parsed.hostname.endsWith(".youtube.com") ||
      parsed.hostname === "youtube.com";
    if (parsed.protocol !== "https:" || !isYouTube) {
      throw new Error("Por ahora acepto búsquedas y enlaces seguros de YouTube.");
    }
    input = trimmedQuery;
  }

  let result: YtDlpInfo;
  try {
    const output = await ytDlp.exec(
      input,
      {
        dumpSingleJson: true,
        skipDownload: true,
        noWarnings: true,
        noProgress: true,
        ...(isUrl ? { noPlaylist: true } : { playlistEnd: 1 }),
      },
      { timeout: 45_000 },
    );
    result = JSON.parse(output.stdout) as YtDlpInfo;
  } catch {
    throw new Error("No pude buscar esa canción en YouTube. Prueba otro título o pega un enlace.");
  }

  const video = result.entries?.[0] ?? result;
  const url =
    video.webpage_url ??
    (video.id ? `https://www.youtube.com/watch?v=${video.id}` : undefined) ??
    (isUrl ? trimmedQuery : undefined);
  if (!video.title || !url) {
    throw new Error("No encontré un resultado disponible. Prueba otro título o un enlace.");
  }
  return {
    title: video.title,
    url,
    duration: video.duration_string || formatDuration(video.duration) || "—",
    thumbnailUrl: video.thumbnail ?? video.thumbnails?.[0]?.url,
    requestedBy,
  };
}

function formatDuration(seconds: number | null | undefined): string | undefined {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return undefined;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function describeExtractorError(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  }
  return error instanceof Error ? error.message : "Error desconocido de extracción";
}

function readQueueLimit(): number {
  const value = Number.parseInt(process.env.MUSIC_MAX_QUEUE || "", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 200) : DEFAULT_QUEUE_LIMIT;
}
