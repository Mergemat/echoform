export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 3001;

export function resolveStartupConfig(
  env,
  createToken = () => crypto.randomUUID()
) {
  return {
    rendererUrl: env.ECHOFORM_RENDERER_URL?.trim() || null,
    apiBaseUrlOverride: env.ECHOFORM_API_URL?.trim() || null,
    sessionBootstrapToken:
      env.ECHOFORM_SESSION_BOOTSTRAP_TOKEN?.trim() || createToken(),
  };
}
