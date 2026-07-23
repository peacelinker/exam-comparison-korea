import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

function githubPagesBase(): string {
  const explicitBase = process.env.VITE_BASE_PATH;
  if (explicitBase) {
    const normalized = explicitBase.startsWith("/") ? explicitBase : `/${explicitBase}`;
    return normalized.endsWith("/") ? normalized : `${normalized}/`;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) return "/";

  const [owner, repositoryName] = repository.split("/");
  if (!owner || !repositoryName) return "/";

  return repositoryName.toLowerCase() === `${owner}.github.io`.toLowerCase()
    ? "/"
    : `/${repositoryName}/`;
}

export default defineConfig({
  base: githubPagesBase(),
  plugins: [react()],
  build: {
    sourcemap: false,
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
