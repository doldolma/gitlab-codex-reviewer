import { describe, expect, it } from "vitest";
import { canonicalRedirectUrl } from "../lib/canonical-origin";

const publicBaseUrl = "http://127.0.0.1:3000";

describe("canonicalRedirectUrl", () => {
  it("redirects localhost page requests to the configured public origin", () => {
    expect(
      canonicalRedirectUrl({
        requestUrl: "http://localhost:3000/login",
        method: "GET",
        publicBaseUrl,
        accept: "text/html"
      })
    ).toBe("http://127.0.0.1:3000/login");
  });

  it("uses host headers when the framework normalizes the request URL to the bind address", () => {
    expect(
      canonicalRedirectUrl({
        requestUrl: "http://127.0.0.1:3000/login",
        method: "GET",
        publicBaseUrl,
        accept: "text/html",
        host: "localhost:3000"
      })
    ).toBe("http://127.0.0.1:3000/login");
  });

  it("does not redirect requests that already use the public origin", () => {
    expect(
      canonicalRedirectUrl({
        requestUrl: "http://127.0.0.1:3000/login",
        method: "GET",
        publicBaseUrl,
        accept: "text/html"
      })
    ).toBeNull();
  });

  it("preserves query strings", () => {
    expect(
      canonicalRedirectUrl({
        requestUrl: "http://localhost:3000/login?redirectTo=%2Fprojects",
        method: "GET",
        publicBaseUrl,
        accept: "text/html"
      })
    ).toBe("http://127.0.0.1:3000/login?redirectTo=%2Fprojects");
  });

  it("does not redirect Next static assets", () => {
    expect(
      canonicalRedirectUrl({
        requestUrl: "http://localhost:3000/_next/static/chunks/app.js",
        method: "GET",
        publicBaseUrl,
        accept: "*/*"
      })
    ).toBeNull();
  });

  it("does not redirect normal API calls", () => {
    expect(
      canonicalRedirectUrl({
        requestUrl: "http://localhost:3000/api/auth/status",
        method: "GET",
        publicBaseUrl,
        accept: "application/json"
      })
    ).toBeNull();
  });

  it("redirects GitLab OAuth start calls to the configured public origin", () => {
    expect(
      canonicalRedirectUrl({
        requestUrl: "http://localhost:3000/api/auth/gitlab/start?redirectTo=%2F",
        method: "GET",
        publicBaseUrl,
        accept: "text/html"
      })
    ).toBe("http://127.0.0.1:3000/api/auth/gitlab/start?redirectTo=%2F");
  });
});
