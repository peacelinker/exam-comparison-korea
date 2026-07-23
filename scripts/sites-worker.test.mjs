import { describe, expect, it } from "vitest";
import worker from "./sites-worker.mjs";

function fakeEnvironment() {
  const requestedPaths = [];
  return {
    requestedPaths,
    env: {
      ASSETS: {
        async fetch(request) {
          const path = new URL(request.url).pathname;
          requestedPaths.push(path);
          if (path === "/index.html") {
            return new Response("<!doctype html><title>시험 비교 분석</title>", {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }
          if (path === "/assets/app.js") {
            return new Response("export {};", { status: 200 });
          }
          return new Response("Not found", { status: 404 });
        },
      },
    },
  };
}

describe("Sites 정적 파일 라우팅", () => {
  it("루트 요청을 index.html로 연결한다", async () => {
    const { env, requestedPaths } = fakeEnvironment();
    const response = await worker.fetch(
      new Request("https://example.test/", {
        headers: { accept: "text/html" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(requestedPaths).toEqual(["/index.html"]);
    expect(await response.text()).toContain("시험 비교 분석");
  });

  it("정적 자산 요청은 그대로 전달한다", async () => {
    const { env, requestedPaths } = fakeEnvironment();
    const response = await worker.fetch(
      new Request("https://example.test/assets/app.js"),
      env,
    );

    expect(response.status).toBe(200);
    expect(requestedPaths).toEqual(["/assets/app.js"]);
  });

  it("HTML 경로의 404는 index.html로 대체한다", async () => {
    const { env, requestedPaths } = fakeEnvironment();
    const response = await worker.fetch(
      new Request("https://example.test/report", {
        headers: { accept: "text/html,application/xhtml+xml" },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(requestedPaths).toEqual(["/report", "/index.html"]);
  });

  it("없는 이미지의 404는 숨기지 않는다", async () => {
    const { env, requestedPaths } = fakeEnvironment();
    const response = await worker.fetch(
      new Request("https://example.test/missing.png", {
        headers: { accept: "image/avif,image/webp,*/*" },
      }),
      env,
    );

    expect(response.status).toBe(404);
    expect(requestedPaths).toEqual(["/missing.png"]);
  });
});
