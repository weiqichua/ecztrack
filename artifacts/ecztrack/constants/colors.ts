const colors = {
  dark: {
    text: "#E0E0E0",
    tint: "#81D4FA",

    background: "#121212",
    foreground: "#E0E0E0",

    card: "#1E1E1E",
    cardForeground: "#E0E0E0",

    primary: "#81D4FA",
    primaryForeground: "#121212",

    secondary: "#1E1E1E",
    secondaryForeground: "#B0BEC5",

    muted: "#1E1E1E",
    mutedForeground: "#78909C",

    accent: "#29B6F6",
    accentForeground: "#121212",

    destructive: "#EF5350",
    destructiveForeground: "#FFFFFF",

    border: "#2A2A2A",
    input: "#2A2A2A",

    warning: "#FFB300",
    warningForeground: "#121212",

    success: "#66BB6A",
    successForeground: "#121212",

    surface: "#1A1A1A",
    surfaceForeground: "#CFD8DC",
  },

  light: {
    text: "#0a0a0a",
    tint: "#0284C7",

    background: "#F0F7FF",
    foreground: "#0a0a0a",

    card: "#FFFFFF",
    cardForeground: "#0a0a0a",

    primary: "#0284C7",
    primaryForeground: "#FFFFFF",

    secondary: "#E0F2FE",
    secondaryForeground: "#0369A1",

    muted: "#E0F2FE",
    mutedForeground: "#546E7A",

    accent: "#0EA5E9",
    accentForeground: "#FFFFFF",

    destructive: "#EF5350",
    destructiveForeground: "#FFFFFF",

    border: "#BAE6FD",
    input: "#BAE6FD",

    warning: "#FFB300",
    warningForeground: "#121212",

    success: "#43A047",
    successForeground: "#FFFFFF",

    surface: "#FFFFFF",
    surfaceForeground: "#0369A1",
  },

  radius: 12,
};

/**
 * Text/icon colour for content sitting on a FIXED accent background — the
 * phase colours (#81D4FA, #FFB300, #66BB6A) and the export card accents.
 *
 * Those backgrounds are the same light pastels in both themes, so this must
 * NOT be `colors.primaryForeground`: that resolves to white in light mode and
 * would put white text on a pale blue circle. Use `primaryForeground` only
 * where the background is genuinely `colors.primary`.
 */
export const ON_ACCENT = "#121212";

export default colors;
