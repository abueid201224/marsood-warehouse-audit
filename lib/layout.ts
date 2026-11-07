import { useWindowDimensions } from "react-native";
import { layoutFor, type LayoutInfo } from "./layoutCore";

export { layoutFor, type LayoutInfo, type SizeClass } from "./layoutCore";

export function useLayout(): LayoutInfo {
  const { width, height, fontScale } = useWindowDimensions();
  return layoutFor(width, height, fontScale);
}
