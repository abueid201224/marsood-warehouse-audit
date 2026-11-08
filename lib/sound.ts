import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { EncodingType, cacheDirectory, getInfoAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { bytesToBase64 } from "./core/base64";
import { ALERT_TONES, buildWav, type AlertKind } from "./tones";

const players = new Map<AlertKind, AudioPlayer>();
let modeReady = false;

async function playerFor(kind: AlertKind): Promise<AudioPlayer | null> {
  const existing = players.get(kind);
  if (existing) return existing;
  if (!cacheDirectory) return null;
  const uri = `${cacheDirectory}marsood-alert-${kind}.wav`;
  const info = await getInfoAsync(uri);
  if (!info.exists) await writeAsStringAsync(uri, bytesToBase64(buildWav(ALERT_TONES[kind])), { encoding: EncodingType.Base64 });
  const player = createAudioPlayer({ uri });
  player.volume = 1;
  players.set(kind, player);
  return player;
}

/** يشغّل نغمة التنبيه. الإخفاق الصوتي لا يوقف المسح أبداً. */
export async function playAlert(kind: AlertKind): Promise<void> {
  try {
    if (!modeReady) {
      await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "duckOthers" }).catch(() => undefined);
      modeReady = true;
    }
    const player = await playerFor(kind);
    if (!player) return;
    await player.seekTo(0);
    player.play();
  } catch {
    // لا صوت: نكتفي بالتنبيه البصري والاهتزاز
  }
}
