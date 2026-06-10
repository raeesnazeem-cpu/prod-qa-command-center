const fs = require('fs');
const file = '/Users/ikkaavaforever/Documents/Work/react-projects/feature-mcp/apps/web/src/styles/globals.css';
let css = fs.readFileSync(file, 'utf8');

css = css.replace(
  /-webkit-mask-composite: xor;\n\s*mask-composite: exclude;/g,
  '-webkit-mask-composite: xor;\n    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);\n    mask-composite: exclude;'
);

fs.writeFileSync(file, css);
