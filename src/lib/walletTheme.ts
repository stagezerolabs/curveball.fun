import { cssStringFromTheme, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";

const darkBase = darkTheme({
  accentColor: "#c8f135",
  accentColorForeground: "#10170f",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small",
});
const lightBase = lightTheme({
  accentColor: "#14221b",
  accentColorForeground: "#ffffff",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small",
});

const darkCurveballTheme = {
  ...darkBase,
  colors: {
    ...darkBase.colors,
    modalBackground: "#121714",
    modalBorder: "rgba(255, 255, 255, 0.09)",
    modalText: "#e9ede8",
    actionButtonSecondaryBackground: "#1e2521",
  },
};
const lightCurveballTheme = {
  ...lightBase,
  colors: {
    ...lightBase.colors,
    modalBackground: "#fbfcf7",
    modalBorder: "rgba(20, 34, 27, 0.1)",
    modalText: "#14221b",
    actionButtonSecondaryBackground: "#eef0e9",
  },
};

export const walletThemeCss = `
:root[data-theme="dark"] { ${cssStringFromTheme(darkCurveballTheme)} }
:root[data-theme="light"] { ${cssStringFromTheme(lightCurveballTheme)} }
`;
