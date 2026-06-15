import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { codexAuth, codexReviewSettings } from "../../../../lib/services";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;
  const settings = await codexReviewSettings.getEffectiveReviewSettings(user.role === "admin");
  const reviewRuntimeStatus = {
    reviewProvider: settings.provider,
    reviewProviderLabel: settings.providerLabel,
    reviewModel: settings.model,
    reviewStrategyMode: settings.strategyMode,
    compatibleLastVerifiedAt: settings.compatible.lastVerifiedAt
  };

  if (settings.provider === "openai_compatible") {
    return NextResponse.json({
      authenticated: true,
      requiresOpenaiAuth: false,
      authMode: "openai_compatible",
      email: null,
      planType: null,
      managedByAdmin: true,
      ...reviewRuntimeStatus
    });
  }

  try {
    const status = await codexAuth.status();
    if (user.role !== "admin") {
      return NextResponse.json({
        authenticated: status.authenticated,
        requiresOpenaiAuth: status.requiresOpenaiAuth,
        authMode: null,
        email: null,
        planType: null,
        managedByAdmin: true,
        ...reviewRuntimeStatus
      });
    }
    return NextResponse.json({ ...status, ...reviewRuntimeStatus });
  } catch (error) {
    if (user.role !== "admin") {
      return NextResponse.json({
        authenticated: false,
        requiresOpenaiAuth: true,
        authMode: null,
        email: null,
        planType: null,
        managedByAdmin: true,
        ...reviewRuntimeStatus
      });
    }
    return NextResponse.json({
      authenticated: false,
      requiresOpenaiAuth: true,
      authMode: null,
      email: null,
      planType: null,
      ...reviewRuntimeStatus,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
