import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
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
  Client,
  Guild,
  MessageCreateOptions,
  VoiceBasedChannel,
} from "discord.js";
import play from "play-dl";
import type { LoopMode, MusicSnapshot, Track } from "./types.js";

const DEFAULT_QUEUE_LIMIT = 50;
const IDLE_DISCONNECT_MS = 3 * 60 * 1000;

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
  private currentResource?: AudioResource<Track>;
  private loopMode: LoopMode = "off";
  private volume = 70;
  private startedAt = 0;
  private starting = false;
  private skipRequested = false;
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
      console.error(`[music:${this.guildId}] Error al reproducir:`, error.message);
      void this.sendNotice("Una canción falló y se omitió.");
      this.current = undefined;
      void this.startNext();
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
    };
  }

  pause(): boolean {
    return this.player.pause();
  }

  resume(): boolean {
    return this.player.unpause();
  }

  skip(): boolean {
    if (!this.current) return false;
    this.skipRequested = true;
    return this.player.stop(true);
  }

  stop(): void {
    this.queue = [];
    this.current = undefined;
    this.currentResource = undefined;
    this.startedAt = 0;
    this.skipRequested = false;
    this.player.stop(true);
    this.scheduleIdleDisconnect();
  }

  setVolume(value: number): number {
    this.volume = Math.min(100, Math.max(0, Math.round(value)));
    this.currentResource?.volume?.setVolume(this.volume / 100);
    return this.volume;
  }

  setLoopMode(mode: LoopMode): void {
    this.loopMode = mode;
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
    this.queue = [];
    this.current = undefined;
    this.currentResource = undefined;
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
          const audio = await play.stream(track.url, { discordPlayerCompatibility: true });
          const resource = createAudioResource<Track>(audio.stream, {
            inputType: audio.type,
            inlineVolume: true,
            metadata: track,
          });
          resource.volume?.setVolume(this.volume / 100);
          this.currentResource = resource;
          this.startedAt = Date.now();
          this.player.play(resource);
          await this.sendNowPlaying(track);
          return;
        } catch (error) {
          console.error(`[music:${this.guildId}] No se pudo abrir una canción:`, error);
          await this.sendNotice(`No pude reproducir **${track.title.slice(0, 120)}**. La salté.`);
          this.current = undefined;
          this.currentResource = undefined;
          this.startedAt = 0;
        }
      }
    } finally {
      this.starting = false;
    }
  }

  private onIdle(): void {
    if (this.skipRequested) {
      this.skipRequested = false;
      this.current = undefined;
    } else if (this.current && this.loopMode === "track") {
      void this.startNext();
      return;
    } else if (this.current && this.loopMode === "queue") {
      this.queue.push(this.current);
      this.current = undefined;
    } else {
      this.current = undefined;
    }

    this.currentResource = undefined;
    this.startedAt = 0;
    void this.startNext();
  }

  private async sendNowPlaying(track: Track): Promise<void> {
    const channel = this.textChannel;
    if (!channel) return;
    const { musicNowPlayingEmbed } = await import("./embeds.js");
    await channel.send({ embeds: [musicNowPlayingEmbed(track, 0)] }).catch(() => undefined);
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

  if (/^https?:\/\//i.test(trimmedQuery)) {
    const parsed = new URL(trimmedQuery);
    const isYouTube =
      parsed.hostname === "youtu.be" ||
      parsed.hostname.endsWith(".youtube.com") ||
      parsed.hostname === "youtube.com";
    if (!isYouTube) {
      throw new Error("Por ahora acepto búsquedas y enlaces de YouTube.");
    }

    const info = await play.video_basic_info(trimmedQuery);
    const video = info.video_details;
    return {
      title: video.title || "Video de YouTube",
      url: video.url || trimmedQuery,
      duration: video.durationRaw || "—",
      thumbnailUrl: video.thumbnails?.[0]?.url,
      requestedBy,
    };
  }

  const results = await play.search(trimmedQuery, {
    limit: 1,
    source: { youtube: "video" },
  });
  const video = results?.[0];
  if (!video?.url) throw new Error("No encontré resultados. Prueba con otro título o un enlace.");

  return {
    title: video.title || "Video de YouTube",
    url: video.url,
    duration: video.durationRaw || "—",
    thumbnailUrl: video.thumbnails?.[0]?.url,
    requestedBy,
  };
}

function readQueueLimit(): number {
  const value = Number.parseInt(process.env.MUSIC_MAX_QUEUE || "", 10);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 200) : DEFAULT_QUEUE_LIMIT;
}
