// Explicit build-time opt-in. Real team builds never use the offline adapter.
export const publicDemo = process.env.NEXT_PUBLIC_COFLOW_PUBLIC_DEMO === "true";
export const publicBasePath = process.env.NEXT_PUBLIC_COFLOW_BASE_PATH || "";
export const repositoryURL = "https://github.com/Vic020/CoFlow";
