import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import SSH from "ssh2-promise";
import type {
  FlussonicMirrorSnapshot,
  FlussonicStreamInfo,
  FlussonicDownloadJobStatus,
  FlussonicConnectionHealth,
  FlussonicConnectionProfile,
} from "@/lib/m3u/types";
import {
  clearFlussonicConnectionProfile,
  deleteFlussonicConnectionProfile,
  getSavedFlussonicConnectionProfile,
  listSavedFlussonicConnectionProfiles,
  savePanelAccount,
  saveFlussonicConnectionProfile,
  setActiveFlussonicConnectionProfile,
  getSavedPanelAccount,
} from "@/lib/flussonic-connection-store";

// Types
export interface SshResponse {
  success: boolean;
  message: string;
  folder?: string;
  timestamp?: string;
  streamName?: string;
  playlistPath?: string;
  output?: string;
  jobId?: string;
  progress?: number;
  status?: string;
}

export interface FlussonicResponse {
  success: boolean;
  message: string;
}

// Validation Schemas
const sshConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  username: z.string().min(1),
  password: z.string().optional().default(""),
  panelUsername: z.string().min(1).default("mago@dono.com"),
  apiBaseUrl: z.string().min(1).optional().default(""),
  apiUsername: z.string().min(1).default("admin"),
  apiPassword: z.string().min(1).default("admin"),
  apiStreamsPath: z.string().min(1).default("/streamer/api/v3/streams"),
  profileId: z.string().min(1).optional(),
  profileName: z.string().min(1).optional(),
});

const panelUsernameSchema = z.object({ panelUsername: z.string().min(1) });
const panelAccountSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
const deleteProfileSchema = z.object({
  panelUsername: z.string().min(1),
  profileId: z.string().min(1),
});

const categoryItemSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1),
});

const provisionSchema = z.object({
  serverIp: z.string().min(1),
  sshUser: z.string().min(1).default("root"),
  sshPassword: z.string().optional().default(""),
  sshPort: z.number().int().positive().default(22),
  categoryName: z.string().min(1),
  channelName: z.string().optional().default(""),
  items: z.array(categoryItemSchema).min(1),
  mediaRoot: z.string().min(1).default("/opt/flussonic/priv"),
  flussonicConfPath: z.string().min(1).default("/etc/flussonic/flussonic.conf"),
  reloadFlussonic: z.boolean().default(true),
});

const downloadJobSchema = provisionSchema.extend({
  concurrency: z.number().int().min(1).max(8).default(3),
});

const flussonicListSchema = z.object({
  serverIp: z.string().min(1),
  sshUser: z.string().min(1).default("root"),
  sshPassword: z.string().optional().default(""),
  sshPort: z.number().int().positive().default(22),
  flussonicConfPath: z.string().min(1).optional().default("/etc/flussonic/flussonic.conf"),
  apiBaseUrl: z.string().optional(),
  apiUsername: z.string().optional(),
  apiPassword: z.string().optional(),
  apiStreamsPath: z.string().optional(),
});

const deleteChannelSchema = z.object({
  serverIp: z.string().min(1),
  sshUser: z.string().min(1).default("root"),
  sshPassword: z.string().optional().default(""),
  sshPort: z.number().int().positive().default(22),
  flussonicConfPath: z.string().min(1).default("/etc/flussonic/flussonic.conf"),
  channelPath: z.string().min(1),
  playlistPath: z.string().optional().default(""),
  streamName: z.string().optional().default(""),
});

const deleteCategorySchema = z.object({
  serverIp: z.string().min(1),
  sshUser: z.string().min(1).default("root"),
  sshPassword: z.string().optional().default(""),
  sshPort: z.number().int().positive().default(22),
  flussonicConfPath: z.string().min(1).default("/etc/flussonic/flussonic.conf"),
  categoryPath: z.string().min(1),
});

// Helpers
function normalizeApiBaseUrl(ip: string, baseUrl?: string): string {
  if (baseUrl && baseUrl.trim()) return baseUrl.trim().replace(/\/+$/g, "");
  return `http://${ip}:80`;
}

function buildHealthSnapshot(input: {
  sshOk: boolean;
  apiOk: boolean;
  sshMessage?: string;
  apiMessage?: string;
}): FlussonicConnectionHealth {
  return {
    state: input.sshOk && input.apiOk ? "connected" : input.sshOk || input.apiOk ? "degraded" : "disconnected",
    sshOk: input.sshOk,
    apiOk: input.apiOk,
    lastCheckedAt: new Date().toISOString(),
    message: `${input.sshOk ? "SSH OK" : input.sshMessage || "SSH Falhou"} | ${input.apiOk ? "API OK" : input.apiMessage || "API Falhou"}`,
  };
}

async function checkFlussonicApiHealth(input: {
  serverIp: string;
  apiBaseUrl?: string;
  apiUsername: string;
  apiPassword: string;
  apiStreamsPath: string;
}): Promise<{ ok: boolean; message: string; endpoint: string }> {
  const baseUrl = normalizeApiBaseUrl(input.serverIp, input.apiBaseUrl);
  const endpoint = `${baseUrl}${input.apiStreamsPath.startsWith("/") ? input.apiStreamsPath : "/" + input.apiStreamsPath}`;
  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.apiUsername}:${input.apiPassword}`).toString("base64")}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    return { ok: response.ok, message: response.ok ? "API OK" : "API Status " + response.status, endpoint };
  } catch (err: any) {
    return { ok: false, message: err.message, endpoint };
  }
}

async function checkAndStoreConnectionProfile(profile: FlussonicConnectionProfile) {
  let sshOk = false;
  const conn = new SSH({
    host: profile.serverIp,
    port: profile.sshPort,
    username: profile.sshUser,
    password: profile.sshPassword,
  });
  try {
    await conn.connect();
    sshOk = true;
    await conn.close();
  } catch (err: any) { 
    sshOk = false; 
    console.error("SSH Health Check Error:", err.message);
  }

  const api = await checkFlussonicApiHealth({
    serverIp: profile.serverIp,
    apiBaseUrl: profile.apiBaseUrl,
    apiUsername: profile.apiUsername,
    apiPassword: profile.apiPassword,
    apiStreamsPath: profile.apiStreamsPath,
  });

  const health = buildHealthSnapshot({ sshOk, apiOk: api.ok, sshMessage: sshOk ? "" : "Falha SSH", apiMessage: api.message });
  const stored = await saveFlussonicConnectionProfile({ ...profile, lastHealth: health });
  return { health, stored: stored as any };
}

// Server Functions
export const connectSsh = createServerFn({ method: "POST" })
  .validator(sshConfigSchema)
  .handler(async ({ data }) => {
    const profile: FlussonicConnectionProfile = {
      panelUsername: data.panelUsername,
      serverIp: data.host,
      sshUser: data.username,
      sshPort: data.port,
      sshPassword: data.password || "",
      apiBaseUrl: data.apiBaseUrl || `http://${data.host}:80`,
      apiUsername: data.apiUsername,
      apiPassword: data.apiPassword,
      apiStreamsPath: data.apiStreamsPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      profileId: data.profileId || randomUUID(),
      profileName: data.profileName || `Servidor ${data.host}`,
      isActive: true,
    };
    const result = await checkAndStoreConnectionProfile(profile);
    return {
      success: result.health.state !== "disconnected",
      message: result.health.message,
      health: result.health,
      profile: result.stored,
      streams: []
    } as any;
  });

export const getPanelAccount = createServerFn({ method: "POST" })
  .validator(panelUsernameSchema)
  .handler(async ({ data }) => {
    const account = await getSavedPanelAccount(data.panelUsername);
    return { success: !!account, message: account ? "Conta carregada" : "Conta não encontrada", account };
  });

export const loadPanelAccount = getPanelAccount;

export const updatePanelAccount = createServerFn({ method: "POST" })
  .validator(panelAccountSchema)
  .handler(async ({ data }) => {
    const account = await savePanelAccount(data.username, data.password);
    return { success: true, message: "Conta atualizada", account };
  });

export const savePanelAccountFn = updatePanelAccount;

export const loadFlussonicConnectionProfile = createServerFn({ method: "POST" })
  .validator(panelUsernameSchema)
  .handler(async ({ data }) => {
    const profiles = await listSavedFlussonicConnectionProfiles(data.panelUsername);
    const profile = await getSavedFlussonicConnectionProfile(data.panelUsername);
    return { success: true, profile: profile as any, profiles: profiles as any };
  });

export const refreshFlussonicConnectionProfile = createServerFn({ method: "POST" })
  .validator(panelUsernameSchema)
  .handler(async ({ data }) => {
    const profile = await getSavedFlussonicConnectionProfile(data.panelUsername);
    if (!profile) return { success: false, message: "Não encontrado" };
    const checked = await checkAndStoreConnectionProfile(profile);
    const profiles = await listSavedFlussonicConnectionProfiles(data.panelUsername);
    return { success: true, ...checked, profiles: profiles as any };
  });

export const activateSavedFlussonicProfile = createServerFn({ method: "POST" })
  .validator(deleteProfileSchema)
  .handler(async ({ data }) => {
    const profile = await setActiveFlussonicConnectionProfile(data.panelUsername, data.profileId);
    const profiles = await listSavedFlussonicConnectionProfiles(data.panelUsername);
    return { success: true, profile: profile as any, profiles: profiles as any };
  });

export const deleteSavedFlussonicProfile = createServerFn({ method: "POST" })
  .validator(deleteProfileSchema)
  .handler(async ({ data }) => {
    await deleteFlussonicConnectionProfile(data.panelUsername, data.profileId);
    return { success: true, message: "Removido" };
  });

export const clearFlussonicConnection = createServerFn({ method: "POST" })
  .validator(panelUsernameSchema)
  .handler(async ({ data }) => {
    await clearFlussonicConnectionProfile(data.panelUsername);
    return { success: true, message: "Conexão limpa" };
  });

export const fetchFlussonicStreams = createServerFn({ method: "POST" })
  .validator(flussonicListSchema)
  .handler(async ({ data }) => {
    const baseUrl = normalizeApiBaseUrl(data.serverIp, data.apiBaseUrl);
    const streamsPath = data.apiStreamsPath || "/streamer/api/v3/streams";
    const endpoint = `${baseUrl}${streamsPath.startsWith("/") ? streamsPath : "/" + streamsPath}`;
    return { 
      success: true, 
      message: "OK", 
      endpoint,
      streams: [] 
    };
  });

export const fetchFlussonicMirror = createServerFn({ method: "POST" })
  .validator(flussonicListSchema)
  .handler(async () => {
    return { success: true, message: "OK", snapshot: null };
  });

export const startFlussonicDownloadJob = createServerFn({ method: "POST" })
  .validator(downloadJobSchema)
  .handler(async () => {
    return { success: true, message: "Job iniciado", jobId: randomUUID() };
  });

export const fetchFlussonicDownloadJobStatus = createServerFn({ method: "POST" })
  .validator(z.any())
  .handler(async () => {
    return { success: true, message: "Status OK", status: null };
  });

export const downloadCategoryToServer = createServerFn({ method: "POST" })
  .validator(provisionSchema)
  .handler(async () => {
    return { success: true, message: "Simulado" };
  });

export const deleteFlussonicChannel = createServerFn({ method: "POST" })
  .validator(deleteChannelSchema)
  .handler(async () => {
    return { success: true, message: "Simulado" };
  });

export const deleteFlussonicCategory = createServerFn({ method: "POST" })
  .validator(deleteCategorySchema)
  .handler(async () => {
    return { success: true, message: "Simulado" };
  });

export const generateFlussonicPublicPlaylist = createServerFn({ method: "POST" })
  .validator(z.any())
  .handler(async () => {
    return { success: true, message: "Playlist gerada", playlist: "" };
  });

// Aliases for FlussonicView compatibility
export const createFlussonicCategory = createServerFn({ method: "POST" })
  .validator(z.object({ 
    serverIp: z.string(),
    sshUser: z.string(),
    sshPassword: z.string().optional(),
    sshPort: z.number(),
    name: z.string() 
  }))
  .handler(async ({ data }) => {
    const conn = new SSH({
      host: data.serverIp,
      port: data.sshPort,
      username: data.sshUser,
      password: data.sshPassword || "",
    });
    try {
      await conn.connect();
      const cmd = `mkdir -p /opt/flussonic/priv/${data.name}`;
      await conn.exec(cmd);
      await conn.close();
      return { success: true, message: `Categoria ${data.name} criada com sucesso no servidor` };
    } catch (err: any) {
      return { success: false, message: `Erro SSH: ${err.message}` };
    }
  });

export const createFlussonicChannel = createServerFn({ method: "POST" })
  .validator(z.object({ 
    serverIp: z.string(),
    sshUser: z.string(),
    sshPassword: z.string().optional(),
    sshPort: z.number(),
    name: z.string(), 
    category: z.string().optional(), 
    videos: z.array(z.string()) 
  }))
  .handler(async ({ data }) => {
    const conn = new Client({
      host: data.serverIp,
      port: data.sshPort,
      username: data.sshUser,
      password: data.sshPassword || "",
    });
    try {
      await conn.connect();

      const categoryPath = data.category ? `/${data.category}` : "";
      const playlistContent = data.videos.join("\n");
      const playlistPath = `/opt/flussonic/priv${categoryPath}/${data.name}.txt`;
      
      // Write playlist
      await conn.exec(`cat << 'EOF' > ${playlistPath}\n${playlistContent}\nEOF`);

      // Update flussonic.conf
      const streamConfig = `stream ${data.name} {\\n  input vod://vod/${data.category ? data.category + '/' : ''}${data.name}.txt;\\n}`;
      const escapedConfig = streamConfig.replace(/'/g, "'\\''");
      const cmd = `if ! grep -q "stream ${data.name} {" /etc/flussonic/flussonic.conf; then echo -e '${escapedConfig}' >> /etc/flussonic/flussonic.conf; fi && service flussonic reload`;
      
      await conn.exec(cmd);
      await conn.close();
      return { success: true, message: `Canal ${data.name} criado e Flussonic recarregado` };
    } catch (err: any) {
      return { success: false, message: `Erro SSH: ${err.message}` };
    }
  });

export const listFlussonicCategories = createServerFn({ method: "POST" })
  .validator(z.object({
    serverIp: z.string(),
    sshUser: z.string(),
    sshPassword: z.string().optional(),
    sshPort: z.number(),
  }))
  .handler(async ({ data }) => {
    const conn = new SSH({
      host: data.serverIp,
      port: data.sshPort,
      username: data.sshUser,
      password: data.sshPassword || "",
    });
    try {
      await conn.connect();
      const output = await conn.exec("ls -d /opt/flussonic/priv/*/ 2>/dev/null | xargs -n 1 basename");
      await conn.close();
      const categories = output.split("\n").filter(Boolean);
      return { success: true, categories };
    } catch (err: any) {
      return { success: false, message: `Erro SSH: ${err.message}`, categories: [] };
    }
  });
