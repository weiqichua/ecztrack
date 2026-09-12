import React from "react";
import Svg, { Path } from "react-native-svg";
import { PATHS } from "./mciPaths";


type MciIconProps = {
  name: string;
  size?: number;
  color?: string;
  style?: object;
};

export default function MciIcon({ name, size = 24, color = "#000", style }: MciIconProps) {
  const path = PATHS[name];
  if (!path) {
    if (__DEV__) console.warn(`[MciIcon] Unknown icon: "${name}"`);
    return null;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d={path} fill={color} />
    </Svg>
  );
}
