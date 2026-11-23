import * as Haptics from "expo-haptics";
import type { HapticKind } from "./feedback";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** أنماط الاهتزاز: خفيف سريع، مزدوج خفيف، تحذير، خطأ قوي، ختامي. أي إخفاق يُتجاهل. */
export async function runHaptic(kind: HapticKind): Promise<void> {
  try {
    switch (kind) {
      case "tick":
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case "double":
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await wait(90);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case "warn":
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      case "error":
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        await wait(120);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        return;
      case "finale":
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await wait(140);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await wait(140);
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
    }
  } catch {
    // الجهاز بلا اهتزاز أو مقيّد: لا أثر على المسح
  }
}
