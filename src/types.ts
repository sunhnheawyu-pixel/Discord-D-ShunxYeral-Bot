export interface GuildConfig {
  welcomeChannelId?: string;
  goodbyeChannelId?: string;
}

export interface Track {
  title: string;
  url: string;
  duration: string;
  thumbnailUrl?: string;
  requestedBy: string;
}

export type LoopMode = "off" | "track" | "queue";

export interface MusicSnapshot {
  current?: Track;
  queue: Track[];
  loopMode: LoopMode;
  volume: number;
  elapsedSeconds: number;
  paused: boolean;
  previousCount: number;
}
