import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { GuildConfig } from "./types.js";

type StoredConfigs = Record<string, GuildConfig>;

export class ConfigStore {
  private readonly filePath: string;
  private configs: StoredConfigs = {};

  constructor(dataDirectory = process.env.DATA_DIR || "./data") {
    this.filePath = resolve(dataDirectory, "guild-configs.json");
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.load();
  }

  getGuild(guildId: string): GuildConfig {
    return { ...(this.configs[guildId] ?? {}) };
  }

  setChannel(
    guildId: string,
    kind: "welcomeChannelId" | "goodbyeChannelId",
    channelId: string | undefined,
  ): void {
    const current = { ...(this.configs[guildId] ?? {}) };
    if (channelId) {
      current[kind] = channelId;
    } else {
      delete current[kind];
    }
    this.configs[guildId] = current;
    this.persist();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        this.configs = parsed as StoredConfigs;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[config] No se pudo leer la configuración; se iniciará vacía.");
      }
    }
  }

  private persist(): void {
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.configs, null, 2), "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}
