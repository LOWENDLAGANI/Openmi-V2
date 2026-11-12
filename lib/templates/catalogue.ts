/**
 * The templates a new chat can start from.
 *
 * Each one is a small, real application rather than a placeholder: it installs,
 * it has a `dev` script the preview detector can read, and the page it serves
 * says what it is. The contents live here as strings because a serverless
 * deployment cannot be trusted to ship a directory of starter files, and a
 * template that silently went missing is worse than one that was never offered.
 *
 * These files are written exactly once, at repository creation. Every later
 * change still goes through the changeset → branch → pull request path; a
 * template is a starting point, not a second way to write code.
 */

export type TemplateFile = { path: string; content: string };

export type Template = {
  id: string;
  name: string;
  description: string;
  /** What the preview expects before it probes; detection still reads the script. */
  devPort: number;
  files: TemplateFile[];
};

const GITIGNORE = `node_modules
.next
dist
build
.env
.env.local
.DS_Store
`;

const NEXT_PACKAGE = `{
  "name": "openmi-app",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.5.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
`;

const NEXT_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const NEXT_LAYOUT = `import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Openmi app",
  description: "Started from a template, changed in chat.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const NEXT_PAGE = `export default function Page() {
  return (
    <main className="shell">
      <p className="eyebrow">your app</p>
      <h1>It runs. Now change it.</h1>
      <p className="lead">
        Ask for something in the chat beside the preview. The change lands in the
        workspace first, and only reaches GitHub when you approve it.
      </p>
    </main>
  );
}
`;

const NEXT_CSS = `:root {
  color-scheme: light dark;
  --bg: #fbfaf7;
  --ink: #151412;
  --mid: #5c5850;
  --line: #e2ded4;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14130f;
    --ink: #f4f2ec;
    --mid: #b3aea2;
    --line: #2c2a24;
  }
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, sans-serif;
}

.shell {
  max-width: 42rem;
  margin: 0 auto;
  padding: 4rem 1.5rem;
}

.eyebrow {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mid);
}

h1 {
  margin: 0.5rem 0 0;
  font-size: 2rem;
  letter-spacing: -0.02em;
}

.lead {
  margin-top: 1rem;
  line-height: 1.6;
  color: var(--mid);
  max-width: 34rem;
}
`;

const NEXT_README = `# Openmi app

Started from the Next.js template.

- \`npm install\`
- \`npm run dev\` serves on http://localhost:3000

Ask Openmi to change \`app/page.tsx\`; the preview beside the chat shows the
result before anything is written to GitHub.
`;

const VITE_PACKAGE = `{
  "name": "openmi-vite-app",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.6.0",
    "vite": "^7.0.0"
  }
}
`;

const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
});
`;

const VITE_INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Openmi app</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const VITE_MAIN = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`;

const VITE_APP = `export default function App() {
  return (
    <main className="shell">
      <p className="eyebrow">your app</p>
      <h1>It runs. Now change it.</h1>
      <p className="lead">
        Ask for something in the chat beside the preview. The change lands in the
        workspace first, and only reaches GitHub when you approve it.
      </p>
    </main>
  );
}
`;

const VITE_CSS = `:root {
  color-scheme: light dark;
  --bg: #fbfaf7;
  --ink: #151412;
  --mid: #5c5850;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14130f;
    --ink: #f4f2ec;
    --mid: #b3aea2;
  }
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, sans-serif;
}

.shell {
  max-width: 42rem;
  margin: 0 auto;
  padding: 4rem 1.5rem;
}

.eyebrow {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mid);
}

h1 {
  margin: 0.5rem 0 0;
  font-size: 2rem;
  letter-spacing: -0.02em;
}

.lead {
  margin-top: 1rem;
  line-height: 1.6;
  color: var(--mid);
  max-width: 34rem;
}
`;

const VITE_README = `# Openmi app

Started from the Vite + React template.

- \`npm install\`
- \`npm run dev\` serves on http://localhost:5173

Ask Openmi to change \`src/App.tsx\`; the preview beside the chat shows the
result before anything is written to GitHub.
`;

export const TEMPLATES: readonly Template[] = [
  {
    id: "next-starter",
    name: "Next.js starter",
    description: "App Router, one page, no database. Previews on port 3000.",
    devPort: 3000,
    files: [
      { path: ".gitignore", content: GITIGNORE },
      { path: "package.json", content: NEXT_PACKAGE },
      { path: "tsconfig.json", content: NEXT_TSCONFIG },
      { path: "next.config.mjs", content: "export default {};\n" },
      { path: "app/layout.tsx", content: NEXT_LAYOUT },
      { path: "app/page.tsx", content: NEXT_PAGE },
      { path: "app/globals.css", content: NEXT_CSS },
      { path: "README.md", content: NEXT_README },
    ],
  },
  {
    id: "vite-react",
    name: "Vite + React",
    description: "One component, one stylesheet. Previews on port 5173.",
    devPort: 5173,
    files: [
      { path: ".gitignore", content: GITIGNORE },
      { path: "package.json", content: VITE_PACKAGE },
      { path: "vite.config.ts", content: VITE_CONFIG },
      { path: "index.html", content: VITE_INDEX },
      { path: "src/main.tsx", content: VITE_MAIN },
      { path: "src/App.tsx", content: VITE_APP },
      { path: "src/styles.css", content: VITE_CSS },
      { path: "README.md", content: VITE_README },
    ],
  },
];

export function templateById(id: string): Template | null {
  return TEMPLATES.find((template) => template.id === id) ?? null;
}
