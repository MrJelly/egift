const path = require("node:path");

const RESPONSIVE_FILE = path.normalize(path.join("src", "responsive.css"));
const TYPOGRAPHY_PROPS = new Set(["font", "font-size", "line-height", "letter-spacing", "word-spacing"]);

function toCqw(value, designWidth) {
  return value.replace(/(-?(?:\d+|\d*\.\d+))px/g, (source, raw) => {
    const pixels = Number(raw);
    if (!Number.isFinite(pixels) || Math.abs(pixels) <= 1) return source;
    const converted = ((pixels / designWidth) * 100).toFixed(5).replace(/\.?0+$/, "");
    return `${converted}cqw`;
  });
}

module.exports = {
  plugins: [
    {
      postcssPlugin: "gift-ledger-responsive-cqw",
      Declaration(declaration) {
        const file = path.normalize(declaration.source?.input?.file || "");
        if (!file.endsWith(RESPONSIVE_FILE)) return;
        if (TYPOGRAPHY_PROPS.has(declaration.prop)) return;

        const selector = declaration.parent?.selector || "";
        const designWidth = selector.includes(".scaled-portrait")
          ? 720
          : selector.includes(".scaled-landscape")
            ? 1180
            : selector.includes(".setup-portrait")
              ? 560
              : selector.includes(".setup-landscape")
                ? 960
                : 0;

        if (designWidth) declaration.value = toCqw(declaration.value, designWidth);
      },
    },
  ],
};
